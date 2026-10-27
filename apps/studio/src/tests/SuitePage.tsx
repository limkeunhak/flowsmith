/**
 * **Suite 하나** — 시나리오(차례 · 플로우 · 실행 입력 · 켜고 끄기 · 단건 실행) · 일정 · 알림 · 실행 기록과 판정.
 *
 *   ▶ 전체 실행  켜 둔 시나리오를 차례로 — 하나가 실패해도 다음으로
 *   ▶(줄마다)    그 시나리오 하나만
 *   판정        통과(끝까지 돎) · 불통과(검사 노드가 틀림 — 기대 · 실제 · 그때의 화면) · 오류(사이트 · 요소 · 시간 · 게시 안 됨)
 * ★시나리오는 게시된 버전을 돈다 — 고친 것은 게시해야 테스트에 들어간다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { describeCron, NOTIFY_CHANNELS, type ParamDef } from "@flowsmith/core";
import { api, ApiError, type FlowSummary, type SuiteDetail, type SuiteRunView, type SuiteView } from "../api.ts";
import { normalize, nextId } from "../model/index.ts";
import { useMe } from "../shell/me.ts";
import { useLeaveGuard } from "../shell/nav.ts";
import { useTitle } from "../shell/title.ts";
import { IconPlay, IconPlus, IconX } from "../icons.tsx";
import { dateTimeDay } from "../format.ts";
import { durationText } from "@flowsmith/core";

type Edit = Pick<SuiteView, "name" | "description" | "items" | "schedules" | "notify"> & { team: string | null };

const VERDICT: Record<string, { label: string; cls: string }> = {
  pass: { label: "통과", cls: "ok" }, fail: { label: "불통과", cls: "bad" }, error: { label: "오류", cls: "warn" },
  running: { label: "도는 중", cls: "accent" }, pending: { label: "기다림", cls: "" }, skipped: { label: "안 돎", cls: "" },
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pass: { label: "통과", cls: "ok" }, fail: { label: "불통과", cls: "bad" }, error: { label: "오류", cls: "warn" }, running: { label: "도는 중", cls: "accent" }, cancelled: { label: "멈춤", cls: "" },
};
const CHANNEL_LABEL: Record<string, string> = { slack: "Slack", teams: "Teams", webhook: "웹훅", email: "메일" };

/** Suite 실행의 상태 — 통과 3 · 불통과 1 */
export function SuiteStatus({ run }: { run: Pick<SuiteRunView, "status" | "items"> }) {
  const s = STATUS[run.status] ?? { label: run.status, cls: "" };
  const n = (v: string) => run.items.filter((i) => i.verdict === v).length;
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className={`pill ${s.cls}`}>{s.label}</span>
      <span className="small muted">통과 {n("pass")}{n("fail") ? ` · 불통과 ${n("fail")}` : ""}{n("error") ? ` · 오류 ${n("error")}` : ""}</span>
    </span>
  );
}

const editOf = (s: SuiteView): Edit => ({ name: s.name, description: s.description, items: s.items, schedules: s.schedules, notify: s.notify, team: s.team?.id ?? null });

