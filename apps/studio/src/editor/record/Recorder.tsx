/**
 * **녹화** — 왼쪽은 녹화된 동작, 오른쪽은 라이브 페이지 (PLAN §5).
 *
 * 녹화된 동작은 바로 노드에 넣지 않는다. 사람이 다듬고(이름 · 시크릿 · 되돌릴 수 없음) 「녹화 끝」을 눌러야 들어간다.
 * ★비밀번호 칸은 값이 오지 않는다 — 어느 시크릿을 넣을지 고르기 전에는 끝낼 수 없다.
 *
 * **앞 단계에서 읽은 값**(2026-10-18, upstream.ts): 앞 단계를 재생했으면 그 값들을 위에 보인다 — 페이지의 칸을 누르고 [넣기].
 *  녹화한 입력 · 고르기의 글자가 그 값 하나와 같으면 `{{ $input.이름 }}`으로 **저절로 잇는다**(«글자 그대로»로 되돌린다).
 *
 * **사람 기다리기**(로그인 · 인증): ① 로그인 화면의 표시를 고른다(읽기 모드 — 누른 것은 페이지에 가지 않는다) →
 *  ② 사람이 직접 로그인한다(둘러보기 모드 — **넣은 것은 녹화하지 않는다**) → ③ 끝났다는 표시를 고른다(화면이 사라지면 · 지금 주소 · 이 요소).
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { HUMAN_TIMEOUT, NAME_RE, type Flow, type HumanDone, type Target, type WebAction, type WebNode } from "@flowsmith/core";
import type { Phase, Recorded, RecordMode } from "@flowsmith/recorder/protocol";
import { describeAction, josa, suggestionsFor, urlDone } from "../../model/index.ts";
import { IconX } from "../../icons.tsx";
import { LiveView } from "../../live/LiveView.tsx";
import { WsTransport, type LiveTransport } from "../../live/transport.ts";
import { TemplateInput } from "../widgets.tsx";
import { rememberedRecordOn, rememberRecordOn, useWorkers } from "../../shell/workers.ts";
import { linkOf, rowsOf, type UpstreamRow } from "./upstream.ts";
import { recallParams } from "../../shell/remember.ts";

export interface RecordStart {
  nodeId: string;
  params: Record<string, string>;
  replay: boolean;
  replayExisting: boolean;
  /** 다시 지정 — 이 동작의 요소만 다시 고른다(그 동작 앞까지 재생한다) */
  repick?: { actionId: string; kind: WebAction["kind"]; label: string };
  /** 어디서 녹화하나 — 「worker:<id>」 그 PC의 크롬(워커 프로그램) · 없으면 서버. 없으면 이 브라우저가 기억한 PC(attach만) */
  on?: string;
}

interface Item extends Recorded {
  useTable: boolean;
  /** 표의 행 누르기를 «행 고르기»로 */
  useRow: boolean;
  /** 읽기를 «확인»으로 — 화면 값이 기대값과 다르면 멈춘다 */
  useAssert: boolean;
  equals: string;
  /** 앞 단계 값에 저절로 이었다 — 그 줄의 이름 · 녹화 때 넣은 글자(되돌리기) */
  linked?: { label: string; literal: string } | null;
  /** 같은 글자가 앞 단계 값 여럿에 있어 잇지 않았다 — 그 이름들 */
  linkMany?: string[];
  /** 이 동작부터 새 노드(«여기서 새 노드») — 녹화를 넣을 때 웹페이지 노드를 나눈다(model/split.ts) */
  cut?: boolean;
}

/** 사람 기다리기를 녹화하는 단계 — appears: 로그인 화면의 표시 고르기 · login: 사람이 로그인 · done: 끝 표시 고르기 */
type HumanStep = { step: "appears" | "login" | "done"; appears: Target | null };

const MODE_HINT: Record<RecordMode, string> = {
  record: "페이지에서 누르고 넣으면 동작으로 남습니다. 누르기는 Flowsmith가 같은 위치로 대신 눌러 확인합니다",
  read: "읽을 값을 누르세요 — 페이지에는 전달되지 않습니다. 표의 칸을 누르면 표 전체로도 읽을 수 있습니다",
  browse: "기록하지 않고 페이지만 움직입니다. ★실행할 때는 이 이동이 없으니, 꼭 필요한 이동은 녹화로 하세요",
};

function finalAction(it: Item): WebAction {
  const { id, risk, timeoutMs, optional } = it.action;
  if (it.useRow && it.row) return { id, risk, timeoutMs, optional: false, kind: "pickRow", pick: it.row.pick };
  if (it.useAssert && it.action.kind === "read") return { id, risk, timeoutMs, optional, kind: "assert", target: it.action.target, strategy: it.action.strategy, equals: it.equals };
  return it.useTable && it.table ? { ...it.table.action, output: it.action.kind === "read" ? it.action.output : it.table.action.output } : it.action;
}

