/**
 * **AI 대화** — 떠 있는 AI 창(AiDock) 안. PLAN §42.
 *
 *   말풍선 · 예시 말 · ★AI가 하는 일(실시간 — 묻는 중 → 초안 → 검사 → 고치는 중 → 통과) · 제안 카드(작은 흐름도 · 바뀐 것 · 녹화로 채울 곳)
 *   edit    지금 초안을 고친다 — [캔버스에서 보기] · [버리기] · [적용]
 *   create  새로 만든다 — 다음 말은 직전 제안을 바탕으로 고친다 · [이대로 만들기]
 *   ★적용 · 만들기는 초안만 — 저장 · 게시는 사람이. 대화는 대상마다(create · flow:<id>) 기억한다.
 */
import { useEffect, useRef, useState } from "react";
import type { Flow, FlowNode } from "@flowsmith/core";
import { api, ApiError, listExtensions, type AiStatus } from "../api.ts";
import { blankFlow, diffFlows, subtitleOf } from "../model/index.ts";
import { NODE_META } from "../editor/nodeMeta.tsx";
import { IconCheck, IconX } from "../icons.tsx";
import { AI_KEY_HINT, myAiKey, myAiProvider } from "./key.ts";
import { ask, type Message, type Send, type Step, type Turn } from "./agent.ts";
import { aiBridge, useAiBridge } from "./bridge.ts";

/** 서버가 대신 부른다 — 키는 «내 설정»(머리글) 또는 서버의 것 */
export const serverSend = (flowId: string | null): Send => (req) => api.aiMessages({ ...req, flowId }) as ReturnType<Send>;

/** 쓸 수 있나 — 관리자가 켜 두었고, 내 키(«내 설정») 또는 서버의 키가 있다 */
export const aiUsable = (s: AiStatus | null): boolean => s !== null && s.enabled && (s.providers[myAiProvider()].serverKey !== null || myAiKey() !== null);

export function AiBlocked({ status }: { status: AiStatus }) {
  return (
    <div className="banner warn small">
      {!status.enabled ? "관리자가 AI를 꺼 두었습니다." : <>AI 키가 없습니다 — <a href="#/me">내 설정</a>에서 {AI_KEY_HINT[myAiProvider()].label} API 키를 넣으세요(Claude · Gemini 중 고를 수 있습니다).</>}
    </div>
  );
}

interface Line {
  who: "me" | "ai";
  text: string;
  turn?: Turn;
  /** 그 제안을 견준 바탕 — 편집은 그때의 초안, 만들기는 직전 제안(없으면 빈 것) */
  base?: Flow;
  /** AI가 한 일 */
  steps?: Step[];
  ms?: number;
  state?: "applied" | "dropped";
}
interface Session { lines: Line[]; history: Message[] }

/** 대화 — 대상마다 기억한다(이 탭이 살아 있는 동안) */
const sessions = new Map<string, Session>();
export const forgetSession = (key: string) => sessions.delete(key);

export interface ChatProps {
  /** 기억할 이름 — create · flow:<id> */
  sessionKey: string;
  mode: "edit" | "create";
  draft: Flow | null;
  newId: string;
  flowId: string | null;
  hints: string[];
  placeholder: string;
  /** edit: 적용 · create: 이대로 만들기 */
  onApply: (f: Flow) => void | Promise<void>;
  /** edit: 캔버스 미리 보기 · 걷기 */
  onPreview?: (f: Flow | null) => void;
  previewing?: Flow | null;
}

