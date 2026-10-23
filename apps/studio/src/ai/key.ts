/**
 * **내 AI** — «내 설정»에서 고르는 AI(Claude · Gemini)와 그 키 · 모델(사용자 결정 2026-10-21: 지금은 사람마다 · 나중에 서버로 옮긴다).
 * ★이 브라우저에만 둔다(localStorage) — AI를 부를 때만 머리글(x-flowsmith-ai-provider · x-flowsmith-ai-key · x-flowsmith-ai-model)로 서버에 실려 가고,
 *  서버는 저장 · 기록하지 않고 넘긴다. 저장소가 막혀 있으면(사생활 창 등) 없는 것으로 본다.
 */
export type AiProvider = "anthropic" | "gemini";
export const AI_PROVIDER_LIST: AiProvider[] = ["anthropic", "gemini"];
/** Gemini 키 — 옛 AIza… · 새 AQ.…(2026부터) 둘 다 · 모양은 느슨하게(Claude 키를 잘못 붙인 것만 막는다 — 서버와 같다) */
export const AI_KEY_RE: Record<AiProvider, RegExp> = { anthropic: /^sk-ant-[A-Za-z0-9_-]{20,}$/, gemini: /^(?!sk-ant-)[A-Za-z0-9._-]{20,400}$/ };
export const AI_KEY_HINT: Record<AiProvider, { label: string; hint: string; console: string }> = {
  anthropic: { label: "Claude (Anthropic)", hint: "sk-ant-…", console: "console.anthropic.com" },
  gemini: { label: "Gemini (Google)", hint: "AIza… 또는 AQ.…", console: "aistudio.google.com" },
};
export const AI_MODEL_RE: Record<AiProvider, RegExp> = { anthropic: /^claude-[a-z0-9][a-z0-9.-]{0,60}$/, gemini: /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/ };

const PROVIDER = "flowsmith:ai-provider";
/** 키 — Claude는 옛 이름 그대로(이미 넣은 키를 잃지 않게) */
const KEY: Record<AiProvider, string> = { anthropic: "flowsmith:ai-key", gemini: "flowsmith:ai-key:gemini" };
const MODEL: Record<AiProvider, string> = { anthropic: "flowsmith:ai-model:anthropic", gemini: "flowsmith:ai-model:gemini" };

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null): void => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 저장소가 막혔다 */ } };

/** 고른 AI · 모델이 바뀌었다 — «내 설정»과 AI 창의 고르기가 서로 따라가게 */
export const AI_CHOICE_EVENT = "flowsmith:ai-choice";
const changed = (): void => { try { dispatchEvent(new Event(AI_CHOICE_EVENT)); } catch { /* 창이 없다(시험) */ } };

export function myAiProvider(): AiProvider { return read(PROVIDER) === "gemini" ? "gemini" : "anthropic"; }
export function setMyAiProvider(p: AiProvider): void { write(PROVIDER, p === "anthropic" ? null : p); changed(); }

export function myAiKey(p: AiProvider = myAiProvider()): string | null { const v = read(KEY[p]); return v && AI_KEY_RE[p].test(v) ? v : null; }
export function setMyAiKey(p: AiProvider, v: string | null): void { write(KEY[p], v); changed(); }

/** 고른 모델 — 없으면 서버의 기본 */
export function myAiModel(p: AiProvider = myAiProvider()): string | null { const v = read(MODEL[p]); return v && AI_MODEL_RE[p].test(v) ? v : null; }
export function setMyAiModel(p: AiProvider, v: string | null): void { write(MODEL[p], v); changed(); }

/** 화면에 보일 모양 — 앞 · 뒤 몇 글자만 */
export const maskKey = (k: string): string => `${k.slice(0, 10)}…${k.slice(-4)}`;
