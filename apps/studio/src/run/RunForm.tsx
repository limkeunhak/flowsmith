/**
 * **실행 폼** — 편집 화면 없이 실행 입력만 넣고 게시된 버전을 돌린다 (`#/run/:플로우`, n8n의 Form Trigger · Jenkins «매개변수와 함께 빌드»).
 * 실행자(담당자)에게 이 페이지만 주면 된다 — 진행 · 사람 기다리기(로그인 · 인증) · 결과 · 엑셀 · 시간표까지 여기서.
 *
 * ★늘 **게시된 버전**을 돌린다(초안은 편집 화면의 일). 입력은 이 브라우저에 기억하지 않는다 — 전화번호 같은 개인정보일 수 있다.
 */
import { useEffect, useRef, useState } from "react";
import { normalize } from "../model/index.ts";
import { api, ApiError } from "../api.ts";
import { ParamInput } from "../editor/widgets.tsx";
import { applyWatch, viewOf, type RunView } from "../editor/run/useRun.ts";
import { ApprovalWait, HumanWait, RunTimeline, StatusDot, runStatusText } from "../editor/run/RunLog.tsx";
import { ResultView } from "../editor/run/ResultView.tsx";
import { RunScreen } from "../live/RunScreen.tsx";
import { useMe } from "../shell/me.ts";
import { IconPlay } from "../icons.tsx";
import { paramProblem, withParamDefaults, type Flow } from "@flowsmith/core";

type Loaded = { flow: Flow; version: number } | { error: string };

export function RunForm({ flowId }: { flowId: string }) {
  const me = useMe();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    setLoaded(null);
    api.getPublished(flowId).then(
      (p) => { const flow = normalize(p.manifest); setLoaded({ flow, version: p.version }); setParams(Object.fromEntries(flow.params.map((x) => [x.name, ""]))); },
      (e: unknown) => setLoaded({ error: e instanceof ApiError && e.status === 404 ? "아직 게시된 버전이 없습니다 — 편집 화면에서 게시한 뒤에 돌릴 수 있습니다" : e instanceof Error ? e.message : String(e) }),
    );
    return () => stop.current?.();
  }, [flowId]);

  // 서버 브라우저에서 돌다 사람을 기다리면 실제 화면을 바로 연다(사람의 크롬이면 그 창에서 한다)
  const waiting = view?.status === "running" && view.human ? view.runId : null;
  useEffect(() => { if (waiting && loaded && "flow" in loaded && loaded.flow.settings.browser !== "attach" && loaded.flow.settings.browser !== "app") setWatching(true); }, [waiting]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <div className="page"><div className="empty">불러오는 중…</div></div>;
  if ("error" in loaded) return <div className="page run-form"><div className="banner bad">{loaded.error}</div></div>;
  const { flow, version } = loaded;
  const filled = withParamDefaults(flow.params, params);
  const missing = flow.params.filter((p) => p.required && (filled[p.name] ?? "").trim() === "");
  const wrong = flow.params.filter((p) => (params[p.name] ?? "").trim() !== "" && paramProblem(p, params[p.name]!));
  const canRun = me.can("runner");
  const running = view?.status === "running";

  const start = async () => {
    if (missing.length || wrong.length || busy) return;
    setBusy(true); setError(null);
    try {
      const { runId } = await api.startRun(flowId, undefined, params);
      const nameOf = (id: string) => flow.nodes.find((n) => n.id === id)?.name ?? id;
      setView({ runId, status: "running", message: "", nodes: [], output: null, label: `v${version}`, startedAt: new Date().toISOString(), ms: null, human: null });
      stop.current?.();
      stop.current = api.watchRun(runId, (e) => {
        if (e.kind === "run:end") { void api.getRun(runId).then((r) => setView(viewOf(r))); return; }
        setView((v) => (v && v.runId === runId ? applyWatch(v, e, nameOf) : v));
      });
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.problems] : [String(e)]);
    } finally {
      setBusy(false);
    }
  };
  const current = view?.nodes.find((n) => n.status === "running");

  return (
    <div className="page run-form">
      <div className="page-head"><h1 className="grow">{flow.name}</h1><span className="pill ok">게시됨 v{version}</span></div>
      {flow.description && <div className="page-sub">{flow.description}</div>}
      {!canRun && <div className="banner warn">실행자 이상만 돌릴 수 있습니다 — 관리자에게 역할을 부탁하세요.</div>}

      {(!view || !running) && (
        <form className="card stack run-form-card" onSubmit={(e) => { e.preventDefault(); void start(); }}>
          {flow.params.length === 0 && <div className="small muted">받는 입력이 없습니다 — 바로 돌립니다.</div>}
          {flow.params.map((p, i) => (
            <ParamInput key={p.name} def={p} value={params[p.name] ?? ""} autoFocus={i === 0} onChange={(v) => setParams((x) => ({ ...x, [p.name]: v }))} />
          ))}
          {error && <div className="banner bad small">{error.map((x, i) => <div key={i}>{x}</div>)}</div>}
          <div className="row">
            <span className="grow small muted">{missing.length ? `${missing.map((p) => p.label || p.name).join(" · ")}을(를) 넣어 주세요` : ""}</span>
            <button className="primary" disabled={!canRun || busy || missing.length > 0 || wrong.length > 0}><IconPlay size={14} /> {view ? "다시 실행" : "실행"}</button>
          </div>
        </form>
      )}

      {view && (
        <div className="card stack run-form-card">
          <div className="row">
            <StatusDot status={view.status} />
            <b className="grow">{running ? (view.human ? "사람을 기다리는 중" : view.approval ? "승인을 기다리는 중" : current ? `${current.name} — 도는 중` : view.message || "시작하는 중") : runStatusText(view.status)}</b>
            {running && <button className="small" onClick={() => setWatching(true)}>{view.human ? "실제 화면에서 하기" : "실제 화면 보기"}</button>}
            {running && <button className="small danger" onClick={() => void api.cancelRun(view.runId).catch(() => undefined)}>멈추기</button>}
          </div>
          {running && view.human && <HumanWait human={view.human} onScreen={() => setWatching(true)} />}
          {running && view.approval && <ApprovalWait runId={view.runId} approval={view.approval} />}
          {running && !view.human && view.message && <div className="small muted">{view.message}</div>}
          {!running && view.message && <div className={`banner ${view.status === "failure" ? "bad" : "info"} small`}>{view.message}</div>}
          {!running && <RunTimeline view={view} />}
          {view.status === "success" && <ResultView value={view.output ?? {}} fileName={`${flow.name}-결과`} />}
          {!running && view.status === "failure" && (() => {
            const f = view.nodes.find((n) => n.failure);
            return f ? <div className="small"><b>{f.name}</b>에서 멈췄습니다 — {f.failure!.message.split("\n")[0]}</div> : null;
          })()}
        </div>
      )}
      {watching && view && <RunScreen runId={view.runId} title={flow.name} onClose={() => setWatching(false)} {...(current ? { step: current.name } : {})} />}
    </div>
  );
}
