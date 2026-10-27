/**
 * **편집 화면** — n8n의 배치를 본떴다.
 *
 *   ┌ 머리: ← · 이름(바로 고침) · 저장 상태 │ 편집기 | 실행 기록 │ 문제 · ⚙ · 저장 · 게시 ▾ ┐
 *   │ 캔버스(전체 폭)                                    │ 서랍(노드 · 고르기 · 설정) │
 *   │                 [ ▶ 플로우 실행 ]                   │                            │
 *   └ 로그 패널(실행하면 열린다) ────────────────────────────────────────────────────┘
 *
 * 초안은 이 화면이 들고 있다가 「저장」에서 서버로 간다. 문제는 브라우저에서 바로 계산한다 —
 * core의 `checkFlow`가 순수 함수라 서버와 같은 판정이 고치는 즉시 나온다.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { checkFlow, type Flow, type FlowNode, type Target, type WebAction, explainProblems, problemLine, type ProblemView, PROBE_STATUS_LABEL } from "@flowsmith/core";
import { api, ApiError, listExtensions, type ExtensionMeta } from "../api.ts";
import { addRecorded, applyTarget, hasAction, insertNode, promoteCandidate, splitStages, splitWebNode, targetLabel, type AddRequest, type Fix, type NodeChoice } from "../model/index.ts";
import { IconAlert, IconArrowLeft, IconCheck, IconClock, IconChevronDown, IconChevronUp, IconGear, IconBell, IconRocket, IconX } from "../icons.tsx";
import { Canvas } from "./canvas/Canvas.tsx";
import { Executions } from "./run/Executions.tsx";
import { NodeView, type RunPart } from "./inspectors/NodeView.tsx";
import { VersionDiff } from "./VersionDiff.tsx";
import { NameModal, NEW_FLOW_KEY } from "./NameModal.tsx";
import { aiBridge } from "../ai/bridge.ts";
import { nodeChanges } from "../ai/AiChat.tsx";
import { NodePicker } from "./canvas/NodePicker.tsx";
import { Recorder, type RecordStart } from "./record/Recorder.tsx";
import { DriftBanner, MonitorPanel, statusPill, useMonitor } from "./monitor/Monitor.tsx";
import { TriggersPanel } from "./settings/TriggersPanel.tsx";
import { RunLauncher } from "./run/RunLauncher.tsx";
import { RunLog, StatusDot, runStatusText } from "./run/RunLog.tsx";
import { RunScreen } from "../live/RunScreen.tsx";
import { SettingsPanel } from "./settings/SettingsPanel.tsx";
import { NotifyPanel } from "./settings/NotifyPanel.tsx";
import { Guide, guideItems } from "./Guide.tsx";
import { useMe } from "../shell/me.ts";
import { useRun } from "./run/useRun.ts";
import { Toast } from "./widgets.tsx";
import { recallParams } from "../shell/remember.ts";
import { useFlowDraft } from "./useFlowDraft.ts";

type Drawer = { kind: "node"; id: string } | { kind: "picker"; req: AddRequest } | { kind: "settings" } | { kind: "monitor" } | { kind: "triggers" } | { kind: "notify" } | null;

/** 노드 창 · 타일에 보일 문제 — 자리에서 노드 이름은 빼고(이미 그 노드다) */
const inNode = (v: ProblemView): string => { const rest = v.where.split(" › ").slice(1).join(" › "); return rest ? `${rest}: ${v.text}` : v.text; };

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    addEventListener("mousedown", on);
    return () => removeEventListener("mousedown", on);
  }, [open, close]);
  return ref;
}

