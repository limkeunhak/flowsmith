/**
 * **노드 창** — n8n의 노드 화면처럼 세 칸: 입력 | 설정 | 출력 (PLAN §21).
 *
 *   입력  이 노드가 받을(받은) 값 — 마지막 실행에서. 없으면 «앞 단계까지 실행»
 *   설정  노드 종류마다의 설정(inspectors/*) · 녹화 · 문제
 *   출력  이 노드가 내놓은 값 · 기록 · 실패 카드(고치는 단추) — «이 단계까지 실행»
 *
 * ★단계 실행은 **초안**을 그 자리까지만 돌린다(실제 사이트에서 실제로 일어난다 — 되돌릴 수 없는 동작이 있으면 묻는다).
 * ☆가운데 칸은 옛 서랍과 같은 이름표(.drawer)를 단다 — 화면 시험 · 녹화 · 다시 지정이 같은 자리를 찾게.
 */
import { useState } from "react";
import type { Flow, FlowNode, ProbeFinding } from "@flowsmith/core";
import type { NodeRun } from "../../api.ts";
import type { Fix } from "../../model/index.ts";
import { IconArrowLeft, IconPlay, IconTrash, IconX } from "../../icons.tsx";
import { NodeSettings } from "./NodeInspector.tsx";
import { metaOf } from "../nodeMeta.tsx";
import { canSplitStages } from "../../model/index.ts";
import { FailureCard, StatusDot, STATUS_TEXT } from "../run/RunLog.tsx";
import { ResultView } from "../run/ResultView.tsx";
import { RecordStartForm, type RecordStart } from "../record/Recorder.tsx";
import { durationText } from "@flowsmith/core";

export type RunPart = "before" | "after";


