/**
 * **값 다듬기** 설정 — 무엇을(목록) · 어떻게(단계들). 코드 없이.
 * ★마지막 실행에서 이 노드가 받을 값이 있으면 **바로 미리 본다** — core의 applyTransform(실행과 같은 함수)으로.
 */
import { useState } from "react";
import {
  applyTransform, CONDITION_OPS, evaluate, FORMAT_KINDS, FORMAT_LABEL, newStep, toRows, TRANSFORM_STEP_KINDS, TRANSFORM_STEP_LABEL, UNARY_OPS,
  type ConditionOp, type Flow, type FormatKind, type TransformNode, type TransformStep, type TransformStepKind,
} from "@flowsmith/core";
import { describeStep, inputsOf, OP_WORD, producerOf } from "../../model/index.ts";
import { IconChevronDown, IconChevronUp, IconX } from "../../icons.tsx";
import { Field, TemplateInput } from "../widgets.tsx";
import { DataTable } from "../run/ResultView.tsx";

type Update = (fn: (n: TransformNode) => TransformNode) => void;

/** 행에서 쓸 수 있는 거르기 연산 — 사람이 고르기 쉬운 순서로 */
const FILTER_OPS: ConditionOp[] = ["contains", "notContains", "eq", "ne", "startsWith", "endsWith", "notEmpty", "empty", "gt", "gte", "lt", "lte", "matches"];
const LIST_NAMES = ["rows", "results", "items", "list", "목록"];

