/**
 * 웹훅 — 켜기 · 끄기 · 받기 (일정 트리거는 run/triggers.ts의 Scheduler가 돌린다)
 *
 *   GET    /api/flows/:id/webhook                  웹훅이 켜져 있나(토큰은 안 보인다)
 *   POST   /api/flows/:id/webhook                  웹훅 켜기 · 토큰 새로 — 201 { token } ★토큰은 이때만 보인다
 *   DELETE /api/flows/:id/webhook                  웹훅 끄기
 *   POST   /api/hooks/:id                          웹훅 — 토큰(x-flowsmith-token · Bearer · ?token=) · 본문=실행 입력 · ?wait=1이면 결과까지
 */
import { checkWebhookToken, issueWebhookToken } from "../../run/triggers.ts";
import { HttpError, query, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";

export function triggerRoutes({ store, runs }: ApiDeps): Route[] {
  const hookPath = (id: string) => `/api/hooks/${encodeURIComponent(id)}`;
  return [
    route("GET", "/api/flows/:id/webhook", (_q, _r, p) => {
      store.getFlow(p["id"]!);
      const w = store.getWebhook(p["id"]!);
      return { enabled: w !== null, createdAt: w?.createdAt ?? null, path: hookPath(p["id"]!) };
    }),
    route("POST", "/api/flows/:id/webhook", (_q, res, p) => {
      const t = issueWebhookToken(store, p["id"]!);
      res.statusCode = 201;
      // ★토큰은 이 응답에서만 보인다 — 서버에는 해시만 남는다
      return { token: t.token, createdAt: t.createdAt, path: hookPath(p["id"]!) };
    }),
    route("DELETE", "/api/flows/:id/webhook", (_q, res, p) => { store.getFlow(p["id"]!); store.deleteWebhook(p["id"]!); res.statusCode = 204; return null; }),
    route("POST", "/api/hooks/:id", async (req, res, p, body) => {
      const id = p["id"]!;
      const q = query(req);
      const auth = req.headers.authorization;
      const token = String(req.headers["x-flowsmith-token"] ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : "") ?? "") || (q.get("token") ?? "");
      const check = checkWebhookToken(store, id, token);
      if (check === "off") throw new HttpError(404, "이 워크플로우의 웹훅이 꺼져 있습니다");
      if (check !== "ok") throw new HttpError(401, "토큰이 맞지 않습니다");
      const v = store.activeVersion(id);
      if (v === null) throw new HttpError(409, "게시된 버전이 없습니다");
      // 본문에서 **정의된 실행 입력만** 받는다 — 아무 값이나 실행 기록에 쌓이지 않게
      const b = await body();
      const params = Object.fromEntries(store.getVersion(id, v).params.filter((x) => b[x.name] !== undefined && b[x.name] !== null).map((x) => [x.name, String(b[x.name])]));
      const runId = runs.start(id, { version: v, params, trigger: "webhook" });
      const wait = q.get("wait");
      if (wait === "1" || wait === "true") {
        await Promise.race([runs.wait(runId), new Promise((r) => setTimeout(r, 120_000).unref())]);
        const r = store.getRun(runId);
        const out = (r.result as { output?: unknown } | null)?.output ?? null;
        return { runId, status: r.status, message: r.message, output: out };
      }
      res.statusCode = 202;
      return { runId, status: `/api/runs/${runId}` };
    }),
  ];
}
