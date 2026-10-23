/**
 * **검사** 설정 — 항목마다 실제값(앞 노드의 값) · 견주는 법 · 기대값. 하나가 틀려도 나머지를 다 보고, 하나라도 틀리면 «불통과».
 * 불통과면 그때의 페이지를 한 장 찍어 실행 기록에 남긴다.
 */
import { CHECK_LIST_OPS, CHECK_OP_LABEL, CHECK_OPS, CHECK_UNARY_OPS, type CheckItem, type CheckNode, type CheckOp, type Flow } from "@flowsmith/core";
import { inputsOf, nextId } from "../../model/index.ts";
import { IconX } from "../../icons.tsx";
import { TemplateInput } from "../widgets.tsx";

type Update = (fn: (n: CheckNode) => CheckNode) => void;

const OP_GROUPS: { label: string; ops: readonly CheckOp[] }[] = [
  { label: "글자", ops: ["eq", "ne", "contains", "notContains", "startsWith", "endsWith", "matches"] },
  { label: "숫자", ops: ["gt", "gte", "lt", "lte"] },
  { label: "있음 · 참거짓", ops: ["notEmpty", "empty", "isTrue", "isFalse"] },
  { label: "목록(표 읽기)", ops: CHECK_LIST_OPS },
];

export function CheckInspector({ flow, node, update }: { flow: Flow; node: CheckNode; update: Update }) {
  const items = node.config.items;
  const set = (fn: (xs: CheckItem[]) => CheckItem[]) => update((n) => ({ ...n, config: { ...n.config, items: fn(n.config.items) } }));
  const setOne = (id: string, patch: Partial<CheckItem>) => set((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const inputs = inputsOf(flow, node.id).filter((f) => !items.some((it) => it.actual === `{{ $input.${f} }}`));
  const add = (actual = "", label = "") => set((xs) => [...xs, { id: nextId("k", xs.map((x) => x.id)), label, actual, op: "notEmpty", expected: null }]);

  return (
    <>
      <span className="small muted">항목마다 앞 노드의 값이 기대대로인지 봅니다. ★하나가 틀려도 나머지를 다 보고, 하나라도 틀리면 <b>불통과</b>로 멈춥니다(그때의 페이지를 한 장 찍어 둡니다).</span>
      {items.map((it, i) => {
        const unary = CHECK_UNARY_OPS.includes(it.op);
        return (
          <div key={it.id} className="subcard check-item">
            <div className="row">
              <span className="step-n">{i + 1}</span>
              <input className="grow" placeholder="이름 — 예: 첫 금액" value={it.label} aria-label="검사 이름" onChange={(e) => setOne(it.id, { label: e.target.value })} />
              <button className="icon-btn" title="이 검사 빼기" onClick={() => set((xs) => xs.filter((x) => x.id !== it.id))}><IconX size={14} /></button>
            </div>
            <TemplateInput flow={flow} nodeId={node.id} value={it.actual} placeholder="실제값 — {{ $input.firstPremium }}" onChange={(actual) => setOne(it.id, { actual })} />
            <div className="row">
              <select value={it.op} aria-label="견주는 법" style={{ width: "auto" }} onChange={(e) => {
                const op = e.target.value as CheckOp;
                setOne(it.id, { op, expected: CHECK_UNARY_OPS.includes(op) ? null : it.expected ?? "" });
              }}>
                {OP_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.ops.map((o) => <option key={o} value={o}>{CHECK_OP_LABEL[o]}</option>)}</optgroup>)}
              </select>
              {!unary && <div className="grow"><TemplateInput flow={flow} nodeId={node.id} value={it.expected ?? ""} placeholder={(CHECK_LIST_OPS as readonly string[]).includes(it.op) && it.op.startsWith("count") ? "행 수 — 3" : "기대값"} onChange={(expected) => setOne(it.id, { expected })} /></div>}
            </div>
          </div>
        );
      })}
      <div className="row wrap">
        <button className="small" onClick={() => add()}>＋ 검사</button>
        {inputs.length > 0 && <button className="small ghost" title="앞 노드가 넘기는 값마다 «비어 있지 않다» 검사를 더합니다 — 기대값은 고쳐 쓰세요" onClick={() => { for (const f of inputs) add(`{{ $input.${f} }}`, f); }}>앞 값마다 «있다» 검사 더하기</button>}
      </div>
      <span className="small muted">
        숫자 비교는 «12,500원»처럼 쉼표 · 원이 붙어도 숫자로 읽습니다. 목록(표 읽기)은 «행 수» · «이 값인 칸이 있다»로 봅니다.
        통과하면 받은 값을 그대로 넘기고 <code>checksPassed</code>(맞은 수)를 더합니다. ★변경 감시(점검)는 검사하지 않습니다.
      </span>
    </>
  );
}
