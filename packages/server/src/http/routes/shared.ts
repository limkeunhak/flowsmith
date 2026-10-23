/**
 * 팀 공용 값 — 여러 플로우가 함께 쓰는 변수 · 시크릿(storage/shared.ts).
 *
 *   GET    /api/shared?flow=<id>               목록(보는 사람 이상) — 내가 볼 수 있는 범위만. flow가 있으면 그 플로우가 닿는 범위(제 팀 · 공용)만
 *   PUT    /api/shared/:scope/vars/:name       (관리자) { value, description? }
 *   PUT    /api/shared/:scope/secrets/:name    (관리자) { kind: text|login, value, description? } — ★값은 넣기만, 다시 읽을 수 없다
 *   DELETE /api/shared/:scope/(vars|secrets)/:name  (관리자)
 *
 * scope — 팀 id · `_`(모두 — 공용)
 */
import { byOf, userOf } from "../../auth/auth.ts";
import { HttpError, query, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";
import type { SharedKind } from "../../storage/store.ts";

const GLOBAL = "_";

export function sharedRoutes({ store, secrets, auth }: ApiDeps): Route[] {
  const scopeOf = (raw: string): string => {
    if (raw === GLOBAL) return "";
    if (!store.listTeams().some((t) => t.id === raw)) throw new HttpError(404, "없는 팀입니다");
    return raw;
  };
  const kindOf = (raw: string): SharedKind => {
    if (raw === "vars") return "var";
    if (raw === "secrets") return "secret";
    throw new HttpError(404, "vars · secrets 중 하나입니다");
  };
  return [
    route("GET", "/api/shared", (req) => {
      const flowId = query(req).get("flow");
      const mine = auth.teamsFor(userOf(req));
      let scopes: string[] | null = mine === null ? null : ["", ...mine];
      if (flowId) {
        const team = store.flowTeam(flowId);
        if (team === undefined || !auth.canSeeFlow(userOf(req), flowId)) throw new HttpError(404, "없는 워크플로우입니다");
        scopes = team ? [team, ""] : [""];
      }
      const teams = store.listTeams().filter((t) => scopes === null || scopes.includes(t.id)).map((t) => ({ id: t.id, name: t.name }));
      return { teams, values: secrets.listShared(scopes) };
    }),
    route("PUT", "/api/shared/:scope/:kind/:name", async (req, _res, p, body) => {
      const scope = scopeOf(p["scope"]!), kind = kindOf(p["kind"]!);
      const updatedAt = secrets.putShared(scope, kind, p["name"]!, await body(), byOf(req));
      return { scope, kind, name: p["name"], updatedAt };
    }),
    route("DELETE", "/api/shared/:scope/:kind/:name", (_req, res, p) => {
      if (!store.deleteShared(scopeOf(p["scope"]!), kindOf(p["kind"]!), p["name"]!)) throw new HttpError(404, "없는 값입니다");
      res.statusCode = 204;
      return null;
    }),
  ];
}
