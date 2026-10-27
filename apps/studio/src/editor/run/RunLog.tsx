/**
 * 실행 로그 — 왼쪽에 노드 목록(상태), 오른쪽에 고른 노드의 단계 · 실패 · 입력 · 출력.
 * 캔버스 아래 패널과 「실행 기록」 화면이 같이 쓴다 (n8n의 Logs 패널).
 */
import { useEffect, useState } from "react";
import { leftText, RunScreen } from "../../live/RunScreen.tsx";
import { api } from "../../api.ts";
import type { NodeRun, NodeStatus, StepFailure } from "../../api.ts";
import { describeLocator, fixHint, REPICKABLE, type Fix } from "../../model/index.ts";
import { IconCheck, IconSkip, IconX } from "../../icons.tsx";
import type { RunView } from "./useRun.ts";
import { ResultView } from "./ResultView.tsx";
import { CHECK_OP_LABEL, durationText, ROLE_LABEL } from "@flowsmith/core";
import { ApiError } from "../../api.ts";

export const STATUS_TEXT: Record<NodeStatus, string> = { pending: "대기", running: "도는 중", succeeded: "성공", failed: "실패", skipped: "건너뜀", cancelled: "안 돎", blocked: "막힘" };
const PROBLEM_TEXT: Record<StepFailure["problem"], string> = {
  missing: "요소를 못 찾음", many: "요소가 여러 개", forbidden: "금지 버튼", notFilled: "값이 안 들어감", noPage: "이어 쓸 페이지 없음",
  refused: "고르면 안 되는 행", mismatch: "기대한 건이 아님", check: "검사 불통과", timeout: "시간 초과", stopped: "멈춤", other: "실패",
};

export function StatusDot({ status }: { status: NodeStatus | "success" | "failure" }) {
  // 실행의 «멈춤»(cancelled)은 노드의 «안 돎»과 같은 모양
  const s = status === "success" ? "succeeded" : status === "failure" ? "failed" : status;
  if (s === "running") return <span className="dot running" />;
  if (s === "blocked") return <span className="dot blocked" title="막힘 — 고르면 안 되는 건">!</span>;
  if (s === "succeeded") return <span className="dot ok"><IconCheck size={11} strokeWidth={3} /></span>;
  if (s === "failed") return <span className="dot bad"><IconX size={11} strokeWidth={3} /></span>;
  return <span className="dot skip"><IconSkip size={11} strokeWidth={3} /></span>;
}

export const runStatusText = (s: RunView["status"]) => (s === "success" ? "성공" : s === "failure" ? "실패" : s === "cancelled" ? "멈춤" : s === "blocked" ? "막힘" : "도는 중");

/**
 * ★실패는 사람이 5분 안에 다시 지정할 수 있게 — 무엇을 해 주세요 · 고치는 단추 · 무엇이 · 어디서 · 왜 · 후보.
 * onFix가 있으면(편집 화면 · 실행 기록) 단추가 그 자리로 데려간다. 고치는 것은 사람이다(결정 3).
 */
