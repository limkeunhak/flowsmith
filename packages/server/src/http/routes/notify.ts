/**
 * 알림 — 보낸 기록 · 시험 보내기 (보내는 일은 run/notifier.ts)
 *
 *   GET    /api/flows/:id/notices                  보낸 알림(최근 30개) — 됐나 · 왜 안 됐나. 주소는 없다
 *   POST   /api/flows/:id/notify/test              { rule } 시험 알림을 보낸다 → { ok, status, error }
 *                                                  ★초안의 변수 · 시크릿으로 주소를 채운다(아직 저장 안 한 규칙도 된다)
 *   GET    /api/notify/config                      이 서버가 메일을 보낼 수 있나 → { email: boolean, from }
 */
import { ID_RE, NOTIFY_CHANNELS, type NotifyChannel, type NotifyRule } from "@flowsmith/core";
import { secretDefsOf } from "../../storage/secrets.ts";
import { HttpError, positiveInt, query, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";

export function notifyRoutes({ store, notifier }: ApiDeps): Route[] {
  return [
    route("GET", "/api/notify/config", () => ({ email: notifier.mailFrom !== null, from: notifier.mailFrom })),
    route("GET", "/api/flows/:id/notices", (req, _r, p) => {
      const limit = query(req).get("limit");
      return store.listNotices(p["id"]!, limit ? positiveInt(limit, "limit") : 30);
    }),
    route("POST", "/api/flows/:id/notify/test", async (_q, _r, p, body) => {
      const f = store.getFlow(p["id"]!);
      const r = (await body())["rule"] as Partial<NotifyRule> | undefined;
      if (!r || typeof r !== "object") throw new HttpError(400, "rule이 없습니다");
      if (typeof r.url !== "string" || r.url.trim() === "") throw new HttpError(400, "알림 주소가 비었습니다");
      if (!(NOTIFY_CHANNELS as readonly string[]).includes(String(r.channel))) throw new HttpError(400, `channel은 ${NOTIFY_CHANNELS.join(" · ")} 중 하나입니다`);
      const draft = f.draft as { vars?: unknown };
      const vars = draft.vars && typeof draft.vars === "object" && !Array.isArray(draft.vars)
        ? Object.fromEntries(Object.entries(draft.vars as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string> : {};
      const rule: NotifyRule = { id: typeof r.id === "string" && ID_RE.test(r.id) ? r.id : "test", on: [], channel: r.channel as NotifyChannel, url: r.url, attach: false, firstOnly: false, enabled: true };
      return notifier.test({ id: f.id, name: f.name, vars, secrets: secretDefsOf(f.draft) }, rule);
    }),
  ];
}