export function SuitePage({ id, runId }: { id: string; runId: string | null }) {
  const me = useMe();
  const [detail, setDetail] = useState<SuiteDetail | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [error, setError] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(runId);
  const [run, setRun] = useState<SuiteRunView | null>(null);
  const saved = useRef<string>("");
  const canEdit = me.can("editor");
  const canRun = me.can("runner");

  const load = async () => {
    try {
      const d = await api.getSuite(id);
      setDetail(d);
      setEdit((cur) => {
        // 고치는 중이면 덮어쓰지 않는다(실행 기록만 새로)
        if (cur && JSON.stringify(cur) !== saved.current) return cur;
        const e = editOf(d.suite);
        saved.current = JSON.stringify(e);
        return e;
      });
    } catch (e) { setError([e instanceof Error ? e.message : String(e)]); }
  };
  useEffect(() => { void load(); void api.listFlows().then(setFlows, () => undefined); }, [id]);
  useEffect(() => { setPicked(runId); }, [runId]);
  // 보고 있는 실행 · 도는 동안 새로
  const show = picked ?? detail?.runs[0]?.id ?? null;
  useEffect(() => {
    if (!show) { setRun(null); return; }
    let gone = false;
    const get = () => api.getSuiteRun(show).then((r) => { if (!gone) setRun(r); }, () => undefined);
    void get();
    return () => { gone = true; };
  }, [show]);
  const running = detail?.running || detail?.runs.some((r) => r.status === "running") || run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => { void load(); if (show) void api.getSuiteRun(show).then(setRun, () => undefined); }, 1500);
    return () => clearInterval(t);
  }, [running, show]);   // eslint-disable-line react-hooks/exhaustive-deps

  useTitle(detail ? `${detail.suite.name} — 테스트` : "테스트");
  // 떠날 때 — 이 Suite 안(실행 고르기)은 상관없다 · 저장하지 않은 고침이 있으면 묻는다(창을 닫을 때도)
  const unsaved = () => edit !== null && JSON.stringify(edit) !== saved.current;
  useLeaveGuard((_from, to) => (to.startsWith(`#/tests/${encodeURIComponent(id)}`) || !unsaved() ? null : { ask: "저장하지 않은 고침이 있습니다. 떠날까요?" }));
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (unsaved()) e.preventDefault(); };
    addEventListener("beforeunload", on);
    return () => removeEventListener("beforeunload", on);
  });

  if (!detail || !edit) return <div className="page muted">{error ? error.join(" · ") : "불러오는 중…"}</div>;
  const dirty = JSON.stringify(edit) !== saved.current;
  const set = (patch: Partial<Edit>) => setEdit({ ...edit, ...patch });
  const save = async () => {
    setError(null);
    try {
      const s = await api.saveSuite(id, edit);
      const e = editOf(s);
      saved.current = JSON.stringify(e);
      setEdit(e);
    } catch (e) { setError(e instanceof ApiError ? [e.message, ...e.problems] : [String(e)]); }
  };
  const start = async (item: string | null) => {
    setError(null);
    try {
      const r = await api.runSuite(id, item);
      setPicked(r.suiteRunId);
      history.replaceState(null, "", `#/tests/${encodeURIComponent(id)}/runs/${encodeURIComponent(r.suiteRunId)}`);
      await load();
    } catch (e) { setError(e instanceof ApiError ? [e.message, ...e.problems] : [String(e)]); }
  };
  const del = async () => {
    if (!confirm(`«${detail.suite.name}» Suite를 지울까요? 실행 기록도 함께 지워집니다.`)) return;
    try { await api.deleteSuite(id); location.hash = "#/tests"; } catch (e) { setError([e instanceof Error ? e.message : String(e)]); }
  };

  return (
    <div className="page suite-page">
      <div className="page-head">
        <a href="#/tests" className="muted">테스트 /</a>
        <input className="title-input grow" value={edit.name} aria-label="Suite 이름" disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} />
        {dirty && <span className="save-state dirty">저장 안 됨</span>}
        {canEdit && <button disabled={!dirty} onClick={() => void save()}>저장</button>}
        {canRun && (running && run?.status === "running"
          ? <button className="danger" onClick={() => void api.cancelSuiteRun(run.id).then(load, () => undefined)}>멈추기</button>
          : <button className="primary" disabled={dirty || !edit.items.some((i) => i.enabled)} title={dirty ? "먼저 저장하세요" : ""} onClick={() => void start(null)}><IconPlay size={14} /> 전체 실행</button>)}
      </div>
      <div className="page-sub">
        {me.auth && (
          <select value={edit.team ?? ""} disabled={!canEdit} aria-label="팀" style={{ width: "auto", marginRight: 8 }} onChange={(e) => set({ team: e.target.value || null })}>
            {detail.suite.team && !me.teams.some((t) => t.id === detail.suite.team!.id) && <option value={detail.suite.team.id}>{detail.suite.team.name}</option>}
            {me.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="">공용</option>
          </select>
        )}
        시나리오는 <b>게시된 버전</b>을 차례로 돕니다 — 하나가 실패해도 다음으로 갑니다.
      </div>
      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error.map((x, i) => <div key={i}>{x}</div>)}</div>}

      <div className="suite-grid">
        <div className="stack">
          <section className="card stack suite-section">
            <h3>시나리오</h3>
            {edit.items.length === 0 && <span className="small muted">아직 없습니다 — 검사 노드로 기대값을 정한 워크플로우를 게시한 뒤 넣으세요</span>}
            {edit.items.map((it, i) => (
              <ScenarioRow key={it.id} n={i + 1} item={it} flows={flows} canEdit={canEdit} canRun={canRun && !dirty && !running}
                onChange={(next) => set({ items: edit.items.map((x) => (x.id === it.id ? next : x)) })}
                onMove={(d) => { const xs = [...edit.items]; const j = i + d; if (j < 0 || j >= xs.length) return; [xs[i], xs[j]] = [xs[j]!, xs[i]!]; set({ items: xs }); }}
                onRemove={() => set({ items: edit.items.filter((x) => x.id !== it.id) })}
                onRun={() => void start(it.id)} />
            ))}
            {canEdit && <button className="small" onClick={() => set({ items: [...edit.items, { id: nextId("s", edit.items.map((x) => x.id)), flowId: "", label: "", params: {}, enabled: true }] })}><IconPlus size={13} /> 시나리오</button>}
          </section>

          <section className="card stack suite-section">
            <h3>일정</h3>
            {edit.schedules.length === 0 && <span className="small muted">없음 — 손으로만 돕니다</span>}
            {edit.schedules.map((s) => {
              let text: string;
              try { text = describeCron(s.cron); } catch (e) { text = `⚠ ${(e as Error).message}`; }
              return (
                <div key={s.id} className="row wrap">
                  <label className="check"><input type="checkbox" checked={s.enabled} disabled={!canEdit} onChange={(e) => set({ schedules: edit.schedules.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)) })} />켬</label>
                  <input className="mono" style={{ width: 150 }} value={s.cron} aria-label="cron" disabled={!canEdit} onChange={(e) => set({ schedules: edit.schedules.map((x) => (x.id === s.id ? { ...x, cron: e.target.value } : x)) })} />
                  <span className="small muted grow">{text}</span>
                  {canEdit && <button className="icon-btn" title="지우기" onClick={() => set({ schedules: edit.schedules.filter((x) => x.id !== s.id) })}><IconX size={14} /></button>}
                </div>
              );
            })}
            {canEdit && <button className="small" onClick={() => set({ schedules: [...edit.schedules, { id: nextId("c", edit.schedules.map((x) => x.id)), cron: "0 9 * * 1-5", enabled: true }] })}><IconPlus size={13} /> 일정</button>}
            <span className="small muted">분 시 일 월 요일 · 앞 실행이 돌고 있으면 그 차례는 건너뜁니다</span>
          </section>

          <section className="card stack suite-section">
            <h3>알림 — 끝나면 요약 한 건</h3>
            {edit.notify.map((r) => {
              const setR = (patch: Partial<typeof r>) => set({ notify: edit.notify.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) });
              const toggle = (on: "failure" | "recovered" | "success", yes: boolean) => setR({ on: yes ? [...new Set([...r.on, on])] : r.on.filter((x) => x !== on) });
              return (
                <div key={r.id} className="subcard stack" style={{ gap: 6 }}>
                  <div className="row">
                    <label className="check"><input type="checkbox" checked={r.enabled} disabled={!canEdit} onChange={(e) => setR({ enabled: e.target.checked })} />켬</label>
                    <select value={r.channel} disabled={!canEdit} style={{ width: "auto" }} aria-label="어디로" onChange={(e) => setR({ channel: e.target.value as typeof r.channel })}>
                      {NOTIFY_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
                    </select>
                    <input className="grow" value={r.url} disabled={!canEdit} placeholder={r.channel === "email" ? "받는 사람 — a@x.com, b@x.com" : "웹훅 주소 — https://…"} aria-label="주소" onChange={(e) => setR({ url: e.target.value })} />
                    {canEdit && <button className="icon-btn" title="지우기" onClick={() => set({ notify: edit.notify.filter((x) => x.id !== r.id) })}><IconX size={14} /></button>}
                  </div>
                  <div className="row wrap">
                    <label className="check"><input type="checkbox" checked={r.on.includes("failure")} disabled={!canEdit} onChange={(e) => toggle("failure", e.target.checked)} />불통과 · 오류</label>
                    <label className="check"><input type="checkbox" checked={r.on.includes("recovered")} disabled={!canEdit} onChange={(e) => toggle("recovered", e.target.checked)} />다시 통과(회복)</label>
                    <label className="check"><input type="checkbox" checked={r.on.includes("success")} disabled={!canEdit} onChange={(e) => toggle("success", e.target.checked)} />통과할 때마다</label>
                  </div>
                </div>
              );
            })}
            {canEdit && <button className="small" onClick={() => set({ notify: [...edit.notify, { id: nextId("n", edit.notify.map((x) => x.id)), channel: "slack", url: "", on: ["failure", "recovered"], enabled: true }] })}><IconPlus size={13} /> 알림</button>}
          </section>
          {canEdit && <div className="row"><span className="grow" /><button className="small ghost danger" onClick={() => void del()}>Suite 지우기</button></div>}
        </div>

        <div className="stack">
          <section className="card stack suite-section">
            <h3>실행 기록</h3>
            {detail.runs.length === 0 && <span className="small muted">아직 돌리지 않았습니다</span>}
            <div className="suite-runs">
              {detail.runs.map((r) => (
                <button key={r.id} className={`suite-run-item${r.id === show ? " on" : ""}`} onClick={() => { setPicked(r.id); history.replaceState(null, "", `#/tests/${encodeURIComponent(id)}/runs/${encodeURIComponent(r.id)}`); }}>
                  <SuiteStatus run={r} />
                  <span className="small muted grow" style={{ textAlign: "right" }}>{r.only ? "단건 · " : ""}{r.trigger === "schedule" ? "일정" : r.trigger === "api" ? "API" : "손으로"} · {dateTimeDay(new Date(r.startedAt))}</span>
                </button>
              ))}
            </div>
          </section>
          {run && <SuiteRunDetail run={run} />}
        </div>
      </div>
    </div>
  );
}

