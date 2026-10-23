/**
 * 확장 플러그인 (run/plugins.ts · PLAN §41) — 보기는 누구나, 바꾸기는 관리자(auth.ts needOf)
 *
 *   GET    /api/plugins                       플러그인들 · 서버에 고정된 확장 · 서명 정책 · 사내 저장소 주소 · 최근 기록
 *   POST   /api/plugins                       묶음(.fspkg) 그대로(application/octet-stream) → 201 올리고 그 버전으로
 *   PUT    /api/plugins/:id                   { enabled?, version? } 켜기 · 끄기 · 버전 바꾸기(되돌리기)
 *   DELETE /api/plugins/:id                   지우기 — 쓰는 워크플로우가 있으면 409(끄기는 된다)
 *   PUT    /api/plugins-source                { url } 사내 저장소 index.json 주소(빈 값이면 지움)
 *   POST   /api/plugins-source/check          새 버전 확인
 *   POST   /api/plugins-source/install        { id, version } 저장소에서 받아 올린다
 */
import type { IncomingMessage } from "node:http";
import { MAX_PACKAGE_BYTES } from "@flowsmith/worker";
import { byOf } from "../../auth/auth.ts";
import { HttpError, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_PACKAGE_BYTES) throw new HttpError(413, `묶음이 너무 큽니다(최대 ${MAX_PACKAGE_BYTES / 1048576}MB)`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export function pluginRoutes({ store, plugins }: ApiDeps): Route[] {
  /** 이 노드들을 쓰는 워크플로우 — 초안이든 게시된 버전이든 */
  const usedBy = (nodes: readonly string[]): string[] => {
    const want = new Set(nodes);
    const out: string[] = [];
    type Loose = { nodes?: { type?: unknown; config?: { extension?: unknown } }[] } | null;
    for (const f of store.listFlows(null)) {
      const d = store.getFlow(f.id);
      const flows = [d.draft as Loose, ...(d.activeVersion !== null ? [store.getVersionJson(f.id, d.activeVersion) as Loose] : [])];
      if (flows.some((x) => (x?.nodes ?? []).some((n) => n.type === "extension" && typeof n.config?.extension === "string" && want.has(n.config.extension)))) out.push(f.name);
    }
    return out;
  };
  return [
    route("GET", "/api/plugins", () => ({
      signing: { required: plugins.requireSigned, keys: plugins.keys },
      source: plugins.source,
      builtIn: plugins.builtIn(),
      plugins: plugins.list(),
      events: plugins.events(30),
    })),
    route("POST", "/api/plugins", async (req, res) => {
      const buf = await readRaw(req);
      if (buf.length === 0) throw new HttpError(400, "묶음(.fspkg)이 비었습니다");
      const v = await plugins.install(buf, byOf(req));
      res.statusCode = 201;
      return v;
    }),
    route("PUT", "/api/plugins/:id", async (req, _r, p, body) => {
      const b = await body();
      const id = p["id"]!;
      let v = plugins.view(id);
      if (!v) throw new HttpError(404, `플러그인 ${id}가 없습니다`);
      if (typeof b["version"] === "string" && b["version"] !== v.version) v = await plugins.setActive(id, b["version"], byOf(req));
      if (typeof b["enabled"] === "boolean" && b["enabled"] !== v.enabled) v = await plugins.setEnabled(id, b["enabled"], byOf(req));
      return v;
    }),
    route("DELETE", "/api/plugins/:id", async (req, res, p) => {
      const id = p["id"]!;
      if (!plugins.view(id)) throw new HttpError(404, `플러그인 ${id}가 없습니다`);
      const users = usedBy(plugins.nodesOf(id));
      if (users.length) throw new HttpError(409, `이 플러그인의 노드를 쓰는 워크플로우가 있어 지울 수 없습니다 — ${users.join(", ")}. 잠시 쓰지 않으려면 «끄기»를 누르세요`);
      await plugins.remove(id, byOf(req));
      res.statusCode = 204;
      return null;
    }),
    route("PUT", "/api/plugins-source", async (req, _r, _p, body) => {
      const url = (await body())["url"];
      return { source: plugins.setSource(typeof url === "string" ? url : null, byOf(req)) };
    }),
    route("POST", "/api/plugins-source/check", () => plugins.checkSource()),
    route("POST", "/api/plugins-source/install", async (req, res, _p, body) => {
      const b = await body();
      if (typeof b["id"] !== "string" || typeof b["version"] !== "string") throw new HttpError(400, "id와 version을 주세요");
      const v = await plugins.installFromSource(b["id"], b["version"], byOf(req));
      res.statusCode = 201;
      return v;
    }),
  ];
}
