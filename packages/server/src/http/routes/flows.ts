/**
 * 플로우 · 버전 · 배포 · 시크릿 · 확장 목록
 *
 *   GET    /api/extensions                         이 워커에 설치된 확장들
 *   GET    /api/flows                              목록
 *   POST   /api/flows                              { draft } 새 플로우 (uid는 서버가 붙인다)
 *   GET    /api/flows/:id                          초안 · 문제 · 버전들 · 배포된 버전 · uid
 *   PUT    /api/flows/:id/draft                    { draft } 초안 저장 (틀려 있어도 저장된다)
 *   DELETE /api/flows/:id
 *   PUT    /api/flows/:id/team                     { team: id | null } 팀 옮기기(공용은 null) — 옮길 팀에 내가 속해 있어야(관리자는 어디든)
 *   PUT    /api/flow-group                         { ids: [...], group: 이름 | null } 여럿의 화면을 직접 지정(자동으로 되돌리기는 null) — 내게 보이는 것만
 *   GET    /api/areas                              화면 규칙 [{ prefix, name }] — 주소 앞부분 → 화면 이름(storage/areas.ts)
 *   PUT    /api/areas                              { areas: [...] } 통째로 바꾸기
 *   POST   /api/flows/:id/versions                 { note } 초안을 버전으로 굳힌다 (검문소 통과 필수)
 *   GET    /api/flows/:id/versions/:v              그 버전의 매니페스트
 *   GET    /api/flows/:id/published                게시된 버전 한 번에 { version · 누가 · 언제 · manifest } — ETag/304 · 없으면 404 reason: not-deployed
 *   POST   /api/flows/:id/deploy                   { version: n | null } 배포 / 내리기 (언제 · 누가를 남긴다)
 *   GET    /api/flows/:id/secrets                  이름 · 종류 · 저장됐나 (★값은 없다)
 *   PUT    /api/flows/:id/secrets/:name            { value } 넣기
 *   DELETE /api/flows/:id/secrets/:name
 *   (어디서 돌리나 PUT /api/flows/:id/run-on — routes/workers.ts)
 */
import { HttpError, positiveInt, route, type Route } from "../router.ts";
import { byOf, userOf } from "../../auth/auth.ts";
import type { ApiDeps } from "../api.ts";

