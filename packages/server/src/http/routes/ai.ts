/**
 * AI로 워크플로우 만들기(run/ai.ts · PLAN §42)
 *
 *   GET  /api/ai            켜 둠 · 키가 있나(어디서 — 값은 안 나감) · 모델 · 고를 수 있는 모델 · 최근 30일 쓴 양
 *   PUT  /api/ai            (관리자) { apiKey?, model?, enabled? } — 키는 시크릿 상자로 잠근다 · 빈 글자면 지움
 *   POST /api/ai/messages   (편집자) Anthropic Messages 모양 { system, messages, tools?, flowId? } → 모델의 답 그대로
 *                           머리글 x-flowsmith-ai-key — 그 사람의 키(«내 설정», 브라우저에만 있다). ★저장 · 기록하지 않고 넘기기만
 *                           · x-flowsmith-ai-provider(anthropic · gemini) · x-flowsmith-ai-model — 그 사람이 고른 AI · 모델
 *   POST /api/ai/browse     (편집자) { url } → { id, snapshot, shot } AI가 사이트를 본다(live/ai-browse.ts) — ★관리자가 «사이트 화면 보기»를 켜야
 *   POST /api/ai/browse/:id/look   지금 화면을 다시 · DELETE /api/ai/browse/:id   닫기
 *   POST /api/ai/browse/:id/act    { kind: click|fill|select|press, target, value?, key?, flowId? } 열린 화면에서 한 가지(3단계) — 그 뒤 화면 요약.
 *                                  되돌릴 수 없어 보이는 단추는 409 · 값의 {{ $secrets.x }}는 flowId의 시크릿으로 바꿔 넣는다
 *   POST /api/ai/try        { draft, flowId?, params? } 만든 워크플로우를 점검 실행으로(되돌릴 수 없는 동작 앞에서 멈춤 · 1분)
 *   GET  /api/ai/site-flows?hosts=a.com,b.com   (편집자) 같은 사이트를 다루는 워크플로우(그 사람이 볼 수 있는 것 · 5개까지)의 웹페이지 노드 —
 *                           녹화해 둔 요소를 AI가 다시 쓰게(apps/studio/src/ai/refs.ts). 시크릿 값은 애초에 없다(이름만 쓰는 표현식)
 */
import { byOf, userOf } from "../../auth/auth.ts";
import { HttpError, query, route, type Route } from "../router.ts";
import type { ApiDeps } from "../api.ts";

