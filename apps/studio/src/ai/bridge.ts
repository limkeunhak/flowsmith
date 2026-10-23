/**
 * **AI 다리** — 떠 있는 AI 창(AiDock)과 지금 화면을 잇는다.
 *   편집 화면이 «지금 초안 · 적용 · 캔버스 미리 보기»를 걸어 두면 AI 창은 고치기(edit)로, 없으면 새로 만들기(create)로 돈다.
 *   대화는 대상마다(create · flow:<id>) 따로 기억한다 — 화면을 오가도 이어진다(이 탭이 살아 있는 동안).
 */
import { useSyncExternalStore } from "react";
import type { Flow } from "@flowsmith/core";

export interface EditTarget {
  flowId: string;
  draft: Flow;
  apply(f: Flow): void;
  /** 캔버스에 미리 그린다(null이면 걷는다) — 바뀐 노드에 색 테두리 */
  preview(f: Flow | null): void;
  /** 지금 캔버스에 미리 그리고 있는 제안 */
  previewing: Flow | null;
}

interface State { open: boolean; target: EditTarget | null }

let state: State = { open: false, target: null };
const applied = new WeakSet<Flow>();
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const aiBridge = {
  get: () => state,
  open: (open = true) => set({ open }),
  toggle: () => set({ open: !state.open }),
  setTarget: (target: EditTarget | null) => set({ target }),
  /** 적용한 제안 — 캔버스 띄의 «적용»으로 했어도 채팅 카드가 안다 */
  markApplied: (f: Flow) => { applied.add(f); set({}); },
  wasApplied: (f: Flow) => applied.has(f),
};

export function useAiBridge(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