const show = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function TransformInspector({ flow, node, update, sample }: { flow: Flow; node: TransformNode; update: Update; sample: Record<string, unknown> | null }) {
  const c = node.config;
  const set = (patch: Partial<TransformNode["config"]>) => update((n) => ({ ...n, config: { ...n.config, ...patch } }));
  const setSteps = (fn: (s: TransformStep[]) => TransformStep[]) => update((n) => ({ ...n, config: { ...n.config, steps: fn(n.config.steps) } }));
  const setStep = (i: number, s: TransformStep) => setSteps((ss) => ss.map((x, j) => (j === i ? s : x)));
  const [open, setOpen] = useState<number | null>(c.steps.length ? null : -1);

  // 미리 보기 — 마지막 실행에서 받을 값으로
  const scope = { input: sample ?? {}, nodes: {}, params: flow.settings.probeParams, vars: flow.vars, secrets: {} };
  let preview: { before: number; rows: Record<string, unknown>[]; notes: string[] } | { error: string } | null = null;
  let sourceRows: Record<string, unknown>[] = [];
  if (sample && c.source.trim()) {
    try {
      const src = evaluate(c.source, scope).value;
      sourceRows = toRows(src);
      const steps = c.steps.map((s) => s.kind !== "filter" ? s : { ...s, rules: s.rules.map((r) => ({ ...r, value: r.value === null ? null : show(evaluate(r.value, scope).value) })) });
      const r = applyTransform(src, steps);
      preview = { before: sourceRows.length, rows: r.rows, notes: r.notes };
    } catch (e) { preview = { error: e instanceof Error ? e.message : String(e) }; }
  }

  // 고를 수 있는 칸 — 받은 행들 + 앞 노드의 표 읽기 열 이름
  const fields = new Set<string>();
  for (const r of sourceRows.slice(0, 30)) for (const k of Object.keys(r)) fields.add(k);
  const srcField = /\$input\.([^\s.}]+)/.exec(c.source)?.[1];
  const producer = srcField ? producerOf(flow, node.id, srcField) : null;
  if (producer?.type === "web") for (const a of producer.config.actions) if (a.kind === "readTable" && a.output === srcField) for (const col of a.table.columns) if (col.name) fields.add(col.name);
  // 단계가 이름을 바꾸면 그 뒤에서는 새 이름도
  for (const s of c.steps) if (s.kind === "pick") for (const f of s.fields) if (f.to.trim()) fields.add(f.to.trim());
  const fieldList = [...fields];
  const listId = `tf-fields-${node.id}`;
  const listInput = inputsOf(flow, node.id).find((x) => LIST_NAMES.includes(x)) ?? inputsOf(flow, node.id)[0];

  const valuesOf = (field: string) => [...new Set(sourceRows.map((r) => show(r[field]).trim()).filter((v) => v !== ""))].slice(0, 30);

  return (
    <>
      <datalist id={listId}>{fieldList.map((f) => <option key={f} value={f} />)}</datalist>
      <Field label="다듬을 목록">
        <TemplateInput flow={flow} nodeId={node.id} value={c.source} placeholder="앞 단계의 목록을 ＋로 고르세요" onChange={(source) => set({ source })} />
      </Field>
      {c.source.trim() === "" && listInput && (
        <button className="small" style={{ alignSelf: "flex-start" }} onClick={() => set({ source: `{{ $input.${listInput} }}` })}>앞 단계의 「{listInput}」 쓰기</button>
      )}

      <h3>단계 — 위에서부터 차례로</h3>
      {c.steps.length === 0 && <span className="small muted">아래에서 할 일을 고르세요. 단계가 없으면 받은 목록을 그대로 내보냅니다.</span>}
      {c.steps.map((s, i) => (
        <div key={i} className="tf-step">
          <div className="tf-step-head">
            <span className="num">{i + 1}</span>
            <button className="ghost tf-step-title" onClick={() => setOpen(open === i ? null : i)}>
              <b className="small">{TRANSFORM_STEP_LABEL[s.kind]}</b><span className="small muted">{describeStep(s)}</span>
            </button>
            <button className="icon-btn" title="위로" disabled={i === 0} onClick={() => setSteps((ss) => { const n = [...ss]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; })}><IconChevronUp size={14} /></button>
            <button className="icon-btn" title="아래로" disabled={i === c.steps.length - 1} onClick={() => setSteps((ss) => { const n = [...ss]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; })}><IconChevronDown size={14} /></button>
            <button className="icon-btn" title="단계 지우기" onClick={() => { setSteps((ss) => ss.filter((_, j) => j !== i)); setOpen(null); }}><IconX size={14} /></button>
          </div>
          {open === i && <div className="tf-step-body"><StepEditor flow={flow} nodeId={node.id} step={s} onChange={(x) => setStep(i, x)} fields={fieldList} listId={listId} valuesOf={valuesOf} /></div>}
        </div>
      ))}
      <div className="chips">
        <span className="small muted">＋ 단계:</span>
        {TRANSFORM_STEP_KINDS.map((k: TransformStepKind) => (
          <button key={k} onClick={() => { setSteps((ss) => [...ss, newStep(k)]); setOpen(c.steps.length); }}>{TRANSFORM_STEP_LABEL[k]}</button>
        ))}
      </div>

      <h3>미리 보기</h3>
      {!sample && <span className="small muted">왼쪽 입력 칸의 «앞 단계까지 실행»을 누르면 여기에서 다듬은 결과를 바로 봅니다.</span>}
      {sample && !c.source.trim() && <span className="small muted">다듬을 목록을 고르세요</span>}
      {preview && "error" in preview && <div className="banner bad small">{preview.error}</div>}
      {preview && "rows" in preview && (
        <>
          <div className="small"><b>{preview.before}행 → {preview.rows.length}행</b>{preview.notes.length > 0 && <span className="muted"> · {preview.notes.join(" · ")}</span>}</div>
          <DataTable rows={preview.rows} limit={8} />
        </>
      )}
      <span className="small muted">
        내보내는 것: <code>rows</code>(다듬은 목록) · <code>count</code>(행 수) · <code>first</code>(첫 행 — 한 건만 쓸 때). 숫자 · 날짜로 못 읽은 값은 지어내지 않고 기록에 몇 개였는지 남깁니다.
      </span>
    </>
  );
}

/** 칸 이름 — 받은 행의 칸들이 목록으로 뜬다 */
function FieldInput({ listId, value, onChange }: { listId: string; value: string; onChange: (v: string) => void }) {
  return <input list={listId} value={value} placeholder="칸 이름" onChange={(e) => onChange(e.target.value)} />;
}