/** runId — 그 실행을 고른 «실행 기록»으로 연다 · panel "monitor" — 변경 감시 서랍을 열어 둔다(알림의 링크) */
export function FlowEditor({ id, runId, panel }: { id: string; runId?: string; panel?: "monitor" }) {
  const [drawer, setDrawer] = useState<Drawer>(panel === "monitor" ? { kind: "monitor" } : null);
  // 사내 서버형 — 편집자보다 아래면 보기 전용(서버도 막는다 · 여기는 단추를 감춘다)
  const me = useMe();
  const canEdit = me.can("editor");
  const [view, setViewTab] = useState<"editor" | "executions">(runId ? "executions" : "editor");
  const [logOpen, setLogOpen] = useState(false);
  /** 실행 화면 보기 — 보고 있는 실행 id */
  const [watching, setWatching] = useState<string | null>(null);
  const [menu, setMenu] = useState<"publish" | "problems" | null>(null);
  /** 버전 비교 창 */
  const [comparing, setComparing] = useState(false);
  /** 방금 만든 빈 플로우 — 이름을 묻는다(목록이 표시해 둔다 · 한 번만) */
  const [naming, setNaming] = useState(() => {
    try {
      if (sessionStorage.getItem(NEW_FLOW_KEY) !== id) return false;
      sessionStorage.removeItem(NEW_FLOW_KEY);
      return true;
    } catch { return false; }
  });
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const [recording, setRecording] = useState<RecordStart | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((t: string) => {
    setToast({ text: t });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);
  /** 되돌릴 수 있는 알림 — 노드를 지웠을 때 */
  const sayUndo = useCallback((t: string, undo: () => void) => {
    setToast({ text: t, action: { label: "되돌리기", run: () => { undo(); setToast(null); } } });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 8000);
  }, []);
  // 초안 — 읽기 · 고치기 · 저장 · 닫을 때 묻기(useFlowDraft)
  const { detail, setDetail, draft, update, dirty, save, ensureSaved, accept, busy, loadError } = useFlowDraft(id, say);
  const run = useRun(draft, detail?.activeVersion ?? null);
  const monitor = useMonitor(id, (t) => say(t));
  const pinnedSet = useMemo(() => new Set(Object.keys(detail?.pins ?? {})), [detail?.pins]);
  // ★떠 있는 AI 창(ai/AiDock.tsx)에 이 워크플로우를 건다 — 고치기 · 적용 · 캔버스 미리 보기(적용 전까지 초안은 그대로)
  const [aiPreview, setAiPreview] = useState<Flow | null>(null);
  const applyAi = useCallback((f: Flow) => { aiBridge.markApplied(f); update(() => f); setAiPreview(null); say("AI의 제안을 적용했습니다 — 저장하면 남습니다(녹화로 채울 곳은 문제 목록에 보입니다)"); }, [update, say]);
  useEffect(() => {
    if (!draft || !canEdit) { aiBridge.setTarget(null); return; }
    aiBridge.setTarget({ flowId: id, draft, apply: applyAi, preview: setAiPreview, previewing: aiPreview });
  }, [id, draft, aiPreview, canEdit, applyAi]);
  useEffect(() => () => aiBridge.setTarget(null), []);
  const aiMarks = useMemo(() => (aiPreview && draft ? nodeChanges(draft, aiPreview) : undefined), [aiPreview, draft]);
  // 확장 플러그인 — 게시된 버전을 만들 때의 플러그인 버전과 지금이 다르면 알린다(점검 실행으로 확인하게 · PLAN §41)
  const [exts, setExts] = useState<ExtensionMeta[] | null>(null);
  useEffect(() => { void listExtensions().then(setExts); }, []);
  const pluginDrift = useMemo(() => {
    if (!detail || exts === null || detail.activeVersion === null) return [];
    const used = detail.versions.find((v) => v.version === detail.activeVersion)?.plugins ?? {};
    return Object.entries(used).flatMap(([pid, was]) => {
      const now = exts.find((e) => e.plugin?.id === pid)?.plugin;
      return now?.version === was ? [] : [{ name: now?.name ?? pid, was, now: now?.version ?? null }];
    });
  }, [detail, exts]);
  // 사람 기다리기 — 방금 누른 실행이 사람을 기다리기 시작하면 로그를 펴고, 서버 브라우저면 실제 화면을 바로 연다(사람의 크롬 · 앱 안 브라우저면 그 창에서 한다)
  const waitingFor = run.view?.status === "running" && run.view.human ? run.view.runId : null;
  useEffect(() => {
    if (!waitingFor) return;
    setLogOpen(true);
    if (draft?.settings.browser !== "attach" && draft?.settings.browser !== "app") setWatching(waitingFor);
  }, [waitingFor]);
  // 실행이 끝나면 감시 기록도 다시 본다 — 실제 실행이 깨진 것을 발견했을 수 있다
  const runStatus = run.view?.status;
  useEffect(() => { if (runStatus && runStatus !== "running") void monitor.reload(); }, [runStatus]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuRef = useOutside(menu !== null, closeMenu);

  const problems = useMemo(() => (draft ? checkFlow(draft) : []), [draft]);
  // 사람 말로 — 어디(노드 › 동작) · 무엇을 어떻게. 같은 까닭은 한 줄로(core problems.ts)
  const explained = useMemo(() => (draft ? explainProblems(problems, draft) : []), [problems, draft]);
  const issues = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of explained) if (v.nodeId) m.set(v.nodeId, [...(m.get(v.nodeId) ?? []), inNode(v)]);
    return m;
  }, [explained]);

  const requestAdd = useCallback((req: AddRequest) => setDrawer({ kind: "picker", req }), []);

  // 키보드 — Ctrl+S 저장 · Tab 노드 더하기 · Esc 서랍 닫기
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty) void save().then((ok) => ok && say("저장했습니다")); return; }
      // Esc는 칸에 글자를 넣던 중에도 닫는다 — 노드 창이 캔버스를 덮고 있다(n8n처럼)
      if (e.key === "Escape") { setDrawer(null); return; }
      if (typing(e.target)) return;
      if (e.key === "Tab" && view === "editor") { e.preventDefault(); setDrawer({ kind: "picker", req: { kind: "at", position: { x: 0, y: 0 } } }); }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [dirty, save, say, view]);

  const startRun = useCallback(async (target: Parameters<typeof run.start>[0], params: Record<string, string>, opts: { on?: string; resetWallet?: boolean } = {}) => {
    if (target === "draft" && !(await ensureSaved())) return false;
    const part = { ...(opts.on ? { on: opts.on } : {}), ...(opts.resetWallet ? { resetWallet: true } : {}) };
    const ok = await run.start(target, params, Object.keys(part).length ? part : undefined);
    if (ok) setLogOpen(true);
    return ok;
  }, [ensureSaved, run]);

  /** 단계 실행 — 초안을 이 노드 앞까지(입력 보기) · 이 노드까지(출력 보기). 실행 입력은 마지막에 넣은 값 */
  const runPart = async (nodeId: string, part: RunPart) => {
    if (!(await ensureSaved())) return;
    const remembered = recallParams(draft!.id);
    await run.start("draft", { ...draft!.settings.probeParams, ...remembered }, part === "before" ? { stopBefore: nodeId } : { stopAfter: nodeId });
  };

  async function publish(kind: "new" | "version-only" | { deploy: number | null }) {
    setMenu(null);
    try {
      if (kind === "new" || kind === "version-only") {
        if (!(await ensureSaved())) return;
        const { version } = await api.createVersion(id, "");
        if (kind === "new") await api.deploy(id, version);
        say(kind === "new" ? `v${version}을(를) 만들어 게시했습니다` : `v${version}을(를) 만들었습니다`);
      } else {
        await api.deploy(id, kind.deploy);
        say(kind.deploy === null ? "게시를 내렸습니다" : `v${kind.deploy}을(를) 게시했습니다`);
      }
      accept(await api.getFlow(id));
    } catch (e) {
      say(e instanceof ApiError ? [e.message, ...explainProblems(e.problems, draft).slice(0, 2).map(problemLine)].join(" · ") : String(e));
    }
  }

  if (loadError) return <div className="page"><div className="banner bad">{loadError}</div><p><a href="#/">← 목록으로</a></p></div>;
  if (!draft || !detail) return <div className="page muted">불러오는 중…</div>;

  const selected = drawer?.kind === "node" ? drawer.id : null;
  const node = selected ? draft.nodes.find((n) => n.id === selected) ?? null : null;
  const updateNode = (nid: string) => (fn: (n: FlowNode) => FlowNode) => update((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === nid ? fn(n) : n)) }));
  /** 노드 지우기 — 캔버스 도구 막대 · 오른쪽 클릭 · Delete 키 · 노드 창이 모두 이리로. 지운 노드와 그 선은 «되돌리기»로 살린다 */
  const removeNodes = (ids: string[]) => {
    const gone = draft.nodes.filter((n) => ids.includes(n.id));
    if (gone.length === 0) return;
    const goneEdges = draft.edges.filter((e) => ids.includes(e.from.node) || ids.includes(e.to.node));
    update((f) => ({ ...f, nodes: f.nodes.filter((n) => !ids.includes(n.id)), edges: f.edges.filter((e) => !ids.includes(e.from.node) && !ids.includes(e.to.node)) }));
    if (drawer?.kind === "node" && ids.includes(drawer.id)) setDrawer(null);
    sayUndo(gone.length === 1 ? `«${gone[0]!.name}» 노드를 지웠습니다` : `노드 ${gone.length}개를 지웠습니다`, () => update((f) => {
      const have = new Set(f.nodes.map((n) => n.id));
      const nodes = [...f.nodes, ...gone.filter((n) => !have.has(n.id))];
      const ok = new Set(nodes.map((n) => n.id));
      const eids = new Set(f.edges.map((e) => e.id));
      return { ...f, nodes, edges: [...f.edges, ...goneEdges.filter((e) => !eids.has(e.id) && ok.has(e.from.node) && ok.has(e.to.node))] };
    }));
  };
  const pick = (type: NodeChoice) => {
    if (drawer?.kind !== "picker") return;
    let req = drawer.req;
    // Tab · ＋버튼은 위치를 모른다 — 고른 노드 뒤, 없으면 맨 끝 노드 오른쪽
    if (req.kind === "at" && req.position.x === 0 && req.position.y === 0 && draft.nodes.length > 0) {
      const last = draft.nodes.reduce((a, b) => (b.position.x > a.position.x ? b : a));
      req = { kind: "at", position: { x: last.position.x + 260, y: last.position.y } };
    }
    const r = insertNode(draft, type, req);
    update(() => r.flow);
    setDrawer({ kind: "node", id: r.nodeId });
  };
  const nodeRun = run.view?.nodes.find((n) => n.id === selected) ?? null;
  // 이 노드가 받을 입력 — 돌았으면 받은 것, 아니면 앞 노드들이 마지막 실행에서 내놓은 것(미리 보기용)
  const sample = ((): Record<string, unknown> | null => {
    if (nodeRun?.input) return nodeRun.input;
    if (!run.view || !selected) return null;
    const outs = draft.edges.filter((e) => e.to.node === selected).map((e) => run.view!.nodes.find((n) => n.id === e.from.node)?.output).filter((o): o is Record<string, unknown> => !!o);
    return outs.length ? Object.assign({}, ...outs) as Record<string, unknown> : null;
  })();
  const canVersion = problems.length === 0 && (dirty || detail.draftChanged);
  /** 다시 지정 — 그 동작 앞까지 재생해 레코더를 연다 */
  const repick = (nodeId: string, actionId: string) => {
    const n = draft.nodes.find((x) => x.id === nodeId);
    const a = n?.type === "web" ? n.config.actions.find((x) => x.id === actionId) : undefined;
    if (!a) return;
    const remembered = recallParams(draft.id);
    setRecording({ nodeId, params: { ...draft.settings.probeParams, ...remembered }, replay: true, replayExisting: false, repick: { actionId, kind: a.kind, label: targetLabel(a) } });
  };
  /** 다시 지정한 위치를 그 동작에 넣는다 — 나머지(값 · 출력 이름 · 되돌릴 수 없음)는 그대로 */
  const applyRepick = (target: Target) => {
    const { nodeId, repick: rp } = recording!;
    update((f) => applyTarget(f, nodeId, rp!.actionId, target));
    setRecording(null);
    setDrawer({ kind: "node", id: nodeId });
    say("위치를 다시 지정했습니다 — 저장하고 한 번 돌려 본 뒤 새 버전으로 게시하세요");
  };
  /** 실패 카드의 고치는 단추 — 실행 기록에서 눌러도 편집기로 와서 그 자리를 연다 */
  const onFix = (fix: Fix) => {
    setViewTab("editor");
    switch (fix.kind) {
      case "repick":
        if (!hasAction(draft, fix.nodeId, fix.actionId)) { say("초안에 그 동작이 없습니다 — 게시된 버전과 초안이 다릅니다. 노드를 열어 확인하세요"); setDrawer({ kind: "node", id: fix.nodeId }); return; }
        repick(fix.nodeId, fix.actionId);
        return;
      case "candidate": {
        const next = promoteCandidate(draft, fix.nodeId, fix.actionId, fix.locator);
        if (!next) { say("초안에 그 동작이 없습니다 — 노드를 열어 확인하세요"); setDrawer({ kind: "node", id: fix.nodeId }); return; }
        update(() => next);
        setDrawer({ kind: "node", id: fix.nodeId });
        say("그 위치를 1순위로 바꿨습니다 — 저장하고 한 번 돌려 본 뒤 새 버전으로 게시하세요");
        return;
      }
      case "open": setDrawer({ kind: "node", id: fix.nodeId }); return;
      case "settings": setDrawer({ kind: "settings" }); return;
      case "retries":
        update((f) => ({ ...f, settings: { ...f.settings, retries: Math.max(2, f.settings.retries) } }));
        setDrawer({ kind: "settings" });
        say("다시 해 보기를 켰습니다(2번) — 저장하고 새 버전으로 게시하면 다음 실행부터 씁니다");
        return;
    }
  };

  /** 웹페이지 노드 나누기 — 사람 기다리기마다 · 이 동작부터(되돌릴 수 있다) */
  const splitNode = (nodeId: string, cuts: number[] | "stages") => {
    const before = draft!;
    const r = cuts === "stages" ? splitStages(before, nodeId) : splitWebNode(before, nodeId, cuts);
    if (r.ids.length < 2) { say("나눌 곳이 없습니다"); return; }
    update(() => r.flow);
    setDrawer(null);
    sayUndo(`노드를 ${r.ids.length}개로 나눴습니다 — 같은 페이지에서 이어 돌고, 읽은 값도 뒤로 이어집니다. 저장하면 남습니다`, () => update(() => before));
  };

  /** 녹화 끝 — 동작을 붙이고, 고른 곳(사람 기다리기 앞뒤 · «여기서 새 노드»)에서 노드를 나눈다 */
  const commitRecording = (actions: WebAction[], cuts: number[] = []) => {
    const nid = recording!.nodeId;
    const had = draft!.nodes.find((n) => n.id === nid);
    const offset = had?.type === "web" ? had.config.actions.length : 0;
    const added = addRecorded(draft!, nid, actions);
    const r = cuts.length ? splitWebNode(added, nid, cuts.map((c) => c + offset)) : { flow: added, ids: [nid] };
    const made = r.ids.length;
    update(() => r.flow);
    setRecording(null);
    if (cuts.length === 0) setDrawer({ kind: "node", id: nid });
    else setDrawer(null);
    say(made > 1 ? `동작 ${actions.length}개를 노드 ${made}개로 나눠 넣었습니다 — 저장하면 남습니다` : `동작 ${actions.length}개를 넣었습니다 — 저장하면 남습니다`);
  };
  const goList = (e: ReactMouseEvent) => { if (dirty && !confirm("저장하지 않은 고침이 있습니다. 떠날까요?")) e.preventDefault(); };
  /** 켜 둔 트리거 수 — 일정 · 다른 플로우가 끝나면 · 파일이 생기면 */
  const triggerCount = [...draft.settings.schedules, ...(draft.settings.after ?? []), ...(draft.settings.fileTriggers ?? [])].filter((t) => t.enabled).length;

  return (
    <div className={`editor${logOpen && run.view && view === "editor" ? " with-log" : ""}`}>
      <header className="topbar">
        <div className="topbar-left">
          <a href="#/" className="icon-btn" title="목록" onClick={goList}><IconArrowLeft /></a>
          <span className="crumb">워크플로우 /</span>
          <input className="title-input" value={draft.name} aria-label="워크플로우 이름" onChange={(e) => update((f) => ({ ...f, name: e.target.value }))} />
          <span className={`save-state${dirty ? " dirty" : ""}`}>{dirty ? "저장 안 됨" : "저장됨"}</span>
        </div>
        <div className="seg-tabs center">
          <button className={view === "editor" ? "on" : ""} onClick={() => setViewTab("editor")}>편집기</button>
          <button className={view === "executions" ? "on" : ""} onClick={() => setViewTab("executions")}>실행 기록</button>
        </div>
        <div className="topbar-right" ref={menuRef}>
          <div className="menu-anchor">
            <button className={`issue-btn${problems.length ? " bad" : " ok"}`} onClick={() => setMenu(menu === "problems" ? null : "problems")}
              title={problems.length ? "문제 목록" : "문제 없음"}>
              {problems.length ? <IconAlert size={15} /> : <IconCheck size={15} strokeWidth={2.4} />} {problems.length ? `문제 ${explained.length}` : "문제 없음"}
            </button>
            {menu === "problems" && (
              <div className="menu wide">
                {problems.length === 0 ? <div className="menu-note">문제가 없습니다 — 게시할 수 있습니다</div>
                  : explained.map((v, i) => (
                    <button key={i} className="menu-item problem-item" title={v.raw} onClick={() => { if (v.nodeId) setDrawer({ kind: "node", id: v.nodeId }); setMenu(null); }}>
                      {v.where && <span className="problem-where">{v.where}</span>}<span>{v.text}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          <button className={`issue-btn monitor-btn ${monitor.latest ? statusPill(monitor.latest.status) : ""}`} title="변경 감시" onClick={() => setDrawer(drawer?.kind === "monitor" ? null : { kind: "monitor" })}>
            {monitor.running ? "점검 중…" : monitor.latest ? `감시 · ${PROBE_STATUS_LABEL[monitor.latest.status]}` : "감시"}
          </button>
          <button className="icon-btn trig-btn" title="트리거 — 일정 · 다른 워크플로우가 끝나면 · 파일이 생기면 · 웹훅" onClick={() => setDrawer(drawer?.kind === "triggers" ? null : { kind: "triggers" })}>
            <IconClock />{triggerCount > 0 && <span className="trig-count">{triggerCount}</span>}
          </button>
          <button className="icon-btn trig-btn notify-btn" title="알림 — 실패 · 회복 · 사이트가 바뀜 → Slack · Teams · 웹훅" onClick={() => setDrawer(drawer?.kind === "notify" ? null : { kind: "notify" })}>
            <IconBell />{draft.settings.notify.some((r) => r.enabled) && <span className="trig-count">{draft.settings.notify.filter((r) => r.enabled).length}</span>}
          </button>
          <button className="icon-btn" title="워크플로우 설정 — 실행 입력 · 변수 · 시크릿 · 금지 버튼" onClick={() => setDrawer(drawer?.kind === "settings" ? null : { kind: "settings" })}><IconGear /></button>
          {canEdit && <button disabled={!dirty || busy} onClick={() => void save().then((ok) => ok && say("저장했습니다"))}>저장</button>}
          <div className="menu-anchor">
            <button className="primary" disabled={!canEdit} title={canEdit ? "" : "게시는 편집자 이상이 합니다"} onClick={() => setMenu(menu === "publish" ? null : "publish")}>
              <IconRocket size={15} /> {detail.activeVersion === null ? "게시" : `게시됨 v${detail.activeVersion}`} <IconChevronDown size={14} />
            </button>
            {menu === "publish" && (
              <div className="menu">
                <button className="menu-item strong" disabled={!canVersion} onClick={() => void publish("new")}>
                  새 버전으로 게시<span className="menu-hint">{problems.length ? "문제를 먼저 고치세요" : !canVersion ? "마지막 버전과 같습니다" : "지금 초안을 버전으로 굳혀 게시"}</span>
                </button>
                <button className="menu-item" disabled={!canVersion} onClick={() => void publish("version-only")}>버전만 만들기</button>
                {detail.versions.length > 0 && <button className="menu-item" onClick={() => { setMenu(null); setComparing(true); }}>바뀐 것 보기<span className="menu-hint">두 버전(또는 초안)을 견줍니다 — 게시 전에 무엇이 바뀌었나</span></button>}
                {detail.versions.length > 0 && <div className="menu-sep">버전</div>}
                {detail.versions.map((v) => (
                  <button key={v.version} className="menu-item" disabled={v.version === detail.activeVersion} onClick={() => void publish({ deploy: v.version })}>
                    v{v.version}{v.version === detail.activeVersion ? " · 게시 중" : " 게시하기"}
                    <span className="menu-hint">{new Date(v.createdAt).toLocaleString("ko-KR")}{v.createdBy ? ` · ${v.createdBy}` : ""}{v.note ? ` · ${v.note}` : ""}</span>
                  </button>
                ))}
                {detail.activeVersion !== null && <a className="menu-item" href={`#/run/${encodeURIComponent(id)}`}>실행 폼 열기<span className="menu-hint">입력만 넣고 게시된 버전을 돌리는 페이지 — 이 주소를 실행자에게 주세요</span></a>}
                {detail.activeVersion !== null && <button className="menu-item danger" onClick={() => void publish({ deploy: null })}>게시 내리기</button>}
              </div>
            )}
          </div>
        </div>
      </header>

      {comparing && <VersionDiff detail={detail} draft={draft} onClose={() => setComparing(false)} />}
      {naming && <NameModal initial={draft.name}
        onDone={(name) => { setNaming(false); void api.saveDraft(id, { ...draft, name }).then(accept, (e: Error) => say(e.message)); }}
        onCancel={() => { setNaming(false); void api.deleteFlow(id).catch(() => undefined).finally(() => { location.hash = "#/"; }); }} />}
      {pluginDrift.length > 0 && !recording && (
        <div className="drift-banner warn plugin-drift">
          <IconAlert size={16} />
          <strong>확장이 바뀌었습니다</strong>
          <span className="grow">게시된 v{detail.activeVersion}을 만들 때와 다릅니다 — {pluginDrift.map((d) => `${d.name} ${d.was} → ${d.now ?? "없음(꺼짐)"}`).join(" · ")}. 점검 실행으로 아직 잘 도는지 확인하세요</span>
          <button className="small" disabled={monitor.running} onClick={() => void monitor.start(detail.activeVersion ?? "draft")}>{monitor.running ? "점검 중…" : "점검 실행"}</button>
        </div>
      )}
      <DriftBanner latest={recording ? null : monitor.latest} running={monitor.running} onOpen={() => setDrawer({ kind: "monitor" })} onProbe={() => void monitor.start(detail.activeVersion ?? "draft")} />
      {recording ? (
        <main className="rec-main"><Recorder flow={draft} start={recording} onCommit={commitRecording} onRepick={applyRepick} onCancel={() => setRecording(null)} /></main>
      ) : view === "executions" ? (
        <main className="exec-main"><Executions history={run.history} onReload={run.reloadHistory} onFix={onFix} draft={draft} {...(runId ? { initial: runId } : {})} /></main>
      ) : (
        <main className={`work${drawer && drawer.kind !== "node" ? " with-drawer" : ""}`}>
          <Canvas flow={aiPreview ?? draft} selected={aiPreview ? null : selected} statuses={aiPreview ? {} : run.statuses} issues={aiPreview ? new Map() : issues} drift={monitor.drift} pinned={pinnedSet} readOnly={!!aiPreview}
            {...(aiMarks ? { aiMarks } : {})}
            onSelect={(nid) => setDrawer(nid ? { kind: "node", id: nid } : null)} onChange={update} onRequestAdd={requestAdd} onToast={say} onRemoveNodes={removeNodes} {...(canEdit && !aiPreview ? { onSplitStages: (nid: string) => splitNode(nid, "stages") } : {})}>
            {aiPreview && (
              <div className="ai-preview-bar" role="status">
                <span className="ai-dock-spark" aria-hidden="true">✦</span>
                <span><b>AI 제안 미리 보기</b> — 새로 {[...(aiMarks?.values() ?? [])].filter((v) => v === "added").length} · 바뀜 {[...(aiMarks?.values() ?? [])].filter((v) => v === "changed").length}{draft.nodes.filter((n) => !aiPreview.nodes.some((x) => x.id === n.id)).length ? ` · 지움 ${draft.nodes.filter((n) => !aiPreview.nodes.some((x) => x.id === n.id)).length}` : ""}</span>
                <button className="small" onClick={() => setAiPreview(null)}>닫기</button>
                <button className="small primary" onClick={() => applyAi(aiPreview)}>적용</button>
              </div>
            )}
            <RunLauncher flow={draft} detail={detail} running={run.view?.status === "running"} error={run.error} onRun={startRun} {...(canEdit ? {} : { onlyPublished: true })} />
            {!canEdit && <div className="readonly-banner">보기 전용 — {me.user ? `${me.user.name}님은 «${({ runner: "실행자", viewer: "보는 사람" } as Record<string, string>)[me.user.role] ?? me.user.role}»입니다. ` : ""}{me.can("runner") ? "게시된 버전을 돌리고 기록을 볼 수 있습니다." : "고치거나 돌리려면 관리자에게 역할을 부탁하세요."}</div>}
            <Guide flowId={draft.id} items={guideItems(draft, problems, run.history, { version: detail.activeVersion, upToDate: !dirty && !detail.draftChanged && detail.activeVersion === (detail.versions[0]?.version ?? null) }, {
              openNode: (nid) => setDrawer({ kind: "node", id: nid }),
              openNotify: () => setDrawer({ kind: "notify" }),
              openProblems: () => setMenu("problems"),
              openPublish: () => setMenu("publish"),
            })} />
          </Canvas>
          {/* 노드 창 — n8n처럼 캔버스 위에 세 칸(입력 | 설정 | 출력) */}
          {drawer?.kind === "node" && node && (
            <NodeView key={node.id} flow={draft} node={node} run={nodeRun} sample={sample} issues={issues.get(node.id) ?? []}
              update={updateNode(node.id)} remove={() => removeNodes([node.id])} onClose={() => setDrawer(null)} onRecord={setRecording}
              findings={monitor.findingsFor(node.id)} onRepick={(actionId) => repick(node.id, actionId)}
              onRunPart={(part) => void runPart(node.id, part)} running={run.view?.status === "running"} runError={run.error} onFix={onFix}
              pinned={detail.pins?.[node.id] ?? null}
              {...(canEdit ? { onSplit: (cuts: number[] | "stages") => splitNode(node.id, cuts) } : {})}
              {...(canEdit ? { onPin: (out: Record<string, unknown> | null) => void (out ? api.setPin(id, node.id, out) : api.unpin(id, node.id)).then((r) => { setDetail({ ...detail, pins: r.pins }); say(out ? "출력을 고정했습니다 — 초안 시험에서 이 노드는 돌지 않습니다" : "고정을 풀었습니다"); }, (e: Error) => say(e.message)) } : {})} />
          )}
          {drawer && drawer.kind !== "node" && (
            <aside className="drawer">
              {drawer.kind === "picker" && (
                <NodePicker title={drawer.req.kind === "after" ? "다음 단계" : drawer.req.kind === "between" ? "사이에 끼울 단계" : "단계 더하기"} onPick={pick} onClose={() => setDrawer(null)} />
              )}
              {drawer.kind === "triggers" && (
                <TriggersPanel flow={draft} activeVersion={detail.activeVersion} update={update} onClose={() => setDrawer(null)} onToast={say} />
              )}
              {drawer.kind === "notify" && (
                <NotifyPanel flow={draft} activeVersion={detail.activeVersion} dirty={dirty} update={update} onClose={() => setDrawer(null)} onToast={say} />
              )}
              {drawer.kind === "monitor" && (
                <MonitorPanel flow={draft} activeVersion={detail.activeVersion} monitor={monitor} onClose={() => setDrawer(null)}
                  onOpenNode={(nid) => setDrawer({ kind: "node", id: nid })} onRepick={repick} />
              )}
              {drawer.kind === "settings" && (
                <div className="drawer-inner">
                  <div className="drawer-head"><IconGear /><h2 className="grow">워크플로우 설정</h2><button className="icon-btn" onClick={() => setDrawer(null)}><IconX /></button></div>
                  <div className="drawer-body"><SettingsPanel flow={draft} update={update} dirty={dirty} onToast={say} team={detail.team ?? null}
                    runOn={detail.runOn ?? null} onRunOn={(on) => void api.setRunOn(id, on).then((r) => { setDetail({ ...detail, runOn: r.runOn }); say(r.runOn ? "어디서 돌릴지 바꿨습니다 — 일정 · 웹훅 · 점검도 그곳에서 돕니다" : "서버에서 돌립니다"); }, (e: Error) => say(e.message))}
                    onMoveTeam={(t) => void api.setFlowTeam(id, t).then((d) => { setDetail(d); say(t ? `«${d.team?.name}» 팀으로 옮겼습니다` : "공용으로 옮겼습니다 — 모두가 봅니다"); }, (e: Error) => say(e.message))} /></div>
                </div>
              )}
            </aside>
          )}
        </main>
      )}

      {view === "editor" && !recording && run.view && (
        <section className="logpanel">
          <div className="logpanel-headrow">
            <button className="logpanel-head" onClick={() => setLogOpen(!logOpen)}>
              <StatusDot status={run.view.status} />
              <strong>실행 로그</strong>
              <span className="muted small">{run.view.label} · {run.view.status === "running" && run.view.human ? "사람을 기다리는 중" : runStatusText(run.view.status)}{run.view.message ? ` — ${run.view.message}` : ""}</span>
              <span className="grow" />
              {logOpen ? <IconChevronDown /> : <IconChevronUp />}
            </button>
            {run.view.status === "running" && (
              <>
                <button className={`small${run.view.human ? " primary" : ""}`} title="실제 브라우저 화면을 봅니다(사람을 기다리는 동안은 직접 누를 수 있습니다) — 닫으면 화면 보내기를 멈춥니다" onClick={() => setWatching(run.view!.runId)}>{run.view.human ? "실제 화면에서 하기" : "실제 화면 보기"}</button>
                <button className="small danger" title="이 실행을 멈춥니다 — 이 실행이 부른 다른 워크플로우 실행도 함께 멈춥니다"
                  onClick={() => void api.cancelRun(run.view!.runId).then(() => say("멈추는 중입니다 — 하던 동작이 끝나면 멈춥니다"), (e) => say(e instanceof ApiError ? e.message : String(e)))}>멈추기</button>
              </>
            )}
          </div>
          {watching && watching === run.view.runId && (
            <RunScreen runId={watching} title={draft.name || draft.id} onClose={() => setWatching(null)}
              {...(() => { const n = run.view!.nodes.find((x) => x.status === "running"); const st = n?.steps.at(-1); return n ? { step: `${n.name}${st ? ` — ${st.note}` : ""}` } : {}; })()} />
          )}
          {logOpen && <div className="logpanel-body"><RunLog view={run.view} watchable={false} focus={selected} onFocusNode={(nid) => setDrawer({ kind: "node", id: nid })} onFix={onFix} /></div>}
        </section>
      )}
      <Toast text={toast?.text ?? null} action={toast?.action ?? null} />
    </div>
  );
}
