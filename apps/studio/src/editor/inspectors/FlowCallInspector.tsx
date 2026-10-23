/**
 * **다른 플로우 실행** 설정 — 어느 플로우를 · 어떤 버전으로 · 행마다(또는 한 번) · 그 플로우의 실행 입력에 무엇을.
 * 행마다 돌면 실행 입력에 `{{ $item.열이름 }}`을 쓴다 — 그 행의 값.
 */
import { useEffect, useState } from "react";
import { MAX_CALL_CONCURRENCY, type Flow, type FlowCallNode, type ParamDef } from "@flowsmith/core";
import { api, type FlowSummary } from "../../api.ts";
import { inputsOf } from "../../model/index.ts";
import { Field, TemplateInput } from "../widgets.tsx";

type Update = (fn: (n: FlowCallNode) => FlowCallNode) => void;

export function FlowCallInspector({ flow, node, update }: { flow: Flow; node: FlowCallNode; update: Update }) {
  const c = node.config;
  const set = (patch: Partial<FlowCallNode["config"]>) => update((n) => ({ ...n, config: { ...n.config, ...patch } }));
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [params, setParams] = useState<ParamDef[] | null>(null);
  useEffect(() => { void api.listFlows().then(setFlows, () => undefined); }, []);
  useEffect(() => {
    if (!c.flowId) { setParams(null); return; }
    void api.getFlow(c.flowId).then((d) => setParams(d.draft.params ?? []), () => setParams(null));
  }, [c.flowId]);
  const target = flows.find((f) => f.id === c.flowId);
  const perRow = c.items !== "";
  const rowsInput = inputsOf(flow, node.id).find((x) => x === "rows" || x === "results") ?? inputsOf(flow, node.id)[0];
  /** 실행 입력을 행의 같은 이름 값으로 */
  const autoMap = (ps: ParamDef[], rows: boolean) => Object.fromEntries(ps.map((p) => [p.name, c.params[p.name] || (rows ? `{{ $item.${p.name} }}` : "")]));

  return (
    <>
      <Field label="부를 워크플로우">
        <select value={c.flowId} onChange={(e) => set({ flowId: e.target.value, params: {} })}>
          <option value="">(고르세요)</option>
          {flows.filter((f) => f.id !== flow.id).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
        </select>
      </Field>
      <div className="row">
        <label className="check"><input type="radio" checked={c.version === "active"} onChange={() => set({ version: "active" })} />게시된 버전{target ? (target.activeVersion !== null ? ` (v${target.activeVersion})` : "") : ""}</label>
        <label className="check"><input type="radio" checked={c.version === "draft"} onChange={() => set({ version: "draft" })} />초안(시험할 때)</label>
      </div>
      {target && c.version === "active" && target.activeVersion === null && (
        <div className="banner warn small">「{target.name}」은(는) 아직 게시하지 않았습니다 — 게시하거나 «초안»으로 바꾸세요</div>
      )}

      <h3>몇 번</h3>
      <label className="check">
        <input type="checkbox" checked={perRow} onChange={(e) => {
          const on = e.target.checked;
          set({ items: on ? (rowsInput ? `{{ $input.${rowsInput} }}` : "{{ $input.rows }}") : "", ...(on && params ? { params: autoMap(params, true) } : {}) });
        }} />
        행마다 한 번씩 — 앞 노드가 준 목록(예: 파일 읽기의 rows)
      </label>
      {perRow && (
        <Field label="행들">
          <TemplateInput flow={flow} nodeId={node.id} value={c.items} placeholder="{{ $input.rows }}" onChange={(items) => set({ items })} />
        </Field>
      )}
      {!perRow && <span className="small muted">한 번만 돕니다</span>}

      <h3>그 워크플로우의 실행 입력</h3>
      {!c.flowId && <span className="small muted">워크플로우를 고르면 그 워크플로우의 실행 입력이 나옵니다</span>}
      {params?.length === 0 && <span className="small muted">이 워크플로우는 실행 입력이 없습니다</span>}
      {params && params.length > 0 && perRow && (
        <span className="small muted">행의 값은 <code>{"{{ $item.열이름 }}"}</code> — 파일의 열 이름(CSV 첫 줄)과 같게. <button className="small ghost" onClick={() => set({ params: autoMap(params, true) })}>같은 이름으로 채우기</button></span>
      )}
      {params?.map((p) => (
        <Field key={p.name} label={`${p.label || p.name}${p.required ? " *" : ""} (${p.name})`}>
          <TemplateInput flow={flow} nodeId={node.id} value={c.params[p.name] ?? ""} placeholder={perRow ? `{{ $item.${p.name} }}` : ""}
            onChange={(v) => set({ params: { ...c.params, [p.name]: v } })} />
        </Field>
      ))}
      {Object.keys(c.params).filter((k) => params && !params.some((p) => p.name === k)).map((k) => (
        <div key={k} className="small" style={{ color: "var(--warn)" }}>「{k}」은(는) 그 워크플로우의 실행 입력이 아닙니다 — <button className="small ghost" onClick={() => { const { [k]: _drop, ...rest } = c.params; set({ params: rest }); }}>빼기</button></div>
      ))}

      <h3>돌리는 법</h3>
      <div className="row">
        <Field label={`동시에(1~${MAX_CALL_CONCURRENCY})`}>
          <input type="number" min={1} max={MAX_CALL_CONCURRENCY} style={{ width: 80 }} value={c.concurrency} onChange={(e) => set({ concurrency: Math.max(1, Math.min(MAX_CALL_CONCURRENCY, Number(e.target.value) || 1)) })} />
        </Field>
      </div>
      <div className="row wrap">
        <span className="small muted">하나가 실패하면</span>
        <label className="check"><input type="radio" checked={c.onError === "stop"} onChange={() => set({ onError: "stop" })} />멈춤(이 노드 실패)</label>
        <label className="check"><input type="radio" checked={c.onError === "continue"} onChange={() => set({ onError: "continue" })} />계속(결과에 실패로 남김)</label>
      </div>
      <span className="small muted">
        내보내는 것: <code>results</code>(행마다 실행 id · 성공/실패 · 출력) · <code>succeeded</code> · <code>failed</code>. 행마다의 실행 기록은 그 워크플로우의 «실행 기록»에 «다른 워크플로우»로 남습니다.
        {c.concurrency > 1 && " ★동시에 돌리면 그만큼 브라우저 창이 열립니다 — 사이트가 같은 계정의 동시 접속을 막으면 1로 두세요."}
      </span>
    </>
  );
}
