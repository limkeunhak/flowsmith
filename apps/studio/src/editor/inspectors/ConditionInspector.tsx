/** 조건 노드 — 갈래 · 규칙 · 그다음 */
import {
  CONDITION_OPS, UNARY_OPS, type ConditionCase, type ConditionNode, type ConditionOp, type Flow, type Rule, type Then,
} from "@flowsmith/core";
import { nextId } from "../../model/index.ts";
import { TemplateInput } from "../widgets.tsx";

type Update<T> = (fn: (n: T) => T) => void;

// ─── 조건 ───────────────────────────────────────────────────────────

export const OP_LABEL: Record<ConditionOp, string> = {
  eq: "같다", ne: "다르다", contains: "포함한다", notContains: "포함하지 않는다", startsWith: "~로 시작한다", endsWith: "~로 끝난다",
  matches: "정규식에 맞는다", empty: "비어 있다", notEmpty: "비어 있지 않다", gt: "보다 크다", gte: "이상이다", lt: "보다 작다", lte: "이하다",
  isTrue: "참이다", isFalse: "거짓이다",
};

function ThenEditor({ then, onChange }: { then: Then; onChange: (t: Then) => void }) {
  return (
    <div className="row wrap">
      <select style={{ width: 150 }} value={then.kind === "next" ? "next" : `end-${then.status}`} onChange={(e) => {
        const v = e.target.value;
        onChange(v === "next" ? { kind: "next" } : { kind: "end", status: v === "end-success" ? "success" : "failure", message: then.kind === "end" ? then.message : "" });
      }}>
        <option value="next">다음 노드로</option>
        <option value="end-success">워크플로우 종료(성공)</option>
        <option value="end-failure">워크플로우 종료(실패)</option>
      </select>
      {then.kind === "end" && <input className="grow" placeholder="남길 말" value={then.message} onChange={(e) => onChange({ ...then, message: e.target.value })} />}
    </div>
  );
}

export function ConditionInspector({ flow, node, update }: { flow: Flow; node: ConditionNode; update: Update<ConditionNode> }) {
  const setCases = (fn: (c: ConditionCase[]) => ConditionCase[]) => update((n) => ({ ...n, config: { ...n.config, cases: fn(n.config.cases) } }));
  const setCase = (id: string, fn: (c: ConditionCase) => ConditionCase) => setCases((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const setRule = (cid: string, i: number, fn: (r: Rule) => Rule) => setCase(cid, (c) => ({ ...c, rules: c.rules.map((r, j) => (j === i ? fn(r) : r)) }));

  return (
    <>
      <span className="small muted">위에서부터 처음 맞는 갈래로 갑니다. 아무것도 안 맞으면 「그 밖」.</span>
      {node.config.cases.map((c, ci) => (
        <div key={c.id} className="subcard">
          <div className="row">
            <input className="grow" value={c.label} placeholder="갈래 이름" onChange={(e) => setCase(c.id, (x) => ({ ...x, label: e.target.value }))} />
            <select style={{ width: 130 }} value={c.match} onChange={(e) => setCase(c.id, (x) => ({ ...x, match: e.target.value as "all" | "any" }))}>
              <option value="all">모두 맞으면</option>
              <option value="any">하나라도 맞으면</option>
            </select>
            <button className="small ghost" disabled={ci === 0} onClick={() => setCases((cs) => { const x = [...cs]; [x[ci - 1], x[ci]] = [x[ci]!, x[ci - 1]!]; return x; })}>↑</button>
            <button className="small ghost danger" title="갈래 지우기 — 그 갈래에서 나가던 연결도 지워집니다"
              onClick={() => setCases((cs) => cs.filter((x) => x.id !== c.id))}>✕</button>
          </div>
          {c.rules.map((r, i) => (
            <div key={i} className="stack" style={{ gap: 4, paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
              <TemplateInput flow={flow} nodeId={node.id} value={r.left} placeholder="{{ $input.status }}" onChange={(left) => setRule(c.id, i, (x) => ({ ...x, left }))} />
              <div className="row">
                <select value={r.op} onChange={(e) => {
                  const op = e.target.value as ConditionOp;
                  setRule(c.id, i, (x) => ({ ...x, op, right: UNARY_OPS.includes(op) ? null : (x.right ?? "") }));
                }}>
                  {CONDITION_OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                </select>
                {c.rules.length > 1 && <button className="small ghost" onClick={() => setCase(c.id, (x) => ({ ...x, rules: x.rules.filter((_, j) => j !== i) }))}>규칙 빼기</button>}
              </div>
              {r.right !== null && <TemplateInput flow={flow} nodeId={node.id} value={r.right} placeholder="비교할 값" onChange={(right) => setRule(c.id, i, (x) => ({ ...x, right }))} />}
            </div>
          ))}
          <button className="small" onClick={() => setCase(c.id, (x) => ({ ...x, rules: [...x.rules, { left: "", op: "eq", right: "" }] }))}>＋ 규칙</button>
          <span className="small muted">맞으면</span>
          <ThenEditor then={c.then} onChange={(then) => setCase(c.id, (x) => ({ ...x, then }))} />
        </div>
      ))}
      <button onClick={() => setCases((cs) => [...cs, {
        id: nextId("case", cs.map((x) => x.id)), label: `갈래 ${cs.length + 1}`, match: "all", rules: [{ left: "", op: "eq", right: "" }], then: { kind: "next" },
      }])}>＋ 갈래 더하기</button>
      <div className="subcard">
        <strong>그 밖 (아무 갈래도 안 맞으면)</strong>
        <ThenEditor then={node.config.else.then} onChange={(then) => update((n) => ({ ...n, config: { ...n.config, else: { then } } }))} />
      </div>
    </>
  );
}