export function NodeView({ flow, node, run, sample, issues, update, remove, onClose, onRecord, findings, onRepick, onRunPart, running, runError, onFix, pinned = null, onPin, onSplit }: {
  flow: Flow; node: FlowNode;
  /** 마지막 실행에서 이 노드 — 돌지 않았으면(대기) 출력 칸이 비어 있다 */
  run: NodeRun | null;
  /** 이 노드가 받을 입력 — 돌았으면 받은 것, 아니면 앞 노드들의 출력 */
  sample: Record<string, unknown> | null;
  issues: string[];
  update: (fn: (n: FlowNode) => FlowNode) => void; remove: () => void; onClose: () => void;
  onRecord: (s: RecordStart) => void;
  findings: ProbeFinding[];
  onRepick: (actionId: string) => void;
  onRunPart: (part: RunPart) => void;
  running: boolean;
  runError: string[] | null;
  onFix: (fix: Fix) => void;
  /** 고정된 출력 — 있으면 초안 시험에서 이 노드는 돌지 않는다 */
  pinned?: Record<string, unknown> | null;
  /** 고정 · 풀기(null) — 편집자만 */
  onPin?: (output: Record<string, unknown> | null) => void;
  /** 웹페이지 노드 나누기 — 동작 번호들(그 동작부터 새 노드) 또는 사람 기다리기마다. 편집자만 */
  onSplit?: (cuts: number[] | "stages") => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const meta = metaOf(node);
  const Icon = meta.icon;
  const from = flow.edges.filter((e) => e.to.node === node.id).map((e) => flow.nodes.find((n) => n.id === e.from.node)?.name).filter(Boolean) as string[];
  const ran = run && run.status !== "pending" ? run : null;
  const unsafe = node.type === "web" && node.config.actions.some((a) => a.risk === "unsafe");
  const runAfter = () => {
    if (unsafe && !confirm("이 단계에는 되돌릴 수 없는 동작(제출 · 저장 등)이 있습니다. 실제 사이트에서 실제로 일어납니다. 돌릴까요?")) return;
    onRunPart("after");
  };

  return (
    <div className="ndv-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ndv" role="dialog" aria-label={`${node.name} 설정`}>
        <div className="ndv-top">
          <button className="ghost small" onClick={onClose}><IconArrowLeft size={15} /> 캔버스로</button>
          <span className="grow" />
          {runError && <span className="small" style={{ color: "var(--bad)" }} title={runError.join("\n")}>{runError[0]}</span>}
          <button className="icon-btn" title="닫기 (Esc)" onClick={onClose}><IconX /></button>
        </div>
        <div className="ndv-cols">
          {/* ── 입력 ── */}
          <section className="ndv-pane">
            <header className="ndv-pane-head">
              <b>입력</b>
              <span className="small muted grow">{from.length ? from.join(" · ") : "첫 단계"}</span>
              {from.length > 0 && <button className="small" disabled={running} title="앞 단계들만 돌려 이 노드가 받을 값을 봅니다(이 노드는 돌리지 않습니다)" onClick={() => onRunPart("before")}><IconPlay size={12} /> 앞 단계까지 실행</button>}
            </header>
            <div className="ndv-pane-body">
              {sample && Object.keys(sample).length > 0 ? <ResultView value={sample} fileName={`${node.name}-입력`} />
                : from.length === 0 ? <div className="ndv-empty">첫 단계라 앞에서 받는 값이 없습니다{flow.params.length ? " — 실행 입력은 «워크플로우 실행»에서 넣습니다" : ""}</div>
                : <div className="ndv-empty">{running ? "도는 중…" : <>아직 받은 값이 없습니다.<br />«앞 단계까지 실행»을 누르면 앞 단계들을 돌려 이 노드가 받을 값을 보여 줍니다.</>}</div>}
            </div>
          </section>

          {/* ── 설정 ── */}
          <section className="ndv-center drawer">
            <div className="drawer-head">
              <span className={`mini-tile ${meta.cls}`}><Icon size={18} /></span>
              <input className="title-input grow" value={node.name} aria-label="노드 이름" onChange={(e) => update((n) => ({ ...n, name: e.target.value }))} />
              {onSplit && canSplitStages(node) && (
                <button className="small" title="사람 기다리기마다 노드를 나눕니다 — 페이지 접속 → 사람 기다리기 → 그 뒤 동작. 같은 페이지에서 이어 돌고, 읽은 값도 뒤로 이어집니다" onClick={() => onSplit("stages")}>단계별로 나누기</button>
              )}
              <button className="small ghost danger node-del" title="노드 지우기 — 캔버스에서는 노드에 올려 🗑 · 오른쪽 클릭으로도 지웁니다" onClick={remove}><IconTrash size={14} /> 지우기</button>
            </div>
            <div className="drawer-body">
              {issues.length > 0 && (
                <div className="banner bad small" style={{ marginBottom: 12 }}>{issues.map((p, i) => <div key={i}>{p.replace(/^노드 '[^']*'\([^)]*\)\s*/, "")}</div>)}</div>
              )}
              {/* 사람의 크롬에 붙는 플로우(attach)도 녹화한다 — 녹화 준비가 그 안내를 보인다(B4) */}
              {node.type === "web" && (
                preparing
                  ? <div style={{ marginBottom: 14 }}><RecordStartForm flow={flow} node={node} onStart={onRecord} onCancel={() => setPreparing(false)} /></div>
                  : <button className="record-btn" onClick={() => setPreparing(true)}><span className="rec-dot" /> 녹화로 동작 더하기<span className="small muted">페이지를 띄워 직접 해 보면 동작이 기록됩니다</span></button>
              )}
              <NodeSettings flow={flow} node={node} update={update} findings={findings} onRepick={onRepick} sample={sample} {...(onSplit ? { onSplitAt: (i: number) => onSplit([i]) } : {})} />
            </div>
            <div className="drawer-foot small muted">{meta.title} · <span className="mono">{node.id}</span></div>
          </section>

          {/* ── 출력 ── */}
          <section className="ndv-pane">
            <header className="ndv-pane-head">
              <b>출력</b>
              <span className="small muted grow">{ran ? <><StatusDot status={ran.status} /> {STATUS_TEXT[ran.status]}{ran.ms > 0 ? ` · ${durationText(ran.ms)}` : ""}</> : ""}</span>
              <button className="small primary" disabled={running} title="처음부터 이 노드까지 돌립니다(초안) — 뒤 노드는 돌리지 않습니다" onClick={runAfter}><IconPlay size={12} /> 이 단계까지 실행</button>
            </header>
            <div className="ndv-pane-body">
              {pinned && (
                <div className="banner info small pin-banner" style={{ marginBottom: 10 }}>
                  <div className="row"><b className="grow">📌 출력이 고정돼 있습니다</b>{onPin && <button className="small" onClick={() => onPin(null)}>고정 풀기</button>}</div>
                  <span>초안 시험에서 이 노드는 돌지 않고 아래 값을 내놓습니다{node.type === "web" ? " — 페이지도 열리지 않으니 «앞 페이지에서 이어서» 시작하는 뒤 웹페이지 노드는 멈춥니다" : ""}. 게시된 버전 · 일정 · 웹훅은 늘 진짜로 돕니다.</span>
                  <ResultView value={pinned} fileName={`${node.name}-고정`} />
                </div>
              )}
              {unsafe && !ran && <div className="banner warn small" style={{ marginBottom: 10 }}>되돌릴 수 없는 동작이 있습니다 — 단계 실행도 실제 사이트에서 실제로 일어납니다</div>}
              {running && !ran ? <div className="ndv-empty">도는 중…</div> : !ran ? (
                <div className="ndv-empty">아직 돌리지 않았습니다.<br />«이 단계까지 실행»을 누르면 처음부터 이 노드까지 돌려 내놓은 값을 보여 줍니다.</div>
              ) : (
                <div className="stack">
                  {ran.failure && <FailureCard f={ran.failure} nodeId={ran.id} onFix={onFix} />}
                  {ran.branch && <div className="small"><span className="pill">갈래 {ran.branch}</span></div>}
                  {ran.output && ran.status === "succeeded" && Object.keys(ran.output).length > 0 && <ResultView value={ran.output} fileName={node.name} />}
                  {onPin && !pinned && !ran.pinned && node.type !== "condition" && ran.status === "succeeded" && ran.output && Object.keys(ran.output).length > 0 && (
                    <div className="row"><span className="grow small muted">뒤 노드를 만드는 동안 사이트를 다시 돌지 않으려면</span>
                      <button className="small" title="초안 시험에서 이 노드는 돌지 않고 이 값을 씁니다(게시된 버전은 늘 진짜로)" onClick={() => onPin(ran.output!)}>📌 이 출력 고정</button></div>
                  )}
                  {ran.status === "succeeded" && (!ran.output || Object.keys(ran.output).length === 0) && <div className="small muted">내놓은 값이 없습니다</div>}
                  {(ran.steps.length > 0 || ran.logs.length > 0) && (
                    <details open={!!ran.failure}>
                      <summary className="small muted">기록 {ran.steps.length + ran.logs.length}줄</summary>
                      <ol className="steps">
                        {ran.steps.map((s) => <li key={`${s.index}-${s.id}`}><span className="step-n">{s.index > 0 ? s.index : "▸"}</span><span className="grow">{s.note}</span><span className="muted">{durationText(s.ms)}</span></li>)}
                        {ran.logs.map((l, i) => <li key={`l${i}`}><span className="step-n">│</span><span className="grow">{l}</span></li>)}
                      </ol>
                    </details>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
