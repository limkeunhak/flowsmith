/**
 * 실행 기록 — n8n의 Executions 탭처럼: 왼쪽 목록(상태 · 트리거로 거르기, 날짜별로 묶음),
 * 오른쪽에 그 실행의 **캔버스**(노드마다 성공 · 실패 — 읽기 전용)와 로그.
 * 캔버스는 그 실행이 쓴 버전으로 그린다. 초안 실행이면 지금 초안으로(그때와 다를 수 있다고 알린다).
 */
import { useEffect, useState } from "react";
import type { Flow, NodeStatus } from "@flowsmith/core";
import { api, type RunRow } from "../../api.ts";
import { normalize, type Fix } from "../../model/index.ts";
import { Canvas } from "../canvas/Canvas.tsx";
import { RunLog, StatusDot, runStatusText } from "./RunLog.tsx";
import { applyWatch, statusesOf, viewOf, type RunView } from "./useRun.ts";
import { durationText, TRIGGER_LABEL } from "@flowsmith/core";

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

/** initial — 처음 고를 실행(알림의 링크 · #/flows/:id/runs/:runId) · draft — 초안 실행을 그릴 때 */
export function Executions({ history, onReload, initial, onFix, draft }: { history: RunRow[]; onReload: () => void; initial?: string; onFix?: (fix: Fix) => void; draft?: Flow }) {
  const [picked, setPicked] = useState<string | null>(initial ?? history[0]?.id ?? null);
  const [view, setView] = useState<RunView | null>(null);
  const [row, setRow] = useState<RunRow | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [trigger, setTrigger] = useState<string>("all");
  useEffect(() => { onReload(); }, [onReload]);
  useEffect(() => { if (picked === null && history[0]) setPicked(history[0].id); }, [history, picked]);
  useEffect(() => {
    if (!picked) return;
    setFocus(null);
    setRerunError(null);
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

  if (history.length === 0) return <div className="empty">아직 실행한 적이 없습니다. 편집기에서 「워크플로우 실행」을 누르세요.</div>;
  const shown = history.filter((r) => (status === "all" || r.status === status) && (trigger === "all" || r.trigger === trigger));
  const triggers = [...new Set(history.map((r) => r.trigger))];
  const groups: { day: string; rows: RunRow[] }[] = [];
  for (const r of shown) { const d = dayOf(r.startedAt); const g = groups.at(-1); if (g?.day === d) g.rows.push(r); else groups.push({ day: d, rows: [r] }); }
  const statuses: Record<string, NodeStatus> = statusesOf(view);

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
                  <span className="exec-sub">{TRIGGER_LABEL[r.trigger] ?? r.trigger}{r.startedBy ? `(${r.startedBy.split("@")[0]})` : ""} · {r.version === null ? "초안" : `v${r.version}`}{r.ranOn ? ` · ${r.ranOn}` : ""}{r.ms !== null ? ` · ${durationText(r.ms)}` : ""}</span>
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
              <span className="small muted">{row ? `${TRIGGER_LABEL[row.trigger] ?? row.trigger} 실행${row.startedBy ? `(${row.startedBy})` : ""} · ` : ""}{view.label}{view.ms !== null ? ` · ${durationText(view.ms)}` : ""}</span>
            </div>
            {view.message && view.status !== "success" && <div className={`banner ${view.status === "failure" ? "bad" : view.status === "blocked" ? "warn" : "info"} small`}>{view.status === "blocked" ? `🚫 막힘 — ${view.message}` : view.message}</div>}
            {flow && (
              <div className="exec-canvas">
                <Canvas flow={flow} selected={focus} statuses={statuses} issues={new Map()} readOnly
                  onSelect={(id) => setFocus(id)} onChange={() => undefined} onRequestAdd={() => undefined} onToast={() => undefined} />
                {row?.version === null && <span className="exec-canvas-note">초안 실행 — 지금 초안으로 그렸습니다(그때와 다를 수 있습니다)</span>}
              </div>
            )}
            <RunLog view={view} focus={focus} onFocusNode={setFocus} {...(onFix ? { onFix } : {})}
              onRerun={() => void api.rerun(view.runId).then((r) => { onReload(); setPicked(r.runId); }, (e: unknown) => setRerunError(e instanceof Error ? e.message : String(e)))} />
            {rerunError && <div className="banner bad small">{rerunError}</div>}
          </>
        ) : <div className="empty">불러오는 중…</div>}
      </div>
    </div>
  );
}
