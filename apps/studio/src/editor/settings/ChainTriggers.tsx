/**
 * **다른 플로우가 끝나면 · 파일이 생기면** — 트리거 서랍의 두 칸(TriggersPanel). 플로우 설정(after · fileTriggers)에 들어간다 — 버전과 함께 간다.
 *
 *   다른 플로우가 끝나면  앞 플로우(게시된 버전)가 성공 · 실패하면 이 플로우의 게시된 버전을 돌린다. 실행 입력은 `{{ $input.이름 }}` — 앞 플로우의 결과
 *   파일이 생기면        공유 폴더(files/shared/폴더)에 이름이 맞는 새 파일이 다 써지면 돌린다. 파일 이름을 실행 입력 하나에 넣는다
 */
import { useEffect, useState } from "react";
import type { AfterTrigger, FileTrigger, Flow } from "@flowsmith/core";
import { api, type FlowSummary } from "../../api.ts";
import { nextId } from "../../model/index.ts";
import { IconX } from "../../icons.tsx";
import { Field } from "../widgets.tsx";

type Update = (fn: (f: Flow) => Flow) => void;

export function AfterSection({ flow, update }: { flow: Flow; update: Update }) {
  const list = flow.settings.after ?? [];
  const set = (fn: (s: AfterTrigger[]) => AfterTrigger[]) => update((f) => ({ ...f, settings: { ...f.settings, after: fn(f.settings.after ?? []) } }));
  const setOne = (id: string, patch: Partial<AfterTrigger>) => set((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  useEffect(() => { void api.listFlows().then(setFlows, () => undefined); }, []);
  const toggle = (t: AfterTrigger, on: "success" | "failure", yes: boolean) => setOne(t.id, { on: yes ? [...new Set([...t.on, on])] : t.on.filter((x) => x !== on) });

  return (
    <>
      {list.length === 0 && <div className="small muted">아직 없습니다 — 예: «주문 읽기»가 성공하면 이 워크플로우가 이어서 «주문 넣기»를 합니다</div>}
      {list.map((t) => {
        const up = flows.find((f) => f.id === t.flowId);
        return (
          <div key={t.id} className="subcard">
            <div className="row">
              <label className="check"><input type="checkbox" checked={t.enabled} onChange={(e) => setOne(t.id, { enabled: e.target.checked })} />켬</label>
              <select className="grow" value={t.flowId} aria-label="앞 워크플로우" onChange={(e) => setOne(t.id, { flowId: e.target.value })}>
                <option value="">(앞 워크플로우를 고르세요)</option>
                {flows.filter((f) => f.id !== flow.id).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
              </select>
              <button className="icon-btn" title="지우기" onClick={() => set((ts) => ts.filter((x) => x.id !== t.id))}><IconX size={14} /></button>
            </div>
            <div className="row wrap">
              <span className="small muted">이(가)</span>
              <label className="check"><input type="checkbox" checked={t.on.includes("success")} onChange={(e) => toggle(t, "success", e.target.checked)} />성공하면</label>
              <label className="check"><input type="checkbox" checked={t.on.includes("failure")} onChange={(e) => toggle(t, "failure", e.target.checked)} />실패하면</label>
            </div>
            {up && up.activeVersion === null && <div className="banner warn small">«{up.name}»은(는) 아직 게시하지 않았습니다 — 게시된 버전의 실행이 끝나야 이 워크플로우가 돕니다</div>}
            {flow.params.map((p) => (
              <Field key={p.name} label={`${p.label || p.name}${p.required && !p.default ? " *" : ""}`}>
                <input className="mono" value={t.params[p.name] ?? ""} placeholder={`{{ $input.${p.name} }}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOne(t.id, { params: v === "" ? Object.fromEntries(Object.entries(t.params).filter(([k]) => k !== p.name)) : { ...t.params, [p.name]: v } });
                  }} />
              </Field>
            ))}
          </div>
        );
      })}
      <button onClick={() => set((ts) => [...ts, { id: nextId("a", ts.map((x) => x.id)), flowId: "", on: ["success"], params: {}, enabled: true }])}>＋ 다른 워크플로우가 끝나면</button>
      <span className="small muted">
        실행 입력에 <code>{"{{ $input.이름 }}"}</code>을 쓰면 앞 워크플로우의 결과가 들어갑니다(<code>$vars</code>도 됩니다). 앞 워크플로우와 같은 팀이거나 공용이어야 합니다.
        초안 시험 · 다른 워크플로우가 부른 실행 · 멈춘 실행은 이어 가지 않습니다 · 서로를 기다리면(순환) 한 바퀴에서 멈춥니다.
      </span>
    </>
  );
}

export function FileSection({ flow, update }: { flow: Flow; update: Update }) {
  const list = flow.settings.fileTriggers ?? [];
  const set = (fn: (s: FileTrigger[]) => FileTrigger[]) => update((f) => ({ ...f, settings: { ...f.settings, fileTriggers: fn(f.settings.fileTriggers ?? []) } }));
  const setOne = (id: string, patch: Partial<FileTrigger>) => set((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const textParams = flow.params;

  return (
    <>
      {list.length === 0 && <div className="small muted">아직 없습니다 — 예: 공유 폴더 «주문요청»에 엑셀 · CSV가 들어오면 돌립니다</div>}
      {list.map((t) => (
        <div key={t.id} className="subcard">
          <div className="row">
            <label className="check"><input type="checkbox" checked={t.enabled} onChange={(e) => setOne(t.id, { enabled: e.target.checked })} />켬</label>
            <span className="grow" />
            <button className="icon-btn" title="지우기" onClick={() => set((ts) => ts.filter((x) => x.id !== t.id))}><IconX size={14} /></button>
          </div>
          <div className="row wrap">
            <Field label="공유 폴더 안의 폴더"><input value={t.dir} placeholder="주문요청" onChange={(e) => setOne(t.id, { dir: e.target.value })} /></Field>
            <Field label="파일 이름"><input className="mono" value={t.pattern} placeholder="*.csv" onChange={(e) => setOne(t.id, { pattern: e.target.value })} /></Field>
          </div>
          <Field label="파일 이름을 넣을 실행 입력">
            <select value={t.param ?? ""} onChange={(e) => setOne(t.id, { param: e.target.value || null })}>
              <option value="">(넣지 않음)</option>
              {textParams.map((p) => <option key={p.name} value={p.name}>{p.label || p.name} ({p.name})</option>)}
            </select>
          </Field>
        </div>
      ))}
      <button onClick={() => set((ts) => [...ts, { id: nextId("w", ts.map((x) => x.id)), dir: "", pattern: "*.csv", param: flow.params[0]?.name ?? null, enabled: true }])}>＋ 파일이 생기면</button>
      <span className="small muted">
        <code>*</code>은 아무 글자들, <code>?</code>는 한 글자(대소문자 가리지 않음). 10초마다 보고, 크기가 그대로일 때(다 써졌을 때) 파일마다 한 번 돕니다.
        켜기 전에 있던 파일 · 폴더나 이름을 바꾸기 전에 있던 파일로는 돌지 않습니다. 파일은 «파일 읽기» 노드의 «공유»에서 그 이름으로 읽으세요.
      </span>
    </>
  );
}