function StepEditor({ flow, nodeId, step: s, onChange, fields, listId, valuesOf }: {
  flow: Flow; nodeId: string; step: TransformStep; onChange: (s: TransformStep) => void; fields: string[]; listId: string; valuesOf: (field: string) => string[];
}) {
  switch (s.kind) {
    case "pick":
      return (
        <>
          {s.fields.map((f, i) => (
            <div key={i} className="row">
              <div className="grow"><FieldInput listId={listId} value={f.from} onChange={(v) => onChange({ ...s, fields: s.fields.map((x, j) => (j === i ? { ...x, from: v } : x)) })} /></div>
              <span className="muted">→</span>
              <input className="grow" value={f.to} placeholder="새 이름(비우면 그대로)" onChange={(e) => onChange({ ...s, fields: s.fields.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
              <button className="small ghost" onClick={() => onChange({ ...s, fields: s.fields.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row">
            <button className="small" onClick={() => onChange({ ...s, fields: [...s.fields, { from: "", to: "" }] })}>＋ 칸</button>
            {fields.length > 0 && <button className="small ghost" onClick={() => onChange({ ...s, fields: fields.map((f) => ({ from: f, to: "" })) })}>보이는 칸 모두 넣기</button>}
          </div>
          <span className="small muted">여기 넣은 칸만, 이 순서로 남습니다. 파일 쓰기의 열 순서도 이대로 됩니다.</span>
        </>
      );
    case "filter":
      return (
        <>
          <div className="row wrap">
            <label className="check"><input type="radio" checked={s.match === "all"} onChange={() => onChange({ ...s, match: "all" })} />모두 맞는 행</label>
            <label className="check"><input type="radio" checked={s.match === "any"} onChange={() => onChange({ ...s, match: "any" })} />하나라도 맞는 행</label>
          </div>
          {s.rules.map((r, i) => {
            const setR = (patch: Partial<typeof r>) => onChange({ ...s, rules: s.rules.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={i} className="subcard" style={{ padding: 8, gap: 6 }}>
                <div className="row">
                <div className="grow"><FieldInput listId={listId} value={r.field} onChange={(field) => setR({ field })} /></div>
                <select style={{ width: 130 }} value={r.op} onChange={(e) => { const op = e.target.value as ConditionOp; setR({ op, value: UNARY_OPS.includes(op) ? null : r.value ?? "" }); }}>
                  {FILTER_OPS.filter((o) => (CONDITION_OPS as readonly string[]).includes(o)).map((o) => <option key={o} value={o}>{OP_WORD[o]}</option>)}
                </select>
                <button className="small ghost" onClick={() => onChange({ ...s, rules: s.rules.filter((_, j) => j !== i) })}>✕</button>
                </div>
                {r.value !== null && <TemplateInput flow={flow} nodeId={nodeId} value={r.value} placeholder="견줄 값" onChange={(value) => setR({ value })} />}
              </div>
            );
          })}
          <button className="small" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ ...s, rules: [...s.rules, { field: "", op: "contains", value: "" }] })}>＋ 조건</button>
          <span className="small muted">예: 「제목」에 포함 「날씨」 · 「금액」 ≥ 10000. 숫자 비교는 1,234원처럼 써 있어도 숫자로 읽습니다.</span>
        </>
      );
    case "dedupe":
      return (
        <>
          <div className="chips">
            {fields.map((f) => (
              <button key={f} className={s.fields.includes(f) ? "on" : ""} onClick={() => onChange({ ...s, fields: s.fields.includes(f) ? s.fields.filter((x) => x !== f) : [...s.fields, f] })}>{f}</button>
            ))}
          </div>
          {fields.length === 0 && <FieldInput listId={listId} value={s.fields.join(",")} onChange={(v) => onChange({ ...s, fields: v.split(",").map((x) => x.trim()).filter(Boolean) })} />}
          <span className="small muted">고른 칸이 같으면 같은 행으로 봅니다(앞의 것을 남깁니다). 고르지 않으면 모든 칸이 같을 때만.</span>
        </>
      );
    case "map":
      return (
        <>
          <Field label="바꿀 칸"><FieldInput listId={listId} value={s.field} onChange={(field) => onChange({ ...s, field })} /></Field>
          {s.table.map((e, i) => (
            <div key={i} className="row">
              <input className="grow" value={e.from} placeholder="이 값이면" onChange={(x) => onChange({ ...s, table: s.table.map((y, j) => (j === i ? { ...y, from: x.target.value } : y)) })} />
              <span className="muted">→</span>
              <input className="grow" value={e.to} placeholder="이렇게" onChange={(x) => onChange({ ...s, table: s.table.map((y, j) => (j === i ? { ...y, to: x.target.value } : y)) })} />
              <button className="small ghost" onClick={() => onChange({ ...s, table: s.table.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row">
            <button className="small" onClick={() => onChange({ ...s, table: [...s.table, { from: "", to: "" }] })}>＋ 줄</button>
            {s.field && valuesOf(s.field).length > 0 && (
              <button className="small ghost" onClick={() => {
                const have = new Set(s.table.map((e) => e.from.trim()));
                onChange({ ...s, table: [...s.table.filter((e) => e.from.trim()), ...valuesOf(s.field).filter((v) => !have.has(v)).map((v) => ({ from: v, to: "" }))] });
              }}>보이는 값 가져오기</button>
            )}
          </div>
          <div className="row wrap">
            <span className="small muted">표에 없는 값은</span>
            <label className="check"><input type="radio" checked={s.otherwise === "keep"} onChange={() => onChange({ ...s, otherwise: "keep" })} />그대로</label>
            <label className="check"><input type="radio" checked={s.otherwise === "empty"} onChange={() => onChange({ ...s, otherwise: "empty" })} />비움</label>
            <label className="check"><input type="radio" checked={s.otherwise === "fixed"} onChange={() => onChange({ ...s, otherwise: "fixed" })} />이 값으로</label>
            {s.otherwise === "fixed" && <input style={{ width: 120 }} value={s.fixed} onChange={(e) => onChange({ ...s, fixed: e.target.value })} />}
          </div>
        </>
      );
    case "format":
      return (
        <>
          <Field label="다듬을 칸"><FieldInput listId={listId} value={s.field} onChange={(field) => onChange({ ...s, field })} /></Field>
          <div className="stack" style={{ gap: 4 }}>
            {FORMAT_KINDS.map((k: FormatKind) => <label key={k} className="check"><input type="radio" checked={s.as === k} onChange={() => onChange({ ...s, as: k })} />{FORMAT_LABEL[k]}</label>)}
          </div>
          {s.as === "replace" && (
            <div className="row">
              <input className="grow" value={s.find} placeholder="이 글자를" onChange={(e) => onChange({ ...s, find: e.target.value })} />
              <span className="muted">→</span>
              <input className="grow" value={s.replace} placeholder="이 글자로(비우면 지움)" onChange={(e) => onChange({ ...s, replace: e.target.value })} />
            </div>
          )}
        </>
      );
    case "sort":
      return (
        <div className="row wrap">
          <div style={{ width: 160 }}><FieldInput listId={listId} value={s.field} onChange={(field) => onChange({ ...s, field })} /></div>
          <label className="check"><input type="radio" checked={s.order === "asc"} onChange={() => onChange({ ...s, order: "asc" })} />작은 것부터(가나다 · 1 2 3)</label>
          <label className="check"><input type="radio" checked={s.order === "desc"} onChange={() => onChange({ ...s, order: "desc" })} />큰 것부터</label>
        </div>
      );
    case "limit":
      return (
        <Field label="앞에서 몇 개만">
          <input type="number" min={1} style={{ width: 100 }} value={s.count} onChange={(e) => onChange({ ...s, count: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
      );
  }
}