export function Recorder({ flow, start, onCommit, onRepick, onCancel }: {
  flow: Flow; start: RecordStart;
  /** cuts — 녹화한 동작 번호(그 동작부터 새 노드) · 비면 한 노드에 */
  onCommit: (actions: WebAction[], cuts: number[]) => void; onRepick?: (target: Target) => void; onCancel: () => void;
}) {
  const node = flow.nodes.find((n) => n.id === start.nodeId) as WebNode;
  /** 사람 기다리기는 따로 노드로(앞뒤를 자른다) — 사용자 요청 2026-10-22 «페이지 접속 → 로그인(사람 대기) → 주문 읽기» */
  const [splitHumans, setSplitHumans] = useState(true);
  // ★연결은 effect 안에서 만든다 — StrictMode(개발 모드)는 effect를 «실행 → 정리 → 다시 실행»한다.
  //  밖에서 한 번 만들고 정리에서 닫으면, 다시 실행될 때 닫힌 연결을 쓴다(실제로 걸렸다)
  const [transport, setTransport] = useState<LiveTransport | null>(null);
  const openRef = useRef<((viewport: { width: number; height: number }) => void) | null>(null);
  const opened = useRef(false);
  const [phase, setPhase] = useState<Phase>("starting");
  const [progress, setProgress] = useState<string[]>([]);
  const [mode, setMode] = useState<RecordMode>("browse");
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<{ level: string; text: string }[]>([]);
  /** 사람 기다리기를 녹화하는 중 */
  const [human, setHuman] = useState<HumanStep | null>(null);
  const humanRef = useRef<HumanStep | null>(null);
  humanRef.current = human;
  /** MetaMask 승인을 넣는 중 — choose: 끝 표시를 고르는 중 · pick: 페이지에서 요소를 고르는 중(지갑 브라우저만) */
  const [walletStep, setWalletStep] = useState<"choose" | "pick" | null>(null);
  const walletRef = useRef<"choose" | "pick" | null>(null);
  walletRef.current = walletStep;
  /** 재생이 사람을 기다린다(앞 노드 · 이 노드의 사람 기다리기) */
  const [replayHuman, setReplayHuman] = useState<{ prompt: string } | null>(null);
  const pageUrl = useRef("");
  /** 연결 — 한 번 만든 메시지 처리기(effect)에서도 지금 연결을 쓰게 */
  const tRef = useRef<LiveTransport | null>(null);
  /** 앞 단계에서 읽은 값 — 재생하지 않았으면 null */
  const [upstream, setUpstream] = useState<UpstreamRow[] | null>(null);
  const upRef = useRef<UpstreamRow[] | null>(null);
  upRef.current = upstream;
  const [showUp, setShowUp] = useState(true);

  /** 녹화한 입력 · 고르기를 앞 단계 값에 잇는다 — 하나와만 같을 때 */
  const linked = (it: Item): Item => {
    const a = it.action;
    if ((a.kind !== "fill" && a.kind !== "select") || it.needs === "secret" || !upRef.current) return it;
    const l = linkOf(upRef.current, a.value);
    if (l?.kind === "one") return { ...it, action: { ...a, value: l.row.insert }, linked: { label: l.row.label, literal: a.value } };
    if (l?.kind === "many") return { ...it, linkMany: l.rows.map((r) => r.label) };
    return it;
  };

  /** 다시 지정 — 처음 고른 요소의 위치를 돌려준다. 읽기가 아닌 동작은 그 요소를 사람이 부르는 이름으로 */
  const pickedOnce = (it: Recorded) => {
    const rp = start.repick!;
    const picked = it.action.kind === "read" ? it.action.target : null;
    if (!picked) return;
    const target = (rp.kind === "readTable" || rp.kind === "pickRow") && it.table ? it.table.action.table.rows
      : rp.kind === "read" ? picked
      : { ...picked, label: it.humanLabel ?? picked.label };
    onRepick!(target);
  };

  useEffect(() => {
    const transport = new WsTransport();
    tRef.current = transport;
    setTransport(transport);
    const offs = [
      transport.onMessage((m) => {
        if (m.t === "phase") {
          setPhase(m.phase);
        }
        if (m.t === "progress") setProgress((p) => [...p, m.text]);
        if (m.t === "mode") setMode(m.mode);
        if (m.t === "page") pageUrl.current = m.url;
        if (m.t === "human") setReplayHuman(m.prompt ? { prompt: m.prompt } : null);
        if (m.t === "inputs") setUpstream(rowsOf(flow, start.nodeId, m.input, start.params));
        if (m.t === "recorded") {
          if (start.repick && onRepick) { pickedOnce(m.item); return; }
          // MetaMask 승인 — 고른 요소는 끝났다는 표시다
          if (walletRef.current === "pick" && m.item.action.kind === "read") {
            finishWallet({ kind: "visible", target: { ...m.item.action.target, label: m.item.humanLabel ?? m.item.action.target.label } });
            return;
          }
          // 사람 기다리기 — 고른 요소는 동작이 아니라 그 동작의 표시다
          const h = humanRef.current;
          if (h && (h.step === "appears" || h.step === "done") && m.item.action.kind === "read") {
            const picked = { ...m.item.action.target, label: m.item.humanLabel ?? m.item.action.target.label };
            if (h.step === "appears") { setHuman({ step: "login", appears: picked }); transport.send({ t: "mode", mode: "browse" }); }
            else finishHuman(h.appears, { kind: "visible", target: picked });
            return;
          }
          setItems((xs) => [...xs, linked({ ...m.item, useTable: false, useRow: false, useAssert: false, equals: m.item.current ?? "" })]);
        }
        if (m.t === "notice") setNotices((ns) => [...ns.slice(-4), { level: m.level, text: m.text }]);
      }),
      transport.onClose((r) => { setPhase("closed"); setNotices((ns) => [...ns, { level: "error", text: r }]); }),
    ];
    // 세션은 라이브 패널이 제 크기를 잰 뒤에 연다(onMeasure)
    openRef.current = (viewport: { width: number; height: number }) => transport.open({
      t: "open", flowId: flow.id, nodeId: start.nodeId, draft: flow, params: start.params,
      replay: start.replay, replayExisting: start.replayExisting,
      // 다시 지정은 «읽기»로 연다 — 누른 것이 페이지에 가지 않는다(녹화 모드인 틈이 없다)
      ...(start.repick ? { stopBeforeAction: start.repick.actionId, startMode: "read" as const } : {}),
      viewport,
      // 사람의 크롬에 붙는 플로우 — 그 크롬이 있는 PC(워커 프로그램)에서. 다시 지정처럼 폼을 거치지 않으면 이 브라우저가 기억한 PC
      ...(flow.settings.browser === "attach" && (start.on ?? rememberedRecordOn()) ? { on: (start.on ?? rememberedRecordOn())! } : {}),
    });
    return () => { offs.forEach((f) => f()); transport.close(); };
    // 세션은 한 번만 연다 — 초안이 바뀌어도 다시 열지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 사람 기다리기 — 시작 · 끝(동작을 하나 넣고 녹화로 돌아간다) · 그만두기 */
  const beginHuman = () => { setHuman({ step: "appears", appears: null }); tRef.current?.send({ t: "mode", mode: "read" }); };
  const skipAppears = () => { setHuman({ step: "login", appears: null }); tRef.current?.send({ t: "mode", mode: "browse" }); };
  function finishHuman(appears: Target | null, done: HumanDone) {
    const action: WebAction = { id: `h${Date.now()}`, kind: "human", risk: "safe", timeoutMs: null, optional: false, prompt: "로그인해 주세요", appears, done };
    setItems((xs) => [...xs, { id: action.id, action, needs: null, table: null, warnings: [], useTable: false, useRow: false, useAssert: false, equals: "" }]);
    setHuman(null);
    tRef.current?.send({ t: "mode", mode: "record" });
  }
  const cancelHuman = () => { setHuman(null); tRef.current?.send({ t: "mode", mode: "record" }); };

  /** MetaMask 승인 — 사이트의 «지갑 연결»을 누른 뒤 넣는다. 녹화 중에는 사람이 MetaMask 창에서 직접 승인한다 */
  function finishWallet(done: HumanDone) {
    const action: WebAction = { id: `m${Date.now()}`, kind: "walletApprove", risk: "safe", timeoutMs: null, optional: false, done };
    setItems((xs) => [...xs, { id: action.id, action, needs: null, table: null, warnings: [], useTable: false, useRow: false, useAssert: false, equals: "" }]);
    setWalletStep(null);
    tRef.current?.send({ t: "mode", mode: "record" });
  }
  const cancelWallet = () => { setWalletStep(null); tRef.current?.send({ t: "mode", mode: "record" }); };

  const update = (id: string, fn: (it: Item) => Item) => setItems((xs) => xs.map((x) => (x.id === id ? fn(x) : x)));
  const taken = new Set(node.config.actions.flatMap((a) => (a.kind === "read" || a.kind === "readTable" ? [a.output] : [])));
  const finals = items.map(finalAction);
  const outs = finals.map((a) => (a.kind === "read" || a.kind === "readTable" ? a.output : null));
  const setRow = (id: string, patch: Partial<NonNullable<Item["row"]>["pick"]>) => update(id, (x) => (x.row ? { ...x, row: { ...x.row, pick: { ...x.row.pick, ...patch } } } : x));
  const problems = finals.flatMap((a, i) => {
    const n = `${i + 1}번`;
    const o = outs[i];
    if (o != null && !NAME_RE.test(o)) return [`${n}: 내보낼 이름을 글자 · 숫자 · _ 로 정하세요`];
    if (o != null && (taken.has(o) || outs.indexOf(o) !== i)) return [`${n}: 내보낼 이름 「${o}」가 겹칩니다`];
    if (items[i]!.needs === "secret" && a.kind === "fill" && a.value.trim() === "") return [`${n}: 비밀번호 칸에 넣을 시크릿을 고르세요`];
    if (a.kind === "readTable") {
      const names = a.table.columns.map((c) => c.name);
      if (names.some((x) => !NAME_RE.test(x))) return [`${n}: 칸 이름을 글자 · 숫자 · _ 로 정하세요`];
      if (new Set(names).size !== names.length) return [`${n}: 칸 이름이 겹칩니다`];
    }
    if (a.kind === "pickRow" && a.pick.refuse && a.pick.refuse.values.length === 0) return [`${n}: 멈출 글자를 적거나 «막을 행 없음»으로 두세요`];
    if (a.kind === "pickRow" && a.pick.value.trim() === "") return [`${n}: 행을 고를 값을 정하세요`];
    if (a.kind === "assert" && a.equals.trim() === "") return [`${n}: 확인할 기대값을 정하세요`];
    if (a.kind === "human" && a.prompt.trim() === "") return [`${n}: 사람에게 보일 안내 문구를 적으세요`];
    return [];
  });
  const secretChips = suggestionsFor(flow, start.nodeId, true).filter((s) => s.secret);
  // 노드를 나눌 곳 — 맨 앞은 이 노드에 이미 동작이 있거나 주소로 시작할 때만(앞이 «페이지 접속»으로 남는다)
  const canCutAt = (i: number) => i > 0 || node.config.actions.length > 0 || node.config.start.kind !== "continue";
  const cutSet = new Set<number>();
  items.forEach((it, i) => {
    if (it.cut && canCutAt(i)) cutSet.add(i);
    if (splitHumans && it.action.kind === "human") { if (canCutAt(i)) cutSet.add(i); if (i + 1 < items.length) cutSet.add(i + 1); }
  });
  const cuts = [...cutSet].sort((a, b) => a - b);

  return (
    <div className="recorder">
      <section className="rec-panel">
        <div className="drawer-head">
          <span className="rec-dot" />
          <h2 className="grow">{start.repick ? `다시 지정 · ${start.repick.label || node.name}` : `녹화 · ${node.name}`}</h2>
          <button className="icon-btn" title="그만두기" onClick={() => { if (items.length === 0 || confirm("녹화한 동작을 버리고 그만둘까요?")) onCancel(); }}><IconX /></button>
        </div>
        <div className="rec-modes">
          <div className="seg-tabs">
            {(["record", "read", "browse"] as const).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} disabled={phase !== "ready" || human !== null} onClick={() => transport?.send({ t: "mode", mode: m })}>
                {m === "record" ? "● 녹화" : m === "read" ? "읽기" : "둘러보기"}
              </button>
            ))}
          </div>
          <div className="small muted">{start.repick ? `«${start.repick.label}»에 해당하는 요소를 오른쪽 페이지에서 누르세요 — 그 동작 바로 앞까지 재생해 두었습니다. 누른 것은 페이지에 전달되지 않습니다` : MODE_HINT[mode]}</div>
          {!start.repick && human === null && walletStep === null && (
            <div className="row wrap">
              <button className="small" disabled={phase !== "ready"} title="로그인 · 본인 인증처럼 사람이 직접 해야 하는 곳 — 실행이 여기서 멈춰 사람을 기다립니다"
                onClick={beginHuman}>🙋 사람 기다리기(로그인)</button>
              {flow.settings.browser === "wallet" && (
                <button className="small" disabled={phase !== "ready"} title="사이트의 «지갑 연결»을 누른 뒤에 — 실행할 때 MetaMask의 연결 · 서명 화면을 이 동작이 승인합니다"
                  onClick={() => { setWalletStep("choose"); transport?.send({ t: "mode", mode: "browse" }); }}>🦊 MetaMask 승인 넣기</button>
              )}
            </div>
          )}
          {walletStep && (
            <div className="rec-human">
              {walletStep === "choose" && (
                <>
                  <b>MetaMask 승인 — 끝났다는 표시를 고르세요</b>
                  <span className="small">
                    지금 MetaMask 창이 떠 있으면 그 창에서 직접 승인하세요(녹화 중에는 사람이 누릅니다 · MetaMask 창에서 누른 것은 녹화하지 않습니다).
                    실행할 때는 이 동작이 연결 · 서명을 승인하고, 아래 표시가 오면 다음으로 넘어갑니다.
                  </span>
                  <div className="row wrap">
                    <button className="small" title={pageUrl.current} onClick={() => finishWallet(urlDone(pageUrl.current))}>지금 주소가 되면</button>
                    <button className="small primary" onClick={() => { setWalletStep("pick"); transport?.send({ t: "mode", mode: "read" }); }}>이 요소가 보이면(고르기) — 지갑 주소 · 내 정보</button>
                    <span className="grow" /><button className="small ghost" onClick={cancelWallet}>그만두기</button>
                  </div>
                </>
              )}
              {walletStep === "pick" && (
                <>
                  <b>로그인 뒤에만 보이는 것을 고르세요</b>
                  <span className="small">예: 지갑 주소 · 프로필 · «Inventory». 누른 것은 페이지에 가지 않습니다.</span>
                  <div className="row"><span className="grow" /><button className="small ghost" onClick={() => { setWalletStep("choose"); transport?.send({ t: "mode", mode: "browse" }); }}>뒤로</button></div>
                </>
              )}
            </div>
          )}
          {human && (
            <div className="rec-human">
              {human.step === "appears" && (
                <>
                  <b>1. 로그인 화면의 표시를 고르세요</b>
                  <span className="small">오른쪽 페이지에서 로그인 화면에만 있는 것(예: 「로그인」 단추)을 누르세요. 실행할 때 이것이 보일 때만 기다립니다. 누른 것은 페이지에 가지 않습니다.</span>
                  <div className="row"><button className="small" onClick={skipAppears}>건너뛰기 — 늘 기다림</button><span className="grow" /><button className="small ghost" onClick={cancelHuman}>그만두기</button></div>
                </>
              )}
              {human.step === "login" && (
                <>
                  <b>2. 이제 직접 로그인하세요</b>
                  <span className="small">오른쪽 화면{flow.settings.browser === "attach" ? "이나 크롬 창" : ""}에서 로그인하세요. ★이 사이에 넣은 것(아이디 · 비밀번호)은 녹화하지 않습니다. 다 했으면 끝났다는 표시를 고르세요.</span>
                  <div className="row">
                    {human.appears && <button className="small primary" onClick={() => finishHuman(human.appears, { kind: "hidden", target: human.appears! })}>로그인 끝 — {josa(human.appears.label, "이가")} 사라지면</button>}
                    <button className="small" title={pageUrl.current} onClick={() => finishHuman(human.appears, urlDone(pageUrl.current))}>로그인 끝 — 지금 주소가 되면</button>
                    <button className="small" onClick={() => { setHuman({ ...human, step: "done" }); transport?.send({ t: "mode", mode: "read" }); }}>로그인 끝 — 이 요소가 보이면(고르기)</button>
                    <span className="grow" /><button className="small ghost" onClick={cancelHuman}>그만두기</button>
                  </div>
                </>
              )}
              {human.step === "done" && (
                <>
                  <b>3. 로그인 뒤에만 보이는 것을 고르세요</b>
                  <span className="small">예: 「로그아웃」 단추 · 이름 · 메뉴. 실행할 때 이것이 보이면 다음 동작으로 넘어갑니다.</span>
                  <div className="row"><span className="grow" /><button className="small ghost" onClick={() => { setHuman({ ...human, step: "login" }); transport?.send({ t: "mode", mode: "browse" }); }}>뒤로</button></div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="drawer-body stack" style={{ gap: 8 }}>
          {upstream && upstream.length > 0 && !start.repick && (
            <div className="rec-upstream">
              <button className="rec-upstream-head" onClick={() => setShowUp((x) => !x)} aria-expanded={showUp}>
                <b className="grow">앞 단계에서 읽은 값 {upstream.length}개</b><span className="small muted">{showUp ? "접기" : "펴기"}</span>
              </button>
              {showUp && (
                <>
                  <span className="small muted">페이지의 칸을 누른 뒤 [넣기] — 넣은 값은 실행할 때마다 앞 단계 값으로 바뀌도록 저절로 이어집니다. 직접 쳐도 같은 글자면 이어집니다.</span>
                  {upstream.map((r) => (
                    <div key={r.insert} className="rec-upstream-row">
                      <span className="rec-upstream-label" title={r.insert}>{r.label}</span>
                      <span className="rec-upstream-value mono" title={r.shown}>{r.shown}</span>
                      {r.text !== null && r.text !== "" && (
                        <button className="small" disabled={phase !== "ready" || mode !== "record"} title={mode === "record" ? "누른 칸에 이 값을 넣습니다" : "● 녹화 모드에서 넣을 수 있습니다"}
                          onClick={() => transport?.send({ t: "text", text: r.text! })}>넣기</button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {node.config.actions.length > 0 && <div className="small muted">이 노드에 이미 동작 {node.config.actions.length}개가 있습니다 — 녹화한 것은 그 뒤에 붙습니다</div>}
          {items.length === 0 && <div className="empty small">아직 녹화한 동작이 없습니다</div>}
          {items.map((it, i) => {
            const a = finalAction(it);
            return (
              <Fragment key={it.id}>
              {cutSet.has(i) && <div className="rec-cut" role="separator">✂ 여기서 새 노드{a.kind === "human" ? " — 🙋 사람 기다리기" : ""}</div>}
              <div className={`rec-item${it.warnings.length ? " warn" : ""}`}>
                <div className="row">
                  <span className="step-n">{i + 1}</span>
                  <span className="grow">{describeAction(a, { flow, nodeId: start.nodeId })}</span>
                  {!start.repick && canCutAt(i) && !(splitHumans && (a.kind === "human" || items[i - 1]?.action.kind === "human")) && (
                    <button className={`icon-btn rec-cut-btn${it.cut ? " on" : ""}`} aria-pressed={!!it.cut} title={it.cut ? "나누지 않기" : "이 동작부터 새 노드(앞 페이지에서 이어서)"}
                      onClick={() => update(it.id, (x) => ({ ...x, cut: !x.cut }))}>✂</button>
                  )}
                  <button className="icon-btn" title="이 동작 빼기" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}><IconX size={14} /></button>
                </div>
                {it.warnings.map((w, j) => <div key={j} className="small" style={{ color: "var(--bad)" }}>⚠ {w}</div>)}
                {it.hints?.map((h, j) => <div key={j} className="small muted">ⓘ {h}</div>)}

                {it.action.kind === "read" && (
                  <label className="check small" title="상세 화면의 주문번호가 찾던 번호인지처럼 — 엉뚱한 건을 고쳐 쓰지 않게">
                    <input type="checkbox" checked={it.useAssert} onChange={(e) => update(it.id, (x) => ({ ...x, useAssert: e.target.checked, useTable: false }))} />
                    읽지 말고 확인만 — 화면 값이 기대값과 다르면 멈춤
                  </label>
                )}
                {it.useAssert && (
                  <TemplateInput flow={flow} nodeId={start.nodeId} value={it.equals} placeholder="{{ $params.orderNo }}"
                    onChange={(v) => update(it.id, (x) => ({ ...x, equals: v }))} />
                )}

                {it.action.kind === "read" && !it.useAssert && (
                  <div className="row">
                    <input className="grow" placeholder="내보낼 이름" value={it.action.output}
                      onChange={(e) => update(it.id, (x) => ({ ...x, action: { ...x.action, output: e.target.value } as WebAction }))} />
                    {it.table && (
                      <label className="check small" title={`${it.table.rows}${it.table.list ? "개" : "행"} · 칸 ${it.table.action.table.columns.map((c) => c.name).join(", ")}`}>
                        <input type="checkbox" checked={it.useTable} onChange={(e) => {
                          const on = e.target.checked;
                          // 하나 읽기의 이름(「값」)은 목록의 이름으로 맞지 않는다 — 목록 이름으로 바꿔 둔다
                          update(it.id, (x) => ({ ...x, useTable: on, action: on && x.action.kind === "read" && x.action.output === "값" ? { ...x.action, output: x.table!.action.output } : x.action }));
                        }} />
                        {it.table.list ? `되풀이되는 목록 전체로(${it.table.rows}개)` : `표 전체로(${it.table.rows}행)`}
                      </label>
                    )}
                  </div>
                )}
                {it.useTable && it.table && (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="small muted">{it.table.list ? "항목마다 읽을 칸 — 이름을 정하세요" : "열 이름"}</span>
                    {it.table.action.table.columns.map((c, ci) => (
                      <div key={ci} className="row">
                        <input className="grow" value={c.name} onChange={(e) => update(it.id, (x) => ({ ...x, table: { ...x.table!, action: { ...x.table!.action, table: { ...x.table!.action.table, columns: x.table!.action.table.columns.map((y, j) => (j === ci ? { ...y, name: e.target.value } : y)) } } } }))} />
                        <span className="small muted">{c.strategy === "link" ? "링크 주소" : "글자"}</span>
                        {it.table!.action.table.columns.length > 1 && (
                          <button className="icon-btn" title="이 칸 빼기" onClick={() => update(it.id, (x) => ({ ...x, table: { ...x.table!, action: { ...x.table!.action, table: { ...x.table!.action.table, columns: x.table!.action.table.columns.filter((_, j) => j !== ci) } } } }))}><IconX size={12} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {it.linked && (
                  <div className="rec-linked small">
                    <span className="grow">🔗 앞 단계 값에 이었습니다 — <b>{it.linked.label}</b> · 녹화 때 넣은 «{it.linked.literal}» 대신 실행마다 그 값을 넣습니다</span>
                    <button className="small ghost" title="녹화 때 넣은 글자를 그대로 넣습니다"
                      onClick={() => update(it.id, (x) => ({ ...x, linked: null, action: { ...x.action, value: x.linked!.literal } as WebAction }))}>글자 그대로</button>
                  </div>
                )}
                {it.linkMany && it.linkMany.length > 0 && !it.linked && (
                  <div className="small muted">ⓘ 같은 값이 여러 곳에 있어 잇지 않았습니다({it.linkMany.join(" · ")}) — 아래 값 칸의 ＋에서 고르세요</div>
                )}
                {it.action.kind === "select" && (
                  <TemplateInput flow={flow} nodeId={start.nodeId} value={it.action.value}
                    onChange={(v) => update(it.id, (x) => ({ ...x, linked: null, action: { ...x.action, value: v } as WebAction }))} />
                )}
                {it.action.kind === "fill" && (
                  <>
                    {it.needs === "secret" && (
                      <div className="chips">
                        <span className="small muted">비밀번호 칸 — 넣을 시크릿:</span>
                        {secretChips.length === 0 && <span className="small" style={{ color: "var(--warn)" }}>워크플로우 설정에서 로그인 시크릿을 먼저 정의하세요</span>}
                        {secretChips.map((s) => (
                          <button key={s.insert} className={`secret${it.action.kind === "fill" && it.action.value === s.insert ? " on" : ""}`}
                            onClick={() => update(it.id, (x) => ({ ...x, action: { ...x.action, value: s.insert } as WebAction }))}>{s.label}</button>
                        ))}
                      </div>
                    )}
                    {it.needs !== "secret" && (
                      <TemplateInput flow={flow} nodeId={start.nodeId} secrets value={it.action.value}
                        onChange={(v) => update(it.id, (x) => ({ ...x, linked: null, action: { ...x.action, value: v } as WebAction }))} />
                    )}
                  </>
                )}

                {it.action.kind === "human" && (() => {
                  const h = it.action;
                  const minutes = Math.round((h.timeoutMs ?? HUMAN_TIMEOUT.defaultMs) / 6_000) / 10;
                  return (
                    <div className="row">
                      <input className="grow" placeholder="사람에게 보일 안내 — 포털에 로그인해 주세요" value={h.prompt}
                        onChange={(e) => update(it.id, (x) => ({ ...x, action: { ...h, prompt: e.target.value } }))} />
                      <label className="small muted">기다림(분) <input type="number" min={0.5} max={30} step={0.5} style={{ width: 64 }} value={minutes}
                        onChange={(e) => { const m = Number(e.target.value); update(it.id, (x) => ({ ...x, action: { ...h, timeoutMs: Number.isFinite(m) && m > 0 ? Math.round(Math.min(HUMAN_TIMEOUT.maxMs, Math.max(HUMAN_TIMEOUT.minMs, m * 60_000))) : null } })); }} /></label>
                    </div>
                  );
                })()}
                {it.action.kind === "click" && it.row && (
                  <label className="check small" title="키 칸의 글자로 · 또는 몇 번째로 고릅니다">
                    <input type="checkbox" checked={it.useRow} onChange={(e) => update(it.id, (x) => ({ ...x, useRow: e.target.checked }))} />
                    표의 행 — 「행 고르기」로 남기기({it.row.rows}행)
                  </label>
                )}
                {it.useRow && it.row && (() => {
                  const r = it.row;
                  const p = r.pick;
                  const keys = r.columns.filter((c) => c.text !== "");
                  const byIndex = p.by === "index";
                  return (
                    <div className="stack" style={{ gap: 4 }}>
                      <div className="row wrap">
                        <span className="small muted">찾는 법</span>
                        <label className="check small"><input type="radio" checked={!byIndex} disabled={keys.length === 0}
                          onChange={() => { const c = keys[0]!; setRow(it.id, { by: "key", keyColumn: c.selector, keyLabel: c.name, value: c.text }); }} />값으로(순서가 바뀌어도 같은 건)</label>
                        <label className="check small"><input type="radio" checked={byIndex}
                          onChange={() => setRow(it.id, { by: "index", value: String(r.nth) })} />몇 번째로(목록의 n번째)</label>
                      </div>
                      {!byIndex && (
                        <div className="row">
                          <span className="small muted">키 칸</span>
                          <select className="grow" value={p.keyColumn} onChange={(e) => {
                            const c = r.columns.find((x) => x.selector === e.target.value)!;
                            setRow(it.id, { keyColumn: c.selector, keyLabel: c.name, value: c.text });
                          }}>
                            {keys.map((c) => <option key={c.selector} value={c.selector}>{c.name} — 「{c.text}」</option>)}
                          </select>
                        </div>
                      )}
                      <TemplateInput flow={flow} nodeId={start.nodeId} value={p.value} placeholder={byIndex ? "3 · -1(마지막) · {{ $params.n }}" : "{{ $params.orderNo }}"} onChange={(v) => setRow(it.id, { value: v })} />
                      {byIndex && <span className="small muted">1부터 셉니다 · 음수는 끝에서(-1은 마지막) · 실행 입력으로 받으려면 ＋에서 고르세요. 그 자리에 행이 없으면 멈춥니다</span>}
                      <div className="row">
                        <span className="small muted">이 칸이</span>
                        <select value={p.refuse?.column ?? ""} onChange={(e) => setRow(it.id, { refuse: e.target.value ? { column: e.target.value, values: p.refuse?.values ?? [], reason: p.refuse?.reason ?? "고르면 안 되는 행입니다" } : null })}>
                          <option value="">(막을 행 없음)</option>
                          {r.columns.map((c) => <option key={c.selector} value={c.selector}>{c.name}</option>)}
                        </select>
                        {p.refuse && (
                          <input className="grow" placeholder="이 글자면 멈춤(쉼표로) — 배송완료" value={p.refuse.values.join(", ")}
                            onChange={(e) => setRow(it.id, { refuse: { ...p.refuse!, values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} />
                        )}
                      </div>
                    </div>
                  );
                })()}
                {it.action.kind === "click" && !it.useRow && (
                  <label className="check small">
                    <input type="checkbox" checked={it.action.risk === "unsafe"} onChange={(e) => update(it.id, (x) => ({ ...x, action: { ...x.action, risk: e.target.checked ? "unsafe" : "safe" } }))} />
                    되돌릴 수 없는 동작 — 점검 실행이 누르지 않습니다
                  </label>
                )}
              </div>
              </Fragment>
            );
          })}
        </div>
        <div className="rec-foot stack" style={{ gap: 8 }}>
          {!start.repick && (
            <label className="check small" title="로그인 · 인증처럼 사람이 하는 단계를 캔버스에서 따로 보이게 — 같은 페이지에서 이어 돌고, 읽은 값도 이어집니다">
              <input type="checkbox" checked={splitHumans} onChange={(e) => setSplitHumans(e.target.checked)} />
              🙋 사람 기다리기는 따로 노드로 나누기
            </label>
          )}
          {notices.slice(-3).map((n, i) => <div key={i} className={`banner small ${n.level === "error" ? "bad" : n.level === "warn" ? "warn" : "info"}`}>{n.text}</div>)}
          {problems.length > 0 && items.length > 0 && <div className="small" style={{ color: "var(--bad)" }}>{problems[0]}</div>}
          <div className="row">
            <button onClick={() => { if (items.length === 0 || confirm("녹화한 동작을 버리고 그만둘까요?")) onCancel(); }}>그만두기</button>
            <span className="grow" />
            <button className="primary" disabled={items.length === 0 || problems.length > 0} onClick={() => onCommit(items.map(finalAction), start.repick ? [] : cuts)}>
              녹화 끝 — 동작 {items.length}개 넣기{!start.repick && cuts.length > 0 ? ` · 노드 ${cuts.length + 1}개로` : ""}
            </button>
          </div>
        </div>
      </section>
      <section className="rec-live">
        {transport && <LiveView transport={transport} phase={phase} progress={progress} human={replayHuman} onMeasure={(size) => { if (!opened.current) { opened.current = true; openRef.current?.(size); } }} />}
      </section>
    </div>
  );
}

/** 녹화 시작 전 — 실행 입력과 재생 범위를 정한다 (노드 서랍 안) */
export function RecordStartForm({ flow, node, onStart, onCancel }: {
  flow: Flow; node: WebNode; onStart: (s: RecordStart) => void; onCancel: () => void;
}) {
  const remembered = recallParams(flow.id);
  const [params, setParams] = useState<Record<string, string>>({ ...flow.settings.probeParams, ...remembered });
  const hasAncestors = flow.edges.some((e) => e.to.node === node.id);
  const [replay, setReplay] = useState(hasAncestors);
  const [replayExisting, setReplayExisting] = useState(node.config.actions.length > 0);
  // 사람의 크롬에 붙는 플로우 — 어느 PC의 크롬에서. 이 브라우저가 고른 것을 기억한다(= 이 사람의 PC)
  const attach = flow.settings.browser === "attach";
  const workers = useWorkers(attach);
  const [on, setOn] = useState<string>(() => rememberedRecordOn() ?? "");
  const chosen = on ? workers?.workers.find((w) => `worker:${w.id}` === on) : undefined;
  return (
    <div className="subcard">
      <strong>녹화 준비</strong>
      {attach && workers && workers.workers.length > 0 && (
        <label className="field"><span>녹화할 PC</span>
          <select value={on} onChange={(e) => setOn(e.target.value)}>
            <option value="">서버</option>
            {workers.workers.map((w) => <option key={w.id} value={`worker:${w.id}`} disabled={!w.online}>{w.name}{w.online ? "" : " — 꺼짐"}</option>)}
          </select>
        </label>
      )}
      {attach && on && workers && !chosen && <div className="banner warn small">기억해 둔 PC가 없습니다. 다시 고르세요.</div>}
      {chosen && !chosen.online && <div className="banner warn small">«{chosen.name}»가 연결돼 있지 않습니다.</div>}
      <label className="check"><input type="checkbox" disabled={!hasAncestors} checked={replay} onChange={(e) => setReplay(e.target.checked)} />
        앞 단계를 재생해 이 노드의 시작 지점으로 가기{!hasAncestors && " (앞 노드 없음)"}</label>
      {node.config.actions.length > 0 && (
        <label className="check"><input type="checkbox" checked={replayExisting} onChange={(e) => setReplayExisting(e.target.checked)} />
          이 노드의 동작 {node.config.actions.length}개를 먼저 재생하고 이어서 녹화</label>
      )}
      {replay && flow.params.map((p) => (
        <label key={p.name} className="field"><span>{p.label || p.name} (재생에 쓸 값)</span>
          <input value={params[p.name] ?? ""} onChange={(e) => setParams((x) => ({ ...x, [p.name]: e.target.value }))} />
        </label>
      ))}
      {flow.settings.browser === "attach" && (
        <div className="banner info small">
          {chosen ? `«${chosen.name}»의 크롬` : "사람의 크롬"}에서 녹화합니다{node.config.start.kind === "tab" ? "(주소가 맞는 탭)" : ""}. 크롬 창이나 오른쪽 화면, 어디서 해도 됩니다.
        </div>
      )}
      <div className="banner warn small">녹화 중에 누르는 것은 실제 사이트에서 실제로 일어납니다. 금지 버튼은 누르지 않습니다.</div>
      <div className="row"><span className="grow" />
        <button onClick={onCancel}>닫기</button>
        <button className="primary" disabled={Boolean(chosen && !chosen.online)} onClick={() => { if (attach) rememberRecordOn(on || null); onStart({ nodeId: node.id, params, replay, replayExisting, ...(attach && on ? { on } : {}) }); }}>● 녹화 시작</button>
      </div>
    </div>
  );
}