/** 시작 주소의 호스트 — 변수({{ $vars.x }})는 그 워크플로우의 값으로 풀어서 */
function hostOf(url: unknown, vars: Record<string, unknown>): string | null {
  if (typeof url !== "string") return null;
  const full = url.replace(/\{\{\s*\$vars\.([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => String(vars[k] ?? ""));
  try { return new URL(full).hostname.toLowerCase(); } catch { return null; }
}

export function aiRoutes({ ai, aiBrowse, store, auth, secrets }: ApiDeps): Route[] {
  /** 그 워크플로우의 시크릿(볼 수 있는 사람만 · 없으면 빈 것) — AI에게는 가지 않고 서버 안에서만 쓴다 */
  const secretsOf = (req: Parameters<typeof userOf>[0], flowId: unknown) => {
    if (typeof flowId !== "string" || !flowId) return {};
    if (!auth.canSeeFlowReq(req, flowId)) throw new HttpError(404, "없는 워크플로우입니다");
    let defs: unknown = [];
    try { defs = (store.getFlow(flowId).draft as { secrets?: unknown } | null)?.secrets ?? []; } catch { return {}; }
    return secrets.unlockFor(flowId, Array.isArray(defs) ? defs : []);
  };
  const canView = () => {
    if (!ai.enabled) throw new HttpError(403, "AI를 꺼 두었습니다 — 관리자가 켜야 합니다");
    if (!ai.siteView) throw new HttpError(403, "AI가 사이트 화면을 보는 것을 관리자가 켜지 않았습니다(«내 설정 › AI 도우미»)");
  };
  return [
    route("POST", "/api/ai/browse", async (req, _r, _p, body) => {
      canView();
      const url = (await body())["url"];
      if (typeof url !== "string" || !url.trim()) throw new HttpError(400, "url이 필요합니다");
      return aiBrowse.open(byOf(req), url.trim());
    }),
    route("POST", "/api/ai/browse/:id/look", (req, _r, p) => { canView(); return aiBrowse.look(byOf(req), p["id"]!); }),
    route("DELETE", "/api/ai/browse/:id", async (req, res, p) => { await aiBrowse.close(byOf(req), p["id"]!); res.statusCode = 204; return null; }),
    route("POST", "/api/ai/browse/:id/act", async (req, _r, p, body) => {
      canView();
      const b = await body();
      const kind = b["kind"];
      if (kind !== "click" && kind !== "fill" && kind !== "select" && kind !== "press") throw new HttpError(400, "kind는 click · fill · select · press입니다");
      return aiBrowse.act(byOf(req), p["id"]!, {
        kind, ...(b["target"] && typeof b["target"] === "object" ? { target: b["target"] as never } : {}),
        ...(typeof b["value"] === "string" ? { value: b["value"] } : {}), ...(typeof b["key"] === "string" ? { key: b["key"] } : {}),
      }, secretsOf(req, b["flowId"]));
    }),
    route("POST", "/api/ai/try", async (req, _r, _p, body) => {
      canView();
      const b = await body();
      const params = b["params"] && typeof b["params"] === "object" && !Array.isArray(b["params"]) ? Object.fromEntries(Object.entries(b["params"] as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : {};
      try { return await aiBrowse.tryFlow(b["draft"], params, secretsOf(req, b["flowId"])); }
      catch (e) { throw new HttpError(400, `돌려 보지 못했습니다 — ${e instanceof Error ? e.message.split("\n").slice(0, 4).join(" · ") : String(e)}`); }
    }),
    route("GET", "/api/ai/site-flows", (req) => {
      const hosts = (query(req).get("hosts") ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).slice(0, 5);
      if (hosts.length === 0) return { flows: [] };
      const flows: unknown[] = [];
      for (const f of store.listFlows(auth.teamsFor(userOf(req)))) {
        if (flows.length >= 5) break;
        let draft: { vars?: Record<string, unknown>; nodes?: { id?: string; name?: string; type?: string; config?: { start?: { kind?: string; url?: unknown }; actions?: unknown[] } }[] } | null;
        try { draft = store.getFlow(f.id).draft as typeof draft; } catch { continue; }
        const web = (draft?.nodes ?? []).filter((n) => n.type === "web");
        if (!web.some((n) => n.config?.start?.kind === "url" && hosts.includes(hostOf(n.config.start.url, draft?.vars ?? {}) ?? ""))) continue;
        flows.push({ id: f.id, name: f.name, nodes: web.map((n) => ({ id: n.id, name: n.name, start: n.config?.start, actions: n.config?.actions ?? [] })) });
      }
      return { flows };
    }),
    route("GET", "/api/ai", () => ({ ...ai.status(), usage: ai.usage(30) })),
    route("PUT", "/api/ai", async (_q, _r, _p, body) => ai.configure(await body())),
    route("POST", "/api/ai/messages", async (req, _r, _p, body) => {
      const b = await body();
      const h = (n: string) => { const v = req.headers[n]; return typeof v === "string" && v.trim() ? v.trim() : null; };
      return ai.messages({ system: b["system"] as string, messages: b["messages"] as unknown[], ...(b["tools"] !== undefined ? { tools: b["tools"] as unknown[] } : {}), flowId: (b["flowId"] as string | null | undefined) ?? null }, byOf(req), { key: h("x-flowsmith-ai-key"), provider: h("x-flowsmith-ai-provider"), model: h("x-flowsmith-ai-model") });
    }),
  ];
}
