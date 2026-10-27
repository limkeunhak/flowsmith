/**
 * 실행 기록 — n8n의 Executions 탭처럼: 왼쪽 목록(상태 · 트리거로 거르기, 날짜별로 묶음),
 * 오른쪽에 그 실행의 **캔버스**(노드마다 성공 · 실패 — 읽기 전용)와 로그.
 * 캔버스는 그 실행이 쓴 버전으로 그린다. 초안 실행이면 지금 초안으로(그때와 다를 수 있다고 알린다).
 * ★다시 실행은 실행 머리에 — 어느 단계를 골라 두었든 보인다: 같은 입력으로 · 게시된 버전으로 · **여기서부터**(멈춘 · 실패한 단계 —
 *  앞 단계는 이 실행의 출력을 쓴다. 누르면 무엇이 다시 돌고 무엇을 그대로 쓰는지 먼저 보이고 확인받는다 · core planResume).
 */
import { useEffect, useRef, useState } from "react";
import type { Flow, NodeStatus } from "@flowsmith/core";
import { api, type RunRow } from "../../api.ts";
import { normalize, type Fix } from "../../model/index.ts";
import { Canvas } from "../canvas/Canvas.tsx";
import { RunLog, StatusDot, runStatusText } from "./RunLog.tsx";
import { applyWatch, statusesOf, viewOf, type RunView } from "./useRun.ts";
import { durationText, TRIGGER_LABEL } from "@flowsmith/core";
import { IconChevronDown } from "../../icons.tsx";

/** 여기서부터 다시 — 기본으로 고를 단계: 처음으로 끝나지 않은 단계(실패 · 멈춤 · 막힘 · 안 돎) */
export function resumeTarget(nodes: readonly { id: string; status: NodeStatus }[]): string | null {
  return nodes.find((n) => n.status === "failed" || n.status === "cancelled" || n.status === "blocked" || n.status === "pending" || n.status === "running")?.id ?? null;
}

type StatusFilter = "all" | "success" | "failure" | "blocked" | "cancelled";
const FILTERS: { id: StatusFilter; label: string }[] = [{ id: "all", label: "전체" }, { id: "success", label: "성공" }, { id: "failure", label: "실패" }, { id: "blocked", label: "막힘" }, { id: "cancelled", label: "멈춤" }];

const time = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const full = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** 날짜 묶음 이름 — 오늘 · 어제 · 10월 14일 (화) */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  return diff === 0 ? "오늘" : diff === 1 ? "어제" : d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

/**
 * picked — 고른 실행(주소 #/flows/:id/runs/:runId · 없으면 가장 최근) · onPick — 고르면 주소를 바꾼다(FlowEditor) · draft — 초안 실행을 그릴 때
 * activeVersion — 게시된 버전(«게시된 버전으로 다시») · canDraft — 초안으로 돌릴 수 있나(편집자 이상) · onEditor — 편집기로
 */
