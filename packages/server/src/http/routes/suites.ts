/**
 * **Suite** — 웹 e2e 테스트 묶음(storage/suites.ts · run/suites.ts).
 *
 *   GET    /api/suites                       내가 볼 수 있는 Suite들 + 마지막 실행
 *   POST   /api/suites                       { name, team? } → 201 (편집자)
 *   GET    /api/suites/:id                   Suite + 최근 실행 30개
 *   PUT    /api/suites/:id                   { name?, description?, team?, items?, schedules?, notify? } (편집자)
 *   DELETE /api/suites/:id                   (편집자)
 *   POST   /api/suites/:id/runs              { item? } 전체(순차) · 단건 → 202 { suiteRunId } (실행자)
 *   GET    /api/suite-runs/:id               실행 하나 — 시나리오마다의 판정
 *   POST   /api/suite-runs/:id/cancel        멈추기(실행자)
 *
 * ★팀 — 팀 Suite는 그 팀 사람과 관리자만 · 공용은 모두. 시나리오의 플로우는 같은 팀이거나 공용이어야 한다.
 */
import type { IncomingMessage } from "node:http";
import { byOf, userOf } from "../../auth/auth.ts";
import { HttpError, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";
import { reaches, visibleTo } from "../../rules/teams.ts";
import { readSuiteBody, type Suite } from "../../storage/suites.ts";

export function suiteRoutes({ store, auth, suites }: ApiDeps): Route[] {
  const canSee = (req: IncomingMessage, s: Suite): boolean => !auth.enabled || visibleTo(auth.teamsFor(userOf(req)), s.team?.id ?? null);
  const suiteOf = (req: IncomingMessage, id: string): Suite => {
    const s = store.getSuite(id);
    if (!canSee(req, s)) throw new HttpError(404, "없는 Suite입니다");
    return s;
  };
  /** 팀을 정할 수 있나 — 관리자 · 그 팀 사람(로그인 끔이면 누구나) */
  const mayUseTeam = (req: IncomingMessage, team: string | null) => {
    if (team === null || !auth.enabled) return;
    const mine = auth.teamsFor(userOf(req));
    if (mine !== null && !mine.has(team)) throw new HttpError(403, "내 팀이 아닌 팀에는 둘 수 없습니다");
    if (!store.listTeams().some((t) => t.id === team)) throw new HttpError(404, "없는 팀입니다");
  };
  const teamOf = (v: unknown): string | null | undefined => (v === undefined ? undefined : typeof v === "string" && v ? v : null);

  return [
    route("GET", "/api/suites", (req) => store.listSuites().filter((s) => canSee(req, s)).map((s) => ({ ...s, lastRun: store.listSuiteRuns(s.id, 1)[0] ?? null, running: suites.isRunning(s.id) }))),
    route("POST", "/api/suites", async (req, res, _p, body) => {
      const b = await body();
      const team = teamOf(b["team"]) ?? null;
      mayUseTeam(req, team);
      const s = store.createSuite(typeof b["name"] === "string" ? b["name"] : "", team, byOf(req));
      res.statusCode = 201;
      return s;
    }),
    route("GET", "/api/suites/:id", (req, _r, p) => {
      const s = suiteOf(req, p["id"]!);
      return { suite: s, runs: store.listSuiteRuns(s.id, 30), running: suites.isRunning(s.id) };
    }),
    route("PUT", "/api/suites/:id", async (req, _r, p, body) => {
      const cur = suiteOf(req, p["id"]!);
      const b = await body();
      const team = teamOf(b["team"]);
      if (team !== undefined) mayUseTeam(req, team);
      const next = readSuiteBody(b, cur);
      // 시나리오의 플로우 — 있어야 하고 · 이 Suite의 팀에서 닿아야 한다(같은 팀 · 공용)
      const suiteTeam = team !== undefined ? team : cur.team?.id ?? null;
      const problems: string[] = [];
      next.items.forEach((it, i) => {
        const ft = store.flowTeam(it.flowId);
        if (ft === undefined) problems.push(`시나리오 ${i + 1}: 워크플로우 "${it.flowId}"가 없습니다`);
        else if (!reaches(suiteTeam, ft)) problems.push(`시나리오 ${i + 1}: 워크플로우 "${it.flowId}"는 다른 팀의 것입니다 — 같은 팀이거나 공용이어야 합니다`);
      });
      if (problems.length) throw new HttpError(400, "Suite를 저장할 수 없습니다", problems);
      return store.updateSuite(cur.id, next, team, byOf(req));
    }),
    route("DELETE", "/api/suites/:id", (req, res, p) => {
      const s = suiteOf(req, p["id"]!);
      if (suites.isRunning(s.id)) throw new HttpError(409, "돌고 있는 Suite는 지울 수 없습니다 — 멈춘 뒤에 지우세요");
      store.deleteSuite(s.id);
      res.statusCode = 204;
      return null;
    }),
    route("POST", "/api/suites/:id/runs", async (req, res, p, body) => {
      const s = suiteOf(req, p["id"]!);
      const b = await body();
      const only = typeof b["item"] === "string" && b["item"] ? b["item"] : null;
      const suiteRunId = suites.start(s.id, { only, trigger: "manual", by: byOf(req) });
      res.statusCode = 202;
      return { suiteRunId };
    }),
    route("GET", "/api/suite-runs/:id", (req, _r, p) => {
      const r = store.getSuiteRun(p["id"]!);
      suiteOf(req, r.suiteId);
      return r;
    }),
    route("POST", "/api/suite-runs/:id/cancel", (req, res, p) => {
      const r = store.getSuiteRun(p["id"]!);
      suiteOf(req, r.suiteId);
      if (!suites.cancel(r.id)) throw new HttpError(409, "돌고 있는 Suite 실행이 아닙니다");
      res.statusCode = 202;
      return { cancelling: true };
    }),
  ];
}
