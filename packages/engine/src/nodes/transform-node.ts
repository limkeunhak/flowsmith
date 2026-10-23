/**
 * **값 다듬기 노드** (core nodes/transform.ts) — 목록을 받아 단계대로 다듬고 `{ rows, count, first }`를 내놓는다.
 * 다듬는 일은 core의 `applyTransform`(순수 — 편집 화면의 미리 보기와 같은 함수)이 한다. 여기는 표현식을 채운다.
 */
import { applyTransform, evaluate, type Output, type Scope, type TransformNode, type TransformStep } from "@flowsmith/core";

export class TransformNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransformNodeError";
  }
}

export function runTransformNode(node: TransformNode, scope: Scope, log: (text: string) => void, now = new Date()): Output {
  const noSecrets: Scope = { ...scope, secrets: {} };
  const c = node.config;
  const source = evaluate(c.source, noSecrets).value;
  if (source === undefined) throw new TransformNodeError(`다듬을 목록이 없습니다 — ${c.source}`);
  // 거르기의 비교 값은 표현식일 수 있다(실행 입력 · 변수) — 여기서 한 번 채운다
  const steps: TransformStep[] = c.steps.map((s) => s.kind !== "filter" ? s : {
    ...s, rules: s.rules.map((r) => ({ ...r, value: r.value === null ? null : String(evaluate(r.value, noSecrets).value ?? "") })),
  });
  const { rows, notes } = applyTransform(source, steps, now);
  for (const n of notes) log(n);
  log(`${rows.length}행을 내보냅니다`);
  return { rows, count: rows.length, first: rows[0] ?? null };
}
