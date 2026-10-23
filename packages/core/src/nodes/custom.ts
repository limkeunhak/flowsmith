/** **커스텀 노드** — 사용자가 쓴 async 함수 몸통(엔진 custom-node.ts가 돌린다) (PLAN §3.6) */
export interface CustomConfig {
  /** `async (input, ctx) => 객체`의 본문 */
  code: string;
  /** 돌려주는 객체에서 내보낼 이름들. 뒤 노드의 `$input.x` 검사가 이걸 본다 */
  outputs: string[];
  /** page를 쓰는가 — 쓰면 점검 실행이 여기서 멈춘다(무엇을 누를지 미리 알 수 없다) */
  usesPage: boolean;
  timeoutMs: number | null;
}
