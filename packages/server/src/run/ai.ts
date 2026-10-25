/**
 * **AI로 워크플로우 만들기 — 서버 쪽**(PLAN §42). 서버는 키를 받아 모델을 대신 부르기만 한다.
 *
 *   도구를 쓰는 반복(초안 내기 → 검문소 → 고치기)은 편집 화면(apps/studio/src/ai)이 돌린다 — 검문소 · 노드 기본값 · 템플릿이 거기 있다.
 *   여기는: 어느 AI(Claude · Gemini) · 키 · 모델 · 켜기/끄기 · 크기 · 횟수 제한 · 기록(누가 · 얼마나 — 글은 안 남김).
 *   키(사용자 결정 2026-10-21): ★지금은 사람마다 «내 설정»에서 넣는다 — 그 브라우저에만 두고, 부를 때 머리글(x-flowsmith-ai-key)로 실려 와
 *   그대로 넘긴다(서버는 저장 · 기록하지 않는다). 나중에 서버로 옮긴다 — 서버의 키(FLOWSMITH_ANTHROPIC_KEY · FLOWSMITH_GEMINI_KEY ·
 *   PUT /api/ai)도 이미 된다. 둘 다 있으면 사람의 키가 앞선다.
 *   어느 AI(사용자 요청 2026-10-21 «제미나이로도 · 고를 수 있게»): 머리글 x-flowsmith-ai-provider(anthropic · gemini) · x-flowsmith-ai-model.
 *   화면은 늘 Anthropic Messages 모양으로 말하고, Gemini는 ai-gemini.ts가 바꿔 부르고 바꿔 돌려준다.
 *
 * ★모델 부르는 곳은 이 파일의 `#callAnthropic` · `#callGemini` — 다른 회사 · 사내 모델을 더할 때 여기에 하나 더.
 * ★시크릿 값은 애초에 화면에도 없다(이름만).
 */
import type { PluginRepo } from "../storage/plugins.ts";
import type { AiRepo } from "../storage/ai.ts";
import type { SecretBox } from "../storage/secret-box.ts";
import { StoreError } from "../storage/types.ts";
import { forAnthropic, fromGemini, toGemini } from "./ai-gemini.ts";