export function Executions({ history, onReload, picked: chosen, onPick, onFix, draft, activeVersion = null, canDraft = true, onEditor }: { history: RunRow[]; onReload: () => void; picked: string | null; onPick: (runId: string) => void; onFix?: (fix: Fix) => void; draft?: Flow; activeVersion?: number | null; canDraft?: boolean; onEditor?: () => void }) {
  const picked = chosen ?? history[0]?.id ?? null;
  const setPicked = onPick;
  const [view, setView] = useState<RunView | null>(null);
  const [row, setRow] = useState<RunRow | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const on = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    addEventListener("mousedown", on);
    return () => removeEventListener("mousedown", on);
  }, [menu]);
  /** 여기서부터 다시 — 확인 중인 단계와 미리 보기 */
  const [resume, setResume] = useState<{ from: string; plan: Awaited<ReturnType<typeof api.resumePlan>> | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [trigger, setTrigger] = useState<string>("all");
  useEffect(() => { onReload(); }, [onReload]);
  useEffect(() => {
    if (!picked) return;
    setFocus(null);
    setRerunError(null);
    setResume(null);
    setMenu(false);
    let stop: (() => void) | null = null;
    let gone = false;
    void api.getRun(picked).then((r) => {
      if (gone) return;
      setRow(r);
      setView(viewOf(r));
      // ★아직 도는 실행(알림의 링크로 연 것 — 사람을 기다리는 중일 수 있다)이면 진행을 이어 받는다. 지난 것부터 다시 온다
      if (r.status === "running") {
        const base = { ...viewOf(r), nodes: [], human: null };
        setView(base);
        stop = api.watchRun(r.id, (e) => {
          if (e.kind === "run:end") { void api.getRun(r.id).then((x) => { if (!gone) { setRow(x); setView(viewOf(x)); onReload(); } }); return; }
          setView((v) => (v && v.runId === r.id ? applyWatch(v, e, (id) => draft?.nodes.find((n) => n.id === id)?.name ?? id) : v));
        });
      }
    }, () => { setRow(null); setView(null); });
    return () => { gone = true; stop?.(); };
  }, [picked]);
  // 그 실행이 쓴 버전으로 캔버스를 그린다
  useEffect(() => {
    if (!row) { setFlow(null); return; }
    if (row.version === null) { setFlow(draft ?? null); return; }
    void api.getVersionJson(row.flowId, row.version).then((j) => setFlow(normalize(j)), () => setFlow(draft ?? null));
  }, [row?.id, row?.version]);

  if (history.length === 0) return <div className="empty">아직 실행한 적이 없습니다. 위의 «실행»을 누르세요.</div>;
  const shown = history.filter((r) => (status === "all" || r.status === status) && (trigger === "all" || r.trigger === trigger));
  const triggers = [...new Set(history.map((r) => r.trigger))];
  const groups: { day: string; rows: RunRow[] }[] = [];
  for (const r of shown) { const d = dayOf(r.startedAt); const g = groups.at(-1); if (g?.day === d) g.rows.push(r); else groups.push({ day: d, rows: [r] }); }
  const statuses: Record<string, NodeStatus> = statusesOf(view);
  const nameOf = (id: string) => (flow ?? draft)?.nodes.find((n) => n.id === id)?.name ?? view?.nodes.find((n) => n.id === id)?.name ?? id;
  // 다시 — 초안으로 돈 실행은 편집자만(실행자는 게시된 버전만)
  const sameOk = row !== null && (row.version !== null || canDraft);
  const sameHint = row === null ? "" : row.version === null ? "지금 초안으로" : `v${row.version}로`;
  const from = view && view.status !== "success" ? resumeTarget(view.nodes) : null;
  const rerun = (opts: { version?: number | "draft"; from?: string }) => {
    if (!view || busy) return;
    setBusy(true); setRerunError(null); setMenu(false);
    void api.rerun(view.runId, opts).then((r) => { setResume(null); onReload(); setPicked(r.runId); }, (e: unknown) => setRerunError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const askResume = (nodeId: string) => {
    if (!view) return;
    setMenu(false);
    setResume({ from: nodeId, plan: null });
    void api.resumePlan(view.runId, nodeId).then((plan) => setResume((x) => (x?.from === nodeId ? { from: nodeId, plan } : x)), (e: unknown) => setResume({ from: nodeId, plan: { error: e instanceof Error ? e.message : String(e) } }));
  };

  return (
    <div className="executions">
      <div className="exec-list">
        <div className="exec-filters">
          <div className="seg-tabs small">
            {FILTERS.map((f) => <button key={f.id} className={status === f.id ? "on" : ""} onClick={() => setStatus(f.id)}>{f.label}</button>)}
          </div>
          {triggers.length > 1 && (
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-label="어떻게 돌았나">
              <option value="all">모든 실행 방법</option>
              {triggers.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t] ?? t}</option>)}
            </select>
          )}
        </div>
        {shown.length === 0 && <div className="small muted" style={{ padding: 12 }}>맞는 실행이 없습니다</div>}
        {groups.map((g) => (
          <div key={g.day}>
            <div className="exec-day">{g.day}</div>
            {g.rows.map((r) => (
              <button key={r.id} className={`exec-item st-${r.status}${picked === r.id ? " on" : ""}`} onClick={() => setPicked(r.id)}>
                <StatusDot status={r.status === "running" ? "running" : r.status} />
                <span className="grow">
                  <span className="exec-when">{time(r.startedAt)} <span className="exec-state">{runStatusText(r.status)}</span></span>
                  <span className="exec-sub">{r.resumedFrom ? `↻ «${r.resumedFrom.nodeName}»부터 · ` : ""}{TRIGGER_LABEL[r.trigger] ?? r.trigger}{r.startedBy ? `(${r.startedBy.split("@")[0]})` : ""} · {r.version === null ? "초안" : `v${r.version}`}{r.ranOn ? ` · ${r.ranOn}` : ""}{r.ms !== null ? ` · ${durationText(r.ms)}` : ""}</span>
                  {r.status === "failure" && r.message && <span className="exec-msg" title={r.message}>{r.message}</span>}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="exec-detail">
        {view ? (
          <>
            <div className="exec-head">
              <span className={`pill ${view.status === "success" ? "ok" : view.status === "failure" ? "bad" : view.status === "blocked" ? "blocked" : "accent"}`}>{runStatusText(view.status)}</span>
              <h2 className="grow">{full(view.startedAt)}</h2>
              <span className="small muted">{row?.resumedFrom ? `↻ «${row.resumedFrom.nodeName}»부터 · ` : ""}{row ? `${TRIGGER_LABEL[row.trigger] ?? row.trigger} 실행${row.startedBy ? `(${row.startedBy})` : ""} · ` : ""}{view.label}{view.ms !== null ? ` · ${durationText(view.ms)}` : ""}</span>
            </div>
            {/* ★다음 할 일 — 어느 단계를 골라 두었든 여기에 */}
            {view.status !== "running" && row && (
              <div className="exec-actions">
                {onEditor && <button className="small" onClick={onEditor}>편집기에서 보기</button>}
                <div className="menu-anchor split-btn" ref={menuRef}>
                  {from && sameOk ? (
                    <button className="small primary" disabled={busy} title={`앞 단계는 이 실행의 출력을 쓰고 «${nameOf(from)}»부터 돌립니다 — 누르면 무엇이 다시 도는지 먼저 보여 드립니다`} onClick={() => askResume(from)}>↻ «{nameOf(from)}»부터 다시</button>
                  ) : (
                    <button className="small primary" disabled={busy || !sameOk} title={sameOk ? `같은 입력으로 처음부터 — ${sameHint}` : "초안으로 돈 실행은 편집자 이상이 다시 돌립니다"} onClick={() => rerun({})}>↻ 다시 실행</button>
                  )}
                  <button className="small primary split-more" aria-label="다시 실행 — 다른 방법" aria-expanded={menu} onClick={() => setMenu(!menu)}><IconChevronDown size={14} /></button>
                  {menu && (
                    <div className="menu" role="menu">
                      <button role="menuitem" className="menu-item" disabled={!sameOk} onClick={() => rerun({})}><span className="menu-item-title">같은 입력으로 처음부터</span><span className="menu-hint">{sameOk ? `${sameHint} · 입력 ${Object.keys(row.params).length}개 그대로` : "초안으로 돈 실행은 편집자 이상이 다시 돌립니다"}</span></button>
                      {from && <button role="menuitem" className="menu-item" disabled={!sameOk} onClick={() => askResume(from)}><span className="menu-item-title">«{nameOf(from)}»부터 다시</span><span className="menu-hint">앞 단계는 이 실행의 출력을 씁니다 — 다른 단계는 왼쪽에서 골라 «여기서부터 다시»</span></button>}
                      {activeVersion !== null && row.version !== activeVersion && <button role="menuitem" className="menu-item" onClick={() => rerun({ version: activeVersion })}><span className="menu-item-title">게시된 v{activeVersion}로 처음부터</span><span className="menu-hint">같은 입력 · 지금 게시된 버전</span></button>}
                    </div>
                  )}
                </div>
              </div>
            )}
            {resume && (
              <div className="banner info resume-confirm" role="dialog" aria-label="여기서부터 다시">
                <div className="stack grow">
                  <b>«{nameOf(resume.from)}»부터 다시 — {sameHint}</b>
                  {resume.plan === null ? <span className="small muted">살펴보는 중…</span>
                    : "error" in resume.plan ? <span className="small" style={{ color: "var(--bad)" }}>{resume.plan.error}</span>
                    : <>
                      {resume.plan.reused.length > 0 && <span className="small">이 실행의 출력을 그대로 씀 — {resume.plan.reused.map(nameOf).join(" · ")}</span>}
                      {resume.plan.again.length > 0 && <span className="small">다시 도는 앞 단계 — {resume.plan.again.map((a) => `${nameOf(a.id)}(${a.why === "browser" ? "브라우저 화면을 다시 만든다" : "가린 값이 있어"})`).join(" · ")}</span>}
                      {resume.plan.again.some((a) => a.why === "browser") && <span className="small muted">실행마다 브라우저가 새로 뜹니다 — 로그인 같은 화면 단계는 다시 하고, 그 밖의 앞 단계는 돌지 않습니다</span>}
                    </>}
                </div>
                <button className="small" onClick={() => setResume(null)}>그만두기</button>
                <button className="small primary" disabled={busy || resume.plan === null || "error" in resume.plan} onClick={() => rerun({ from: resume.from })}>다시 실행</button>
              </div>
            )}
            {view.message && view.status !== "success" && <div className={`banner ${view.status === "failure" ? "bad" : view.status === "blocked" ? "warn" : "info"} small`}>{view.status === "blocked" ? `🚫 막힘 — ${view.message}` : view.message}</div>}
            {flow && (
              <div className="exec-canvas">
                <Canvas flow={flow} selected={focus} statuses={statuses} issues={new Map()} readOnly
                  onSelect={(id) => setFocus(id)} onChange={() => undefined} onRequestAdd={() => undefined} onToast={() => undefined} />
                {row?.version === null && <span className="exec-canvas-note">초안 실행 — 지금 초안으로 그렸습니다(그때와 다를 수 있습니다)</span>}
              </div>
            )}
            <RunLog view={view} focus={focus} onFocusNode={setFocus} {...(onFix ? { onFix } : {})} {...(sameOk ? { onResumeFrom: askResume } : {})} />
            {rerunError && <div className="banner bad small">{rerunError}</div>}
          </>
        ) : <div className="empty">불러오는 중…</div>}
      </div>
    </div>
  );
}
