/**
 * AI로 워크플로우 만들기(run/ai.ts · PLAN §42)
 *
 *   GET  /api/ai            켜 둠 · 키가 있나(어디서 — 값은 안 나감) · 모델 · 고를 수 있는 모델 · 최근 30일 쓴 양
 *   PUT  /api/ai            (관리자) { apiKey?, model?, enabled? } — 키는 시크릿 상자로 잠근다 · 빈 글자면 지움
 *   POST /api/ai/messages   (편집자) Anthropic Messages 모양 { system, messages, tools?, flowId? } → 모델의 답 그대로
 *                           머리글 x-flowsmith-ai-key — 그 사람의 키(«내 설정», 브라우저에만 있다). ★저장 · 기록하지 않고 넘기기만
 *                           · x-flowsmith-ai-provider(anthropic · gemini) · x-flowsmith-ai-model — 그 사람이 고른 AI · 모델
 */
import { byOf } from "../../auth/auth.ts";
import { route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";

export function aiRoutes({ ai }: ApiDeps): Route[] {
  return [
    route("GET", "/api/ai", () => ({ ...ai.status(), usage: ai.usage(30) })),
    route("PUT", "/api/ai", async (_q, _r, _p, body) => ai.configure(await body())),
    route("POST", "/api/ai/messages", async (req, _r, _p, body) => {
      const b = await body();
      const h = (n: string) => { const v = req.headers[n]; return typeof v === "string" && v.trim() ? v.trim() : null; };
      return ai.messages({ system: b["system"] as string, messages: b["messages"] as unknown[], ...(b["tools"] !== undefined ? { tools: b["tools"] as unknown[] } : {}), flowId: (b["flowId"] as string | null | undefined) ?? null }, byOf(req), { key: h("x-flowsmith-ai-key"), provider: h("x-flowsmith-ai-provider"), model: h("x-flowsmith-ai-model") });
    }),
  ];
}