export type AiProvider = "anthropic" | "gemini";
interface ProviderInfo { label: string; models: readonly string[]; default: string; keyRe: RegExp; keyHint: string; modelRe: RegExp }
export const AI_PROVIDERS: Record<AiProvider, ProviderInfo> = {
  anthropic: { label: "Claude (Anthropic)", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], default: "claude-opus-5-5", keyRe: /^sk-ant-[A-Za-z0-9_-]{20,}$/, keyHint: "sk-ant-…", modelRe: /^claude-[a-z0-9][a-z0-9.-]{0,60}$/ },
  // 2026-10 ai.google.dev 모델 목록 — 새 프로젝트는 3.8 Flash · 3.5 Flash-Lite를 권한다. 이름이 바뀌면 «내 설정»에서 직접 적는다
  // 키 — 옛 AIza… · 새 AQ.…(2026부터 AI Studio가 이것만 낸다). 모양은 느슨하게(Claude 키를 잘못 붙인 것만 막는다)
  gemini: { label: "Gemini (Google)", models: ["gemini-3.8-flash", "gemini-4-argon", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite"], default: "gemini-3.8-flash", keyRe: /^(?!sk-ant-)[A-Za-z0-9._-]{20,400}$/, keyHint: "AIza… 또는 AQ.…", modelRe: /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/ },
};
const isProvider = (p: unknown): p is AiProvider => p === "anthropic" || p === "gemini";

/** 옛 이름 — Claude 모델들 */
export const AI_MODELS = AI_PROVIDERS.anthropic.models;
export const AI_DEFAULT_MODEL = AI_PROVIDERS.anthropic.default;
const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const KEY_SETTING = "ai_key";
const MODEL_SETTING = "ai_model";
const ENABLED_SETTING = "ai_enabled";
/** AI가 사이트 화면을 본다(PLAN §42-8) — 페이지의 글자가 AI 회사로 간다 · ★기본 끔(관리자가 켠다) */
const SITE_VIEW_SETTING = "ai_site_view";
const AAD = "flowsmith:ai-key";
/** 한 번에 보내는 크기 · 받는 글 · 기다리는 시간 · 사람마다 1분에 몇 번 */
const MAX_REQUEST_BYTES = 600 * 1024;
const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 180_000;
const PER_MINUTE = 20;
/**
 * 붐빔 · 한도(사용자 2026-10-22 «503 high demand» → «다시 해 보고 · 사람 말로»): 이 상태면 잠깐 쉬고 다시 부른다.
 * 529는 Claude의 «과부하», 503은 Gemini의 «요청이 몰림», 429는 한도. 그래도 안 되면 붐빈다고 알리고 다른 모델을 권한다
 */
const BUSY = new Set([429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS_MS = [1_000, 3_000];
/** Retry-After가 이보다 길면 기다리지 않는다(화면이 오래 멈춰 보인다) */
const MAX_RETRY_AFTER_MS = 10_000;

export interface AiProviderStatus { label: string; models: readonly string[]; model: string; keyHint: string; serverKey: "env" | "screen" | null }
export interface AiStatus {
  enabled: boolean;
  /** 서버에 키가 있어 그대로 쓸 수 있나(Claude) — 사람의 키가 있으면 그것으로 */
  ready: boolean;
  model: string; models: readonly string[]; key: "env" | "screen" | null;
  providers: Record<AiProvider, AiProviderStatus>;
  /** AI가 사이트 화면을 볼 수 있나(관리자 설정 · 기본 끔) — 페이지의 글자가 AI 회사로 간다 */
  siteView: boolean;
}

export interface AiOptions {
  /** FLOWSMITH_ANTHROPIC_KEY · FLOWSMITH_GEMINI_KEY — 서버에 둘 때(나중) */
  envKey?: string | null;
  envGeminiKey?: string | null;
  /** 시험이 가로챈다 */
  fetch?: typeof fetch;
  endpoint?: string;
  geminiEndpoint?: string;
  /** 붐빌 때 다시 부르기 전에 쉬는 시간들 — 시험은 [0, 0] */
  retryDelaysMs?: readonly number[];
}

/** 다시 해 봐도 붐빌 때의 사람 말 — 원문은 뒤에 붙인다 */
function busyError(label: string, status: number, raw: string): StoreError {
  if (status === 429) return new StoreError(429, `${label}의 사용 한도에 걸렸습니다(429) — 잠시 뒤 다시 보내세요. 계속되면 그 키의 사용 한도 · 결제를 확인하거나 «내 설정»에서 다른 모델을 고르세요 · 원문: ${raw}`);
  return new StoreError(503, `${label}가 지금 붐빕니다(${status}) — 몇 번 다시 해 봤지만 답이 없었습니다. 잠시 뒤 다시 보내거나 «내 설정»에서 다른 모델을 고르세요 · 원문: ${raw}`);
}

/** 모델에 보내는 것 — Anthropic Messages API 모양 그대로(화면이 만든다) */
export interface AiRequest { system: string; messages: unknown[]; tools?: unknown[]; flowId?: string | null }
/** 그 사람이 고른 것 — 머리글로 온다 */
export interface AiChoice { key?: string | null; provider?: string | null; model?: string | null }

type Usage = { input_tokens?: number; output_tokens?: number };

export class Ai {
  readonly #settings: PluginRepo;
  readonly #log: AiRepo;
  readonly #box: SecretBox;
  readonly #o: AiOptions;

  constructor(settings: PluginRepo, log: AiRepo, box: SecretBox, opts: AiOptions = {}) {
    this.#settings = settings;
    this.#log = log;
    this.#box = box;
    this.#o = opts;
  }

  #serverKey(p: AiProvider): string | null {
    if (p === "gemini") return this.#o.envGeminiKey || null;
    if (this.#o.envKey) return this.#o.envKey;
    const sealed = this.#settings.getSetting(KEY_SETTING);
    if (!sealed) return null;
    try { return this.#box.open(sealed, AAD); } catch { return null; }
  }

  get model(): string { const m = this.#settings.getSetting(MODEL_SETTING); return m && AI_PROVIDERS.anthropic.models.includes(m) ? m : AI_DEFAULT_MODEL; }
  get enabled(): boolean { return this.#settings.getSetting(ENABLED_SETTING) !== "off"; }
  get siteView(): boolean { return this.#settings.getSetting(SITE_VIEW_SETTING) === "on"; }

  status(): AiStatus {
    const key = this.#o.envKey ? "env" : this.#settings.getSetting(KEY_SETTING) ? "screen" : null;
    const info = (p: AiProvider, serverKey: AiProviderStatus["serverKey"], model: string): AiProviderStatus =>
      ({ label: AI_PROVIDERS[p].label, models: AI_PROVIDERS[p].models, model, keyHint: AI_PROVIDERS[p].keyHint, serverKey });
    return {
      enabled: this.enabled, ready: this.enabled && this.#serverKey("anthropic") !== null, model: this.model, models: AI_MODELS, key,
      providers: { anthropic: info("anthropic", key, this.model), gemini: info("gemini", this.#o.envGeminiKey ? "env" : null, AI_PROVIDERS.gemini.default) },
      siteView: this.siteView,
    };
  }

  /** 관리자 — (Claude) 서버 키(빈 글자면 지움) · 기본 모델 · 켜기/끄기 */
  configure(p: { apiKey?: unknown; model?: unknown; enabled?: unknown; siteView?: unknown }): AiStatus {
    if (p.siteView !== undefined) {
      if (typeof p.siteView !== "boolean") throw new StoreError(400, "siteView는 참 · 거짓입니다");
      this.#settings.setSetting(SITE_VIEW_SETTING, p.siteView ? "on" : null);
    }
    if (p.apiKey !== undefined) {
      if (typeof p.apiKey !== "string") throw new StoreError(400, "apiKey는 글자입니다");
      const k = p.apiKey.trim();
      if (k !== "" && !AI_PROVIDERS.anthropic.keyRe.test(k)) throw new StoreError(400, "Anthropic API 키 모양이 아닙니다(sk-ant-…)");
      this.#settings.setSetting(KEY_SETTING, k === "" ? null : this.#box.seal(k, AAD));
    }
    if (p.model !== undefined) {
      if (typeof p.model !== "string" || !AI_PROVIDERS.anthropic.models.includes(p.model)) throw new StoreError(400, `모델은 ${AI_MODELS.join(" · ")} 중 하나입니다`);
      this.#settings.setSetting(MODEL_SETTING, p.model);
    }
    if (p.enabled !== undefined) {
      if (typeof p.enabled !== "boolean") throw new StoreError(400, "enabled는 참 · 거짓입니다");
      this.#settings.setSetting(ENABLED_SETTING, p.enabled ? null : "off");
    }
    return this.status();
  }

  /** 화면 대신 모델을 부른다 — Messages 모양으로 돌려준다(도구 반복은 화면이) */
  async messages(req: AiRequest, by: string | null, choice: AiChoice = {}): Promise<unknown> {
    if (!this.enabled) throw new StoreError(403, "AI를 꺼 두었습니다 — 관리자가 켜야 합니다");
    const provider: AiProvider = choice.provider == null || choice.provider === "" ? "anthropic" : isProvider(choice.provider) ? choice.provider : (() => { throw new StoreError(400, `AI는 anthropic · gemini 중 하나입니다(받은 값: ${choice.provider})`); })();
    const info = AI_PROVIDERS[provider];
    const userKey = choice.key ?? null;
    if (userKey !== null && !info.keyRe.test(userKey)) throw new StoreError(400, `${info.label} API 키 모양이 아닙니다(${info.keyHint}) — «내 설정»에서 키를 확인하세요`);
    const key = userKey ?? this.#serverKey(provider);
    if (!key) throw new StoreError(409, `AI 키가 없습니다 — «내 설정»에서 ${info.label} API 키를 넣으세요`);
    const model = choice.model ? choice.model : provider === "anthropic" ? this.model : info.default;
    if (!info.modelRe.test(model)) throw new StoreError(400, `${info.label}의 모델 이름이 아닙니다(받은 값: ${model})`);
    if (typeof req.system !== "string" || !Array.isArray(req.messages) || req.messages.length === 0) throw new StoreError(400, "system · messages가 필요합니다");
    if (req.tools !== undefined && !Array.isArray(req.tools)) throw new StoreError(400, "tools는 목록입니다");
    const size = Buffer.byteLength(JSON.stringify({ s: req.system, m: req.messages, t: req.tools ?? null }));
    if (size > MAX_REQUEST_BYTES) throw new StoreError(413, "AI에게 보낼 내용이 너무 큽니다 — 워크플로우가 너무 크거나 대화가 깁니다(새 대화로 시작하세요)");
    const since = new Date(Date.now() - 60_000).toISOString();
    if (this.#log.aiCallsSince(by, since) >= PER_MINUTE) throw new StoreError(429, "AI를 너무 자주 불렀습니다 — 1분 뒤에 다시 해 보세요");
    const flowId = typeof req.flowId === "string" ? req.flowId.slice(0, 100) : null;
    const log = (ok: boolean, usage: Usage | undefined, error: string | null) =>
      this.#log.logAiCall({ by, flowId, model, inputTokens: Number(usage?.input_tokens ?? 0), outputTokens: Number(usage?.output_tokens ?? 0), ok, error });
    let data: { usage?: Usage };
    try {
      data = provider === "gemini" ? await this.#callGemini(key, model, req) : await this.#callAnthropic(key, model, req);
    } catch (e) {
      log(false, undefined, (e as Error).message.slice(0, 300));
      throw e;
    }
    log(true, data.usage, null);
    return data;
  }

  /** 붐비면(BUSY) 쉬었다가 다시 — 마지막 답을 돌려준다(오류 문장은 부르는 쪽이) */
  async #post(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; ok: boolean; data: Record<string, unknown>; text: string }> {
    const f = this.#o.fetch ?? fetch;
    const delays = this.#o.retryDelaysMs ?? RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        throw new StoreError(502, `AI에 닿지 못했습니다 — ${(e as Error).message}`);
      }
      const text = await res.text();
      if (BUSY.has(res.status) && attempt < delays.length) {
        const after = Number(res.headers.get("retry-after")) * 1000;
        if (!(after > MAX_RETRY_AFTER_MS)) {
          await new Promise((r) => setTimeout(r, Math.max(delays[attempt]!, after || 0)));
          continue;
        }
      }
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* 아래에서 */ }
      return { status: res.status, ok: res.ok, data, text };
    }
  }

  /** ★Claude(Anthropic Messages) — 받은 것 그대로 */
  async #callAnthropic(key: string, model: string, req: AiRequest): Promise<{ usage?: Usage }> {
    const body = JSON.stringify({ model, max_tokens: MAX_TOKENS, system: req.system, messages: forAnthropic(req.messages), ...(req.tools ? { tools: req.tools } : {}) });
    const r = await this.#post(this.#o.endpoint ?? ANTHROPIC, { "x-api-key": key, "anthropic-version": "2023-06-01" }, body);
    if (!r.ok) {
      const why = (r.data["error"] as { message?: string } | undefined)?.message ?? r.text.slice(0, 200);
      if (BUSY.has(r.status)) throw busyError(AI_PROVIDERS.anthropic.label, r.status, why);
      throw new StoreError(r.status === 401 ? 409 : 502, r.status === 401 ? "AI 키가 맞지 않습니다 — «내 설정»에서 키를 확인하세요" : `AI가 답하지 못했습니다(${r.status}) — ${why}`);
    }
    return r.data as { usage?: Usage };
  }

  /** ★Gemini(generateContent) — Messages 모양으로 바꿔 보내고 바꿔 돌려준다(ai-gemini.ts) */
  async #callGemini(key: string, model: string, req: AiRequest): Promise<{ usage?: Usage }> {
    const { body, tools } = toGemini(req, MAX_TOKENS);
    const r = await this.#post(`${this.#o.geminiEndpoint ?? GEMINI}/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, JSON.stringify(body));
    if (!r.ok) {
      const err = (r.data["error"] as { message?: string; status?: string } | undefined) ?? {};
      // ★새 AQ.… 키를 Google이 받지 않는 계정이 있다(커뮤니티에 알려진 일 — ACCESS_TOKEN_TYPE_UNSUPPORTED) · 막힌 키(API_KEY_SERVICE_BLOCKED)
      if (/ACCESS_TOKEN_TYPE_UNSUPPORTED/.test(r.text)) throw new StoreError(409, "Google이 이 키 형식(AQ.…)을 Gemini API에서 받지 않았습니다(ACCESS_TOKEN_TYPE_UNSUPPORTED) — Google 쪽 계정 · 프로젝트 문제로 알려져 있습니다. AI Studio에서 다른 프로젝트로 키를 다시 만들어 보거나, 안 되면 Claude를 쓰세요");
      if (/API_KEY_SERVICE_BLOCKED/.test(r.text)) throw new StoreError(409, "이 키로는 Gemini API를 쓸 수 없게 막혀 있습니다(API_KEY_SERVICE_BLOCKED) — Google Cloud 콘솔에서 그 키의 API 제한에 Generative Language API를 넣거나 키를 다시 만드세요");
      if (BUSY.has(r.status)) throw busyError(AI_PROVIDERS.gemini.label, r.status, err.message ?? r.text.slice(0, 200));
      const badKey = r.status === 401 || r.status === 403 || /API key not valid|API_KEY_INVALID/i.test(err.message ?? r.text);
      throw new StoreError(badKey ? 409 : 502, badKey ? "AI 키가 맞지 않습니다 — «내 설정»에서 Gemini 키를 확인하세요" : `AI가 답하지 못했습니다(${r.status}) — ${err.message ?? r.text.slice(0, 200)}`);
    }
    const out = fromGemini(r.data, tools);
    if (out.content.length === 0) {
      const block = (r.data["promptFeedback"] as { blockReason?: string } | undefined)?.blockReason;
      throw new StoreError(502, `Gemini가 빈 답을 돌려주었습니다${block ? `(막힘: ${block})` : ""} — 다시 해 보거나 다른 모델을 고르세요`);
    }
    return out;
  }

  usage(days?: number) { return this.#log.aiUsage(days); }
}
