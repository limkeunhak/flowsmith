/**
 * 이 브라우저가 기억하는 것 — 편의만(실행 입력 · 접기 · 화면 색 · 기간 …).
 * ★사생활 창 · 막힌 저장소에서는 읽기 · 쓰기가 던진다 — 여기서 삼키고 기본값으로 간다. 기억 못 해도 화면은 돈다.
 */

export function recall(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** 지운다면 null */
export function remember(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* 기억 못 해도 된다 */ }
}

export function recallJson<T>(key: string, fallback: T): T {
  const v = recall(key);
  if (v === null) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

export const rememberJson = (key: string, value: unknown): void => remember(key, JSON.stringify(value));

/** 플로우마다 지난번 실행 입력 — 실행 단추 · 녹화 · 단계 실행이 함께 쓴다 */
const paramsKey = (flowId: string) => `flowsmith:params:${flowId}`;
export const recallParams = (flowId: string): Record<string, string> => recallJson<Record<string, string>>(paramsKey(flowId), {});
export const rememberParams = (flowId: string, params: Record<string, string>): void => rememberJson(paramsKey(flowId), params);