export function AiChat({ sessionKey, mode, draft, newId, flowId, hints, placeholder, onApply, onPreview, previewing }: ChatProps) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [session, setSessionState] = useState<Session>(() => sessions.get(sessionKey) ?? { lines: [], history: [] });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const setSession = (fn: (s: Session) => Session) => setSessionState((s) => { const n = fn(s); sessions.set(sessionKey, n); return n; });
  useEffect(() => { setSessionState(sessions.get(sessionKey) ?? { lines: [], history: [] }); setText(""); setError(null); }, [sessionKey]);
  useEffect(() => { void api.aiStatus().then(setStatus, (e: Error) => setError(e.message)); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [session.lines, busy, live]);
  const usable = status === null || aiUsable(status);
  const lines = session.lines;
  const latestIndex = lines.map((l) => !!l.turn?.proposal).lastIndexOf(true);
  const latest = latestIndex >= 0 ? lines[latestIndex]!.turn!.proposal!.flow : null;

  const send = async (say: string) => {
    if (!say.trim() || busy) return;
    setError(null);
    setBusy(true);
    setLive([]);
    setSession((s) => ({ ...s, lines: [...s.lines, { who: "me", text: say }] }));
    setText("");
    const base = mode === "edit" ? draft : latest;
    const steps: Step[] = [];
    const t0 = Date.now();
    try {
      const [extensions, flows] = await Promise.all([listExtensions(), api.listFlows().catch(() => [])]);
      const turn = await ask(serverSend(flowId), session.history, say, { draft: base, extensions, flows: flows.filter((f) => f.id !== newId).map((f) => ({ id: f.id, name: f.name })), newId }, {
        onStep: (st) => { steps.push(st); setLive([...steps]); },
      });
      setSession((s) => ({
        history: turn.messages,
        // 처음 만드는 제안은 빈 것과 견준다 — 이름은 같게(«이름 «» → «…»» 줄이 생기지 않게)
        lines: [...s.lines, { who: "ai", text: turn.reply, turn, base: base ?? blankFlow(newId, turn.proposal?.flow.name ?? ""), steps, ms: Date.now() - t0 }],
      }));
      // 편집 — 제안이 오면 바로 캔버스에 그려 보인다(적용 전까지는 초안이 아니다)
      if (mode === "edit" && turn.proposal) onPreview?.(turn.proposal.flow);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
      setLive([]);
    }
  };
  const mark = (i: number, state: Line["state"]) => setSession((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, state } : l)) }));

  return (
    <>
      <div className="ai-body" role="log" aria-label="AI와 나눈 말">
        {status && !aiUsable(status) && <AiBlocked status={status} />}
        {lines.length === 0 && usable && (
          <div className="ai-welcome">
            <b>{mode === "edit" ? "이 워크플로우를 어떻게 바꿀까요?" : "무엇을 자동화할까요?"}</b>
            <span className="small muted">{mode === "edit" ? "말로 고치거나 물어보세요. 제안은 캔버스에 먼저 그려 보이고, 적용해야 초안이 바뀝니다." : "말로 주고받으며 뼈대를 다듬고, 마음에 들면 «이대로 만들기». 웹페이지에서 누를 곳은 만든 뒤 녹화로 채웁니다."}</span>
            <div className="ai-hints">{hints.map((h) => <button key={h} type="button" onClick={() => void send(h)}>{h}</button>)}</div>
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`ai-line ${l.who}`}>
            {l.who === "ai" && l.steps && l.steps.length > 0 && <Steps steps={l.steps} ms={l.ms ?? 0} done />}
            {l.text && <div className="ai-text">{l.text}</div>}
            {l.turn?.proposal && (
              <Proposal base={l.base!} p={l.turn.proposal} mode={mode} state={l.state} stale={i !== latestIndex}
                previewing={!!previewing && previewing === l.turn.proposal.flow}
                onPreview={onPreview ? (on) => onPreview(on ? l.turn!.proposal!.flow : null) : undefined}
                onApply={async () => { await onApply(l.turn!.proposal!.flow); mark(i, "applied"); onPreview?.(null); }}
                onDrop={() => { mark(i, "dropped"); onPreview?.(null); }} />
            )}
            {l.turn && !l.turn.proposal && l.turn.problems.length > 0 && <div className="banner bad small">끝내 고치지 못한 문제 — {l.turn.problems.slice(0, 5).join(" · ")}</div>}
          </div>
        ))}
        {busy && <div className="ai-line ai"><Steps steps={live} ms={0} done={false} /></div>}
        {error && <div className="banner bad small">{error}</div>}
        <div ref={end} />
      </div>
      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea value={text} rows={1} placeholder={usable ? placeholder : "AI를 쓸 수 없습니다"} aria-label="AI에게 말하기" disabled={busy || !usable}
          onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }} />
        <button className="primary" disabled={busy || !text.trim() || !usable}>전송</button>
      </form>
    </>
  );
}

