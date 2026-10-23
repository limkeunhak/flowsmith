/**
 * **다른 플로우 실행 노드** — 행마다(또는 한 번) 다른 플로우를 돌린다(PLAN §11). 실행은 엔진의 callFlow 갈고리 → 서버.
 */

export interface FlowCallConfig {
  /** 부를 플로우의 id */
  flowId: string;
  /** 게시된 버전 · 초안 */
  version: "active" | "draft";
  /** 행들 — 「{{ $input.rows }}」. 비우면 한 번만 돈다 */
  items: string;
  /** 그 플로우의 실행 입력 — 이름 → 값(표현식, `$item`을 쓸 수 있다) */
  params: Record<string, string>;
  /** 동시에 몇 개까지(1~5) */
  concurrency: number;
  /** 하나가 실패하면 — 멈춘다(노드가 실패) · 계속한다(결과에 실패로 남긴다) */
  onError: "stop" | "continue";
}

export const FLOW_CALL_OUTPUTS = ["results", "succeeded", "failed"] as const;
export const MAX_CALL_CONCURRENCY = 5;