function ScenarioRow({ n, item, flows, canEdit, canRun, onChange, onMove, onRemove, onRun }: {
  n: number; item: SuiteView["items"][number]; flows: FlowSummary[]; canEdit: boolean; canRun: boolean;
  onChange: (x: SuiteView["items"][number]) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onRun: () => void;
}) {
  const flow = flows.find((f) => f.id === item.flowId);
  const [params, setParams] = useState<ParamDef[] | null>(null);
  const [unpublished, setUnpublished] = useState(false);
  useEffect(() => {
    if (!item.flowId) { setParams(null); return; }
    api.getPublished(item.flowId).then((p) => { setParams(normalize(p.manifest).params); setUnpublished(false); }, () => { setParams(null); setUnpublished(true); });
  }, [item.flowId]);
  const sorted = useMemo(() => [...flows].sort((a, b) => a.name.localeCompare(b.name)), [flows]);
  return (
    <div className={`subcard stack scenario${item.enabled ? "" : " off"}`} style={{ gap: 6 }}>
      <div className="row">
        <span className="step-n">{n}</span>
        <label className="check" title="끄면 전체 실행에서 뺍니다(단건으로는 돌릴 수 있습니다)"><input type="checkbox" checked={item.enabled} disabled={!canEdit} onChange={(e) => onChange({ ...item, enabled: e.target.checked })} /></label>
        <select className="grow" value={item.flowId} disabled={!canEdit} aria-label="워크플로우" onChange={(e) => onChange({ ...item, flowId: e.target.value, params: {} })}>
          <option value="">(워크플로우를 고르세요)</option>
          {sorted.map((f) => <option key={f.id} value={f.id}>{f.name}{f.activeVersion === null ? " — 게시 안 됨" : ` (v${f.activeVersion})`}</option>)}
        </select>
        {canEdit && <>
          <button className="icon-btn" title="위로" onClick={() => onMove(-1)}>↑</button>
          <button className="icon-btn" title="아래로" onClick={() => onMove(1)}>↓</button>
        </>}
        {canRun && item.flowId && <button className="icon-btn" title="이 시나리오만 돌리기" onClick={onRun}><IconPlay size={14} /></button>}
        {canEdit && <button className="icon-btn" title="빼기" onClick={onRemove}><IconX size={14} /></button>}
      </div>
      <input placeholder={flow ? `이름 — 비우면 «${flow.name}»` : "이름"} value={item.label} disabled={!canEdit} aria-label="시나리오 이름" onChange={(e) => onChange({ ...item, label: e.target.value })} />
      {unpublished && item.flowId && <div className="banner warn small">이 워크플로우는 게시하지 않았습니다 — 게시해야 돌 수 있습니다(돌리면 «오류»)</div>}
      {params && params.length > 0 && (
        <div className="row wrap scenario-params">
          {params.map((p) => (
            <label key={p.name} className="field" style={{ minWidth: 140, flex: "1 1 140px" }}>
              <span>{p.label || p.name}{p.required && !p.default ? " *" : ""}</span>
              <input value={item.params[p.name] ?? ""} placeholder={p.default ? `비우면 ${p.default}` : ""} disabled={!canEdit}
                onChange={(e) => onChange({ ...item, params: { ...item.params, [p.name]: e.target.value } })} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Suite 실행 하나 — 시나리오마다 판정 · 까닭 · 검사 · 불통과 화면 · 그 실행으로 가기 */
function SuiteRunDetail({ run }: { run: SuiteRunView }) {
  return (
    <section className="card stack suite-section suite-run-detail">
      <div className="row"><h3 className="grow">{dateTimeDay(new Date(run.startedAt))}</h3><SuiteStatus run={run} />{run.ms !== null && <span className="small muted">{durationText(run.ms)}</span>}</div>
      {run.items.map((it) => {
        const v = VERDICT[it.verdict] ?? { label: it.verdict, cls: "" };
        return (
          <div key={it.itemId} className={`suite-result v-${it.verdict}`}>
            <div className="row">
              <span className={`pill ${v.cls}`}>{v.label}</span>
              <b className="grow">{it.label}</b>
              {(it.checks.passed + it.checks.failed > 0) && <span className="small muted">검사 ✓{it.checks.passed}{it.checks.failed ? ` ✗${it.checks.failed}` : ""}</span>}
              {it.ms !== null && <span className="small muted">{durationText(it.ms)}</span>}
              {it.runId && <a className="small" href={`#/flows/${encodeURIComponent(it.flowId)}/runs/${encodeURIComponent(it.runId)}`}>실행 기록 →</a>}
            </div>
            {it.message && <div className="small suite-why">{it.message}</div>}
            {it.verdict === "fail" && it.runId && <FailShot runId={it.runId} />}
          </div>
        );
      })}
    </section>
  );
}

function FailShot({ runId }: { runId: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const src = `/api/runs/${encodeURIComponent(runId)}/shot`;
  return <a href={src} target="_blank" rel="noreferrer" className="suite-shot" title="불통과일 때의 화면 — 누르면 크게"><img src={src} alt="불통과일 때의 화면" onError={() => setGone(true)} /></a>;
}