/** ★AI가 하는 일 — 도는 동안은 한 줄씩 늘어나고, 끝나면 접힌 한 줄(눌러 펼침) */
function Steps({ steps, ms, done }: { steps: Step[]; ms: number; done: boolean }) {
  const [open, setOpen] = useState(!done);
  useEffect(() => { if (!done) setOpen(true); }, [done]);
  const rows = steps.map((s, i) => {
    const last = i === steps.length - 1;
    const running = !done && last;
    const n = s.round + 1;
    switch (s.kind) {
      case "ask": {
        const prev = steps[i - 1]?.kind;
        return { running, ok: !running, text: n === 1 ? "요청을 읽고 설계하는 중" : prev === "accepted" ? "답을 정리하는 중" : `고친 것을 다시 설계하는 중 (${n}번째)` };
      }
      case "proposed": return { running, ok: !running, text: `초안 — 노드 ${s.nodes}개${s.summary ? ` · ${s.summary}` : ""} · 검사하는 중` };
      case "rejected": return { running: false, ok: false, bad: true, text: `문제 ${s.problems.length}개 — 고쳐 달라고 돌려줌${s.problems[0] ? ` («${s.problems[0].slice(0, 60)}${s.problems[0].length > 60 ? "…" : ""}»)` : ""}` };
      case "accepted": return { running: false, ok: true, text: `검사 통과 — 노드 ${s.nodes}개${s.todo ? ` · 녹화로 채울 곳 ${s.todo}곳` : ""}` };
      case "reply": return { running, ok: !running, text: "답했습니다" };
    }
  });
  if (!done && rows.length === 0) rows.push({ running: true, ok: false, text: "AI에게 보내는 중" });
  return (
    <div className={`ai-steps${done ? " done" : ""}`}>
      {done && <button type="button" className="ai-steps-head" aria-expanded={open} onClick={() => setOpen(!open)}>AI가 한 일 · {steps.length}단계 · {(ms / 1000).toFixed(1)}초 {open ? "▴" : "▾"}</button>}
      {!done && <div className="ai-steps-head live">AI가 일하는 중…</div>}
      {open && (
        <ol>
          {rows.map((r, i) => (
            <li key={i} className={r.running ? "running" : "bad" in r && r.bad ? "bad" : r.ok ? "ok" : ""}>
              <span className="ai-step-mark">{r.running ? <span className="spinner" /> : "bad" in r && r.bad ? <IconX size={12} strokeWidth={2.6} /> : <IconCheck size={12} strokeWidth={2.6} />}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** 바뀐 노드 — 더함 · 바뀜(설정 · 이름) */
function nodeChanges(base: Flow, flow: Flow): Map<string, "added" | "changed"> {
  const before = new Map(base.nodes.map((n) => [n.id, JSON.stringify({ ...n, position: null })]));
  const out = new Map<string, "added" | "changed">();
  for (const n of flow.nodes) {
    const b = before.get(n.id);
    if (b === undefined) out.set(n.id, "added");
    else if (b !== JSON.stringify({ ...n, position: null })) out.set(n.id, "changed");
  }
  return out;
}
export { nodeChanges };

/** ★작은 흐름도 — 노드를 깊이대로 늘어놓고 선으로 잇는다 · 누르면 그 노드가 하는 일 */
function MiniGraph({ base, flow, todo }: { base: Flow; flow: Flow; todo: string[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const changes = nodeChanges(base, flow);
  const depth = new Map<string, number>();
  const ins = new Map<string, string[]>();
  for (const e of flow.edges) ins.set(e.to.node, [...(ins.get(e.to.node) ?? []), e.from.node]);
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const v = Math.max(-1, ...(ins.get(id) ?? []).map((p) => d(p, seen))) + 1;
    depth.set(id, v);
    return v;
  };
  const cols: FlowNode[][] = [];
  for (const n of flow.nodes) (cols[d(n.id)] ??= []).push(n);
  const removed = base.nodes.filter((n) => !flow.nodes.some((x) => x.id === n.id));
  const sel = flow.nodes.find((n) => n.id === picked) ?? null;
  return (
    <div className="ai-graph">
      <div className="ai-graph-row">
        {cols.map((col, ci) => (
          <div key={ci} className="ai-graph-col">
            {ci > 0 && <span className="ai-graph-arrow" aria-hidden="true">→</span>}
            <div className="ai-graph-stack">
              {col.map((n) => {
                const meta = NODE_META[n.type];
                const Icon = meta.icon;
                const ch = changes.get(n.id);
                return (
                  <button key={n.id} type="button" className={`ai-graph-node${ch ? ` ${ch}` : ""}${picked === n.id ? " on" : ""}`} title={`${meta.title} · ${n.name}`} onClick={() => setPicked(picked === n.id ? null : n.id)}>
                    <span className={`mini-tile t-${n.type}`}><Icon size={14} /></span>
                    <span className="ai-graph-name">{n.name}</span>
                    {ch && <span className="ai-graph-badge">{ch === "added" ? "새로" : "바뀜"}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {removed.length > 0 && <span className="small ai-graph-removed">지움 — {removed.map((n) => n.name).join(", ")}</span>}
      {sel && (
        <div className="ai-graph-detail small">
          <b>{sel.name}</b> <span className="muted">{NODE_META[sel.type].title}</span>
          <div>{subtitleOf(sel) || "설정 없음"}</div>
          {sel.type === "web" && sel.config.actions.length > 0 && (
            <ul>{sel.config.actions.map((a) => { const label = "target" in a && a.target ? a.target.label : a.kind === "readTable" ? a.table.label : a.kind; const t = todo.includes(`${sel.name} › ${label}`); return <li key={a.id}>{label}{"output" in a && a.output ? ` → ${a.output}` : ""}{t && <span className="ai-todo-pill">녹화로</span>}</li>; })}</ul>
          )}
        </div>
      )}
    </div>
  );
}

function Proposal({ base, p, mode, state, stale, previewing, onPreview, onApply, onDrop }: {
  base: Flow; p: NonNullable<Turn["proposal"]>; mode: "edit" | "create"; state: Line["state"]; stale: boolean; previewing: boolean;
  onPreview?: (on: boolean) => void; onApply: () => Promise<void>; onDrop: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  useAiBridge();   // 캔버스 띠의 «적용»을 알아듣는다
  if (aiBridge.wasApplied(p.flow) && state !== "applied") state = "applied";
  const changes = diffFlows(base, p.flow);
  const done = state !== undefined || stale;
  return (
    <div className={`ai-proposal${stale && !state ? " stale" : ""}`}>
      <div className="ai-proposal-head"><b>{mode === "create" ? `«${p.flow.name}»` : "제안"}</b>{p.summary && <span className="muted"> — {p.summary}</span>}</div>
      <MiniGraph base={base} flow={p.flow} todo={p.todo} />
      {changes.length > 0 && (
        <button type="button" className="ai-more small" aria-expanded={more} onClick={() => setMore(!more)}>바뀐 것 {changes.length}가지 {more ? "▴" : "▾"}</button>
      )}
      {more && <ul className="ai-changes small">{changes.slice(0, 40).map((c, i) => <li key={i} className={`c-${c.kind}`}><span className="muted">{c.where}</span> {c.text}</li>)}</ul>}
      {p.todo.length > 0 && <div className="ai-todo small">녹화로 채울 곳 {p.todo.length}곳 — {p.todo.join(" · ")}</div>}
      {state === "applied" ? <span className="small ok-text">{mode === "create" ? "만들었습니다" : "적용했습니다 — 저장하면 남습니다"}</span>
        : state === "dropped" ? <span className="small muted">버렸습니다</span>
        : stale ? <span className="small muted">다음 제안으로 바뀌었습니다</span>
        : mode === "create" ? (
          <div className="ai-actions"><span className="small muted grow">더 고칠 것이 있으면 아래에 말하세요</span><button className="small primary" disabled={busy} onClick={() => { setBusy(true); void onApply().finally(() => setBusy(false)); }}>{busy ? "만드는 중…" : "이대로 만들기"}</button></div>
        ) : (
          <div className="ai-actions">
            {onPreview && <button className={`small${previewing ? " on" : ""}`} onClick={() => onPreview(!previewing)}>{previewing ? "미리 보기 걷기" : "캔버스에서 보기"}</button>}
            <span className="grow" />
            <button className="small" onClick={onDrop}>버리기</button>
            <button className="small primary" disabled={changes.length === 0} onClick={() => void onApply()}>적용</button>
          </div>
        )}
      {!done && changes.length === 0 && <span className="small muted">바뀐 것이 없습니다</span>}
    </div>
  );
}