export function FailureCard({ f, nodeId, onFix }: { f: StepFailure; nodeId?: string; onFix?: (fix: Fix) => void }) {
  const can = !!onFix && !!nodeId;
  const act = f.action;
  return (
    <div className="failure">
      <div className="failure-title"><IconX size={14} strokeWidth={2.6} /> {PROBLEM_TEXT[f.problem]}</div>
      <div className="fix-hint">{fixHint(f.problem, f.label)}</div>
      {can && (
        <div className="row wrap fix-actions">
          {act && REPICKABLE.includes(f.problem) && <button className="small primary" onClick={() => onFix!({ kind: "repick", nodeId: nodeId!, actionId: act.id })}>다시 지정</button>}
          {f.problem === "timeout" && <button className="small primary" onClick={() => onFix!({ kind: "retries" })}>다시 해 보기 켜기</button>}
          {f.problem === "forbidden" && <button className="small" onClick={() => onFix!({ kind: "settings" })}>금지 버튼 목록 열기</button>}
          <button className="small" onClick={() => onFix!({ kind: "open", nodeId: nodeId! })}>노드 열기</button>
        </div>
      )}
      <div className="small muted fix-message">{f.message}</div>
      <dl>
        {f.action && <><dt>동작</dt><dd>{f.action.index}번째 ({f.action.kind})</dd></>}
        {f.label && <><dt>요소</dt><dd>{f.label}</dd></>}
        {f.locator && <><dt>위치</dt><dd className="mono">{describeLocator(f.locator)}</dd></>}
        {f.url && <><dt>주소</dt><dd className="mono">{f.url}</dd></>}
        {f.candidates.length > 0 && <><dt>후보</dt><dd>{f.candidates.map((c, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <span className="mono">{describeLocator(c.locator)}</span> → 지금 {c.count < 0 ? "확인 못 함" : `${c.count}개`}
            {can && act && c.count === 1 && <button className="small" title="이 위치를 1순위로 — 누르기 전에는 바뀌지 않습니다" onClick={() => onFix!({ kind: "candidate", nodeId: nodeId!, actionId: act.id, locator: c.locator })}>이 위치로 바꾸기</button>}
          </div>
        ))}<span className="small muted">후보는 자동으로 쓰지 않습니다 — 지금 정확히 하나를 가리키는 후보만 «이 위치로 바꾸기»로 고를 수 있습니다</span></dd></>}
      </dl>
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function NodeRunDetail({ n, onFix, runId }: { n: NodeRun; onFix?: (fix: Fix) => void; runId?: string }) {
  return (
    <div className="stack">
      {n.branch && <div className="small"><span className="pill">갈래 {n.branch}</span></div>}
      {n.checks && n.checks.length > 0 && <CheckTable checks={n.checks} />}
      {runId && n.failure?.problem === "check" && <CheckShot runId={runId} />}
      {(n.steps.length > 0 || n.logs.length > 0) && (
        <ol className="steps">
          {n.steps.map((s) => <li key={`${s.index}-${s.id}`}><span className="step-n">{s.index > 0 ? s.index : "▸"}</span><span className="grow">{s.note}</span><span className="muted">{durationText(s.ms)}</span></li>)}
          {n.logs.map((l, i) => <li key={`l${i}`}><span className="step-n">│</span><span className="grow">{l}</span></li>)}
        </ol>
      )}
      {n.failure && <FailureCard f={n.failure} nodeId={n.id} {...(onFix ? { onFix } : {})} />}
      <div className="io">
        <div><h3>입력</h3>{n.input && Object.keys(n.input).length > 0 ? <Json value={n.input} /> : <span className="small muted">없음</span>}</div>
        <div><h3>출력</h3>{n.output && n.status === "succeeded" && Object.keys(n.output).length > 0 ? <ResultView value={n.output} fileName={n.name} /> : <span className="small muted">없음</span>}</div>
      </div>
    </div>
  );
}

/** watchable — «실제 화면 보기» 단추를 여기 둘까(편집기는 로그 머리에 따로 둔다) */
/** onFix — 실패 카드의 고치는 단추(편집 화면이 받는다) */
/** onResumeFrom — 끝난 실행을 그 단계부터 다시(실행 기록이 준다 · 단계 상세에 단추) */
export function RunLog({ view, focus, onFocusNode, watchable = true, onFix, onResumeFrom }: { view: RunView; focus?: string | null; onFocusNode?: (id: string) => void; watchable?: boolean; onFix?: (fix: Fix) => void; onResumeFrom?: (nodeId: string) => void }) {
  const failed = view.nodes.find((n) => n.status === "failed")?.id;
  const [picked, setPicked] = useState<string | null>(null);
  // 실패가 있으면 그것을, 아니면 플로우 결과를 먼저 보인다
  const current = picked ?? focus ?? failed ?? "__result";
  useEffect(() => { setPicked(null); }, [view.runId, focus]);
  const node = view.nodes.find((n) => n.id === current) ?? null;
  const [watching, setWatching] = useState(false);
  useEffect(() => { setWatching(false); }, [view.runId]);
  const runningNode = view.nodes.find((n) => n.status === "running");
  const lastStep = runningNode?.steps.at(-1);

  return (
    <div className="runlog">
      {view.status === "running" && view.human && <HumanWait human={view.human} {...(watchable ? { onScreen: () => setWatching(true) } : {})} />}
      {view.status === "running" && view.approval && <ApprovalWait runId={view.runId} approval={view.approval} />}
      {watching && view.runId && (
        <RunScreen runId={view.runId} title={`실행 ${view.runId.slice(0, 8)}`} onClose={() => setWatching(false)}
          {...(runningNode ? { step: `${runningNode.name}${lastStep ? ` — ${lastStep.note}` : ""}` } : {})} />
      )}
      <div className="runlog-list">
        <button className={`runlog-item${current === "__result" ? " on" : ""}`} onClick={() => setPicked("__result")}>
          <StatusDot status={view.status} /><span className="grow">워크플로우 결과</span><span className="muted small">{durationText(view.ms)}</span>
        </button>
        {view.nodes.map((n) => (
          <button key={n.id} className={`runlog-item${current === n.id ? " on" : ""}`} onClick={() => { setPicked(n.id); onFocusNode?.(n.id); }}>
            <StatusDot status={n.status === "failed" && n.failure?.problem === "refused" ? "blocked" : n.status} /><span className="grow">{n.name}</span>
            {n.pinned ? <span className="muted small" title="돌지 않고 고정된 출력을 썼습니다 — 여기서부터 다시면 앞 실행의 출력 · 초안 시험이면 고정해 둔 값">그대로 씀</span>
              : <span className="muted small">{n.status === "succeeded" || n.status === "failed" ? durationText(n.ms) : STATUS_TEXT[n.status]}</span>}
          </button>
        ))}
      </div>
      <div className="runlog-detail">
        {current === "__result" || node === null ? (
          <div className="stack">
            {view.message && <div className={`banner ${view.status === "failure" ? "bad" : view.status === "blocked" ? "warn" : "info"}`}>{view.status === "blocked" ? `🚫 막힘 — ${view.message}` : view.message}</div>}
            {view.status === "running" ? (
              <div className="row">
                <span className="muted grow">도는 중…</span>
                {watchable && view.runId && <button className="small" title="실제 브라우저 화면을 봅니다 — 닫으면 화면 보내기를 멈춥니다" onClick={() => setWatching(true)}>실제 화면 보기</button>}
                {watchable && view.runId && <button className="small danger" title="이 실행을 멈춥니다 — 부른 다른 워크플로우 실행도 함께" onClick={() => void api.cancelRun(view.runId).catch(() => undefined)}>멈추기</button>}
              </div>
            )
              : view.status === "blocked" ? <><span className="muted">고르면 안 되는 건이라 막힘 갈래로 이어 갔습니다 — 막힌 노드를 왼쪽에서 고르면 까닭이 보입니다</span><RunTimeline view={view} onPick={(id) => { setPicked(id); onFocusNode?.(id); }} /><h3>워크플로우 결과</h3><ResultView value={view.output ?? {}} fileName="실행 결과" /></>
              : view.status === "success" ? <><RunTimeline view={view} onPick={(id) => { setPicked(id); onFocusNode?.(id); }} /><h3>워크플로우 결과</h3><ResultView value={view.output ?? {}} fileName="실행 결과" /></>
              : view.status === "cancelled" ? <span className="muted">멈춘 실행입니다 — 멈출 때까지 한 일은 왼쪽 노드에서 보입니다</span>
              : failed ? <><RunTimeline view={view} onPick={(id) => { setPicked(id); onFocusNode?.(id); }} /><span className="muted">실패한 노드를 왼쪽에서 고르면 무엇이 · 어디서 · 왜 멈췄는지 보입니다</span></>
              : <span className="muted">노드가 실패한 것이 아니라 «조건» 노드가 워크플로우를 실패로 끝냈습니다 — 위의 메시지가 그 까닭입니다</span>}
          </div>
        ) : (
          <div className="stack">
            {onResumeFrom && view.status !== "running" && (
              <div className="row resume-row"><span className="small muted grow">{node.status === "succeeded" ? "이 단계부터 다시 돌릴 수 있습니다" : "고친 뒤 이 단계부터 다시 돌릴 수 있습니다"} — 앞 단계는 이 실행의 출력을 씁니다</span>
                <button className="small" onClick={() => onResumeFrom(node.id)}>↻ 여기서부터 다시</button></div>
            )}
            <NodeRunDetail n={node} runId={view.runId} {...(onFix ? { onFix } : {})} />
          </div>
        )}
      </div>
    </div>
  );
}

/** 검사 표 — 항목마다 통과 · 불통과 · 기대 · 실제 */
export function CheckTable({ checks }: { checks: NonNullable<NodeRun["checks"]> }) {
  const bad = checks.filter((c) => !c.pass).length;
  return (
    <div className="check-table">
      <div className="row"><b className="grow">검사 {checks.length}개</b>{bad ? <span className="pill bad">불통과 {bad}</span> : <span className="pill ok">모두 통과</span>}</div>
      <table>
        <thead><tr><th /><th>검사</th><th>기대</th><th>실제</th></tr></thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id} className={c.pass ? "" : "bad"}>
              <td>{c.pass ? "✓" : "✗"}</td>
              <td>{c.label}</td>
              <td>{c.expected !== null ? `${c.expected} ` : ""}<span className="muted">{CHECK_OP_LABEL[c.op as keyof typeof CHECK_OP_LABEL] ?? c.op}</span></td>
              <td className="mono">{c.actual}{c.error && <div className="small" style={{ color: "var(--bad)" }}>{c.error}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 불통과일 때의 페이지 한 장 — 없으면(페이지가 없던 실행) 보이지 않는다 */
function CheckShot({ runId }: { runId: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const src = `/api/runs/${encodeURIComponent(runId)}/shot`;
  return (
    <div className="check-shot">
      <span className="small muted">불통과일 때의 화면</span>
      <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="불통과일 때의 화면" onError={() => setGone(true)} /></a>
    </div>
  );
}

/** 사람을 기다리는 중 — 무엇을 · 남은 시간 · 어디서 하나 */
export function HumanWait({ human, onScreen }: { human: NonNullable<RunView["human"]>; onScreen?: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="banner warn human-wait" role="status">
      <b>🙋 사람을 기다리는 중 — «{human.prompt}»</b>
      <span className="grow">{leftText(human.deadline)} 남음 · 끝나면 저절로 이어 갑니다. 사람의 크롬이면 그 크롬 창에서, 아니면 실제 화면에서 직접 하세요.</span>
      {onScreen && <button className="small primary" onClick={onScreen}>실제 화면에서 하기</button>}
    </div>
  );
}

/**
 * 승인을 기다리는 중 — 무엇을 · 누가 · 남은 시간 · [승인] · [거절](한마디). 역할이 모자라면 서버가 막고 그 까닭을 보인다.
 * 답하면 실행이 이어 가거나(승인) 그 노드가 실패해 멈춘다(거절) — 띠는 진행(approval 이벤트)이 걷는다.
 */
export function ApprovalWait({ runId, approval }: { runId: string; approval: NonNullable<RunView["approval"]> }) {
  const [, tick] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const t = window.setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const answer = async (approved: boolean) => {
    setBusy(true);
    setError(null);
    try { await api.answerApproval(runId, approved, comment); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="banner warn approval-wait" role="status">
      <b>🛡️ 승인을 기다리는 중 — «{approval.message}»</b>
      <span className="small">{ROLE_LABEL[approval.minRole]} 이상이 승인합니다 · {leftText(approval.deadline)} 남음 · 거절하거나 시간을 넘기면 멈춥니다</span>
      <div className="row wrap">
        <input className="grow" value={comment} maxLength={500} placeholder="한마디(기록에 남습니다 — 없어도 됩니다)" aria-label="한마디" onChange={(e) => setComment(e.target.value)} />
        <button className="small primary" disabled={busy} onClick={() => void answer(true)}>승인</button>
        <button className="small danger" disabled={busy} onClick={() => void answer(false)}>거절</button>
      </div>
      {error && <span className="small" style={{ color: "var(--bad)" }}>{error}</span>}
    </div>
  );
}

/**
 * **실행 시간표** — 노드마다 언제 시작해 얼마나 걸렸나를 막대로(Airflow의 Gantt처럼). 어느 화면이 느린지 바로 보인다.
 * 옛 기록(시작 시각 없음)은 차례로 이어 붙여 짐작한다. 막대를 누르면 그 노드를 연다.
 */
export function RunTimeline({ view, onPick }: { view: RunView; onPick?: (nodeId: string) => void }) {
  const ran = view.nodes.filter((n) => n.status === "succeeded" || n.status === "failed" || n.status === "blocked");
  if (ran.length < 2) return null;
  // 0은 **첫 노드가 시작한 때** — 실행 기록의 시작(접수한 때)으로 잡으면 차례 · 브라우저 띄우기만큼 막대가 오른쪽으로 밀린다
  const starts = ran.flatMap((n) => (n.startedAt ? [Date.parse(n.startedAt)] : []));
  const t0 = starts.length ? Math.min(...starts) : Date.parse(view.startedAt);
  let cursor = 0;
  const rows = ran.map((n) => {
    const start = n.startedAt ? Math.max(0, Date.parse(n.startedAt) - t0) : cursor;
    cursor = start + n.ms;
    return { n, start, end: start + n.ms };
  });
  const total = Math.max(...rows.map((r) => r.end), 1);
  const slowest = rows.reduce((a, b) => (b.n.ms > a.n.ms ? b : a));
  return (
    <div className="timeline">
      <div className="row"><h3 className="grow">시간표</h3><span className="small muted">가장 오래 — {slowest.n.name} {durationText(slowest.n.ms)} ({Math.round((slowest.n.ms / total) * 100)}%)</span></div>
      {rows.map(({ n, start }) => (
        <button key={n.id} className="tl-row" title={`${n.name} — ${durationText(n.ms)}`} onClick={() => onPick?.(n.id)}>
          <span className="tl-name">{n.name}</span>
          <span className="tl-track">
            <span className={`tl-bar ${n.status === "failed" ? "bad" : ""}`} style={{ left: `${(start / total) * 100}%`, width: `${Math.max(0.6, (n.ms / total) * 100)}%` }} />
          </span>
          <span className="tl-ms">{durationText(n.ms)}</span>
        </button>
      ))}
    </div>
  );
}
