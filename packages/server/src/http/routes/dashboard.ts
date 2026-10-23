/**
 * 대시보드 (run/stats.ts · PLAN §29)
 *
 *   GET /api/dashboard?days=7&flow=<id>   기간(1~90일) · 플로우 하나만(없으면 전체)
 *
 * ★보이는 플로우만 센다 — 관리자가 아니면 내 팀과 공용(남의 팀 실행은 숫자에도 들지 않는다)
 */
import { userOf } from "../../auth/auth.ts";
import { dashboard } from "../../run/stats.ts";
import { HttpError, query, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";

export function dashboardRoutes({ store, auth }: ApiDeps): Route[] {
  return [
    route("GET", "/api/dashboard", (req) => {
      const q = query(req);
      const days = Number(q.get("days") ?? "7");
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpError(400, "기간은 1~90일입니다");
      const flow = q.get("flow");
      const visible = store.flowNames(auth.teamsFor(userOf(req)));
      const names = new Map(visible.filter((f) => !flow || f.id === flow).map((f) => [f.id, f.name]));
      if (flow && names.size === 0) throw new HttpError(404, "없는 워크플로우입니다");
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - (days - 1));
      return { ...dashboard(store.runsSince(since.toISOString()), names, days), flows: visible.map((f) => ({ id: f.id, name: f.name })) };
    }),
  ];
}