/** If-None-Match — 여러 값(쉼표) · 약한 표시(W/) · * 를 받는다 */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => { const v = t.trim().replace(/^W\//, ""); return v === "*" || v === etag; });
}

export function flowRoutes({ store, secrets, extensions, auth, plugins }: ApiDeps): Route[] {
  /** 이 사람이 이 팀에 플로우를 둘 수 있나 — 관리자 · 로그인 없이는 어디든, 그 밖에는 내 팀만(공용은 누구나) */
  const mayPlace = (req: Parameters<typeof userOf>[0], team: string | null) => {
    if (team === null) return;
    const mine = auth.teamsFor(userOf(req));
    if (mine !== null && !mine.has(team)) throw new HttpError(403, "내가 속한 팀에만 둘 수 있습니다");
  };
  const teamOf = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : typeof v === "string" ? v : (() => { throw new HttpError(400, "team은 팀 id 또는 null입니다"); })());
  return [
    route("GET", "/api/extensions", () => extensions.list()),
    route("GET", "/api/flows", (req) => store.listFlows(auth.teamsFor(userOf(req)))),
    route("POST", "/api/flows", async (req, res, _p, body) => {
      const b = await body();
      const team = teamOf(b["team"]);
      mayPlace(req, team);
      res.statusCode = 201;
      return store.createFlow(b["draft"], team, typeof b["group"] === "string" ? b["group"] : null);
    }),
    route("GET", "/api/areas", () => store.listAreas()),
    route("PUT", "/api/areas", async (_q, _r, _p, body) => store.setAreas((await body())["areas"])),
    // 화면 직접 지정 — 여럿을 한 번에(자동이 틀린 것만). ★내게 안 보이는 것(남의 팀)은 없는 것과 같다(있는지도 알리지 않는다)
    route("PUT", "/api/flow-group", async (req, _r, _p, body) => {
      const b = await body();
      const ids = b["ids"];
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string")) throw new HttpError(400, "ids는 워크플로우 id 목록입니다");
      const mine = auth.teamsFor(userOf(req));
      for (const id of ids as string[]) {
        const t = store.flowTeam(id);
        if (t === undefined || (mine !== null && t !== null && !mine.has(t))) throw new HttpError(404, `워크플로우 "${id}"가 없습니다`);
      }
      store.setFlowGroup(ids as string[], (b["group"] ?? null) as string | null);
      return { ids, group: store.getFlow((ids as string[])[0]!).group };
    }),
    route("PUT", "/api/flows/:id/team", async (req, _r, p, body) => {
      const team = teamOf((await body())["team"]);
      mayPlace(req, team);
      store.setFlowTeam(p["id"]!, team);
      return store.getFlow(p["id"]!);
    }),
    // 복제 — 초안만 새 워크플로우로(id «원래id-copy» · 겹치면 -copy2 …). 버전 · 게시 · 실행 기록 · 시크릿 값은 가져오지 않는다(시크릿은 정의만)
    route("POST", "/api/flows/:id/duplicate", async (req, res, p, body) => {
      const b = await body();
      const src = store.getFlow(p["id"]!);
      const team = b["team"] === undefined ? src.team?.id ?? null : teamOf(b["team"]);
      mayPlace(req, team);
      const name = typeof b["name"] === "string" && b["name"].trim() !== "" ? b["name"].trim() : `${src.name} (사본)`;
      const taken = new Set(store.listFlows(null).map((f) => f.id));
      const base = `${src.id}-copy`;
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
      const draft = { ...(src.draft as Record<string, unknown>), id, name };
      res.statusCode = 201;
      // 직접 지정한 화면은 원래 것 — 사본은 원래 것 옆에
      return store.createFlow(draft, team, src.group);
    }),
    route("GET", "/api/flows/:id",(_q, _r, p) => store.getFlow(p["id"]!)),
    route("PUT", "/api/flows/:id/draft", async (req, _r, p, body) => store.saveDraft(p["id"]!, (await body())["draft"], byOf(req))),
    route("DELETE", "/api/flows/:id", (_q, res, p) => { store.deleteFlow(p["id"]!); res.statusCode = 204; return null; }),

    route("POST", "/api/flows/:id/versions", async (req, res, p, body) => {
      const note = (await body())["note"];
      const version = store.createVersion(p["id"]!, typeof note === "string" ? note : "", byOf(req), (f) => plugins.versionsFor(f));
      res.statusCode = 201;
      return { version };
    }),
    route("GET", "/api/flows/:id/versions/:v", (_q, _r, p) => store.getVersionJson(p["id"]!, positiveInt(p["v"]!, "버전"))),
    // 고정된 출력(pin data) — 초안 시험에서 그 노드는 돌지 않고 이 값을 쓴다
    route("PUT", "/api/flows/:id/pins/:nodeId", async (_q, _r, p, body) => {
      const out = (await body())["output"];
      if (out === null || typeof out !== "object" || Array.isArray(out)) throw new HttpError(400, "output은 객체여야 합니다 — 그 노드가 내놓은 값");
      if (JSON.stringify(out).length > 1_000_000) throw new HttpError(413, "고정할 출력이 너무 큽니다(1MB까지)");
      return { pins: store.setPin(p["id"]!, p["nodeId"]!, out as Record<string, unknown>) };
    }),
    route("DELETE", "/api/flows/:id/pins/:nodeId", (_q, _r, p) => ({ pins: store.setPin(p["id"]!, p["nodeId"]!, null) })),
    route("GET", "/api/flows/:id/published", (req, res, p) => {
      const pub = store.published(p["id"]!);
      if (!pub) throw new HttpError(404, "게시된 버전이 없습니다 — 아직 게시하지 않았거나 내렸습니다", [], "not-deployed");
      // 버전은 굳으면 바뀌지 않는다 — uid + 버전이 같으면 내용도 같다(되돌려 게시하면 버전이 달라 새로 받는다)
      const etag = `"${pub.uid}.${pub.version}"`;
      res.setHeader("etag", etag);
      if (matchesEtag(req.headers["if-none-match"], etag)) { res.writeHead(304, { "cache-control": "no-cache" }); res.end(); return undefined; }
      return pub;
    }),
    route("POST", "/api/flows/:id/deploy", async (req, _r, p, body) => {
      const v = (await body())["version"];
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v))) throw new HttpError(400, "version은 정수 또는 null(배포 내리기)이어야 합니다");
      store.deploy(p["id"]!, v, byOf(req));
      return { activeVersion: v };
    }),

    route("GET", "/api/flows/:id/secrets", (_q, _r, p) => secrets.list(p["id"]!, store.getFlow(p["id"]!).draft)),
    route("PUT", "/api/flows/:id/secrets/:name", async (_q, _r, p, body) => {
      const b = await body();
      if (!("value" in b)) throw new HttpError(400, "value가 없습니다");
      const updatedAt = secrets.put(p["id"]!, store.getFlow(p["id"]!).draft, p["name"]!, b["value"]);
      return { name: p["name"], stored: true, updatedAt };   // ★값은 돌려주지 않는다
    }),
    route("DELETE", "/api/flows/:id/secrets/:name", (_q, res, p) => {
      if (!secrets.delete(p["id"]!, p["name"]!)) throw new HttpError(404, `시크릿 "${p["name"]}"가 저장돼 있지 않습니다`);
      res.statusCode = 204;
      return null;
    }),
  ];
}
