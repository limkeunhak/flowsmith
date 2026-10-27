/**
 * **대시보드** (PLAN §29) — 실행이 잘 되고 있나 한눈에. 서버가 모은 숫자(/api/dashboard)를 그린다.
 *
 *   숫자     실행 · 실패율 · 노드 실패율 · 실행 시간(P95)
 *   흐름     날마다 실행(결과별) · 날마다 실행 시간(P95)
 *   나눔     실행 결과 · 노드 종류 · 플로우별 · 실행 위치
 *   목록     오류 · 노드 종류별 · 플로우별 · 최근 실행 — 누르면 그 실행 기록
 * 30초마다 다시 읽는다. 기간 · 플로우는 이 브라우저가 기억한다.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NODE_TYPE_LABEL, TRIGGER_LABEL, RUN_STATUS_LABEL } from "@flowsmith/core";
import { api, ApiError, type DashboardView } from "../api.ts";
import { EmptyState } from "../EmptyState.tsx";
import { IconChart } from "../icons.tsx";
import { Donut, dur, Line, num, pct, StackBars, type Slice } from "./charts.tsx";
import { dateTime } from "../format.ts";
import { poll } from "../shell/poll.ts";
import { Approvals } from "./Approvals.tsx";
import { recallJson, rememberJson } from "../shell/remember.ts";

const PERIODS = [{ days: 1, label: "오늘" }, { days: 7, label: "7일" }, { days: 30, label: "30일" }, { days: 90, label: "90일" }];
/** 노드 종류의 색 — 캔버스의 타일과 같다 */
const TYPE_COLOR: Record<string, string> = {
  web: "var(--web)", condition: "var(--condition)", transform: "var(--tf)", fileWrite: "var(--file)", fileRead: "var(--file)",
  http: "var(--http)", flowCall: "var(--call)", custom: "var(--custom)", extension: "var(--extension)",
};
const SERIES = ["var(--web)", "var(--http)", "var(--tf)", "var(--file)", "var(--call)", "var(--extension)", "var(--condition)", "var(--custom)"];
const KEY = "flowsmith:dashboard";
const recallOpt = (): { days: number; flow: string } => ({ days: 7, flow: "", ...recallJson<Partial<{ days: number; flow: string }>>(KEY, {}) });

const runHref = (flowId: string, runId: string) => `#/flows/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(runId)}`;

/** 앞에서 n개 + «그 밖» */
function topN(rows: { label: string; value: number }[], n: number, colors: string[]): Slice[] {
  const head = rows.slice(0, n).map((r, i) => ({ ...r, color: colors[i % colors.length]! }));
  const rest = rows.slice(n).reduce((a, r) => a + r.value, 0);
  return rest > 0 ? [...head, { label: "그 밖", value: rest, color: "var(--border-strong)" }] : head;
}

export function Dashboard() {
  const [opt, setOpt] = useState(recallOpt);
  const [v, setV] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => rememberJson(KEY, opt), [opt]);
  useEffect(() => {
    let gone = false;
    const load = () => api.getDashboard(opt.days, opt.flow || null).then((x) => { if (!gone) { setV(x); setError(null); } }, (e: Error) => { if (!gone) setError(e instanceof ApiError ? e.message : String(e)); });
    void load();
    const stop = poll(load, 30_000);
    return () => { gone = true; stop(); };
  }, [opt, tick]);

  const slices = useMemo(() => {
    if (!v) return null;
    return {
      result: [
        { label: "성공", value: v.totals.success, color: "var(--ok)" },
        { label: "실패", value: v.totals.failure, color: "var(--bad)" },
        { label: "막힘", value: v.totals.blocked ?? 0, color: "var(--blocked)" },
        { label: "멈춤", value: v.totals.cancelled, color: "var(--warn)" },
      ],
      types: v.nodes.byType.map((t) => ({ label: NODE_TYPE_LABEL[t.type as keyof typeof NODE_TYPE_LABEL] ?? t.type, value: t.count, color: TYPE_COLOR[t.type] ?? "var(--custom)" })),
      flows: topN(v.byFlow.map((f) => ({ label: f.name, value: f.runs })), 5, SERIES),
      places: topN(v.byPlace.map((p) => ({ label: p.place ?? "서버", value: p.count })), 5, ["var(--accent)", ...SERIES.slice(1)]),
    };
  }, [v]);

  return (
    <div className="page dash">
      <div className="page-head">
        <h1 className="grow">대시보드</h1>
        <select className="dash-flow" value={opt.flow} aria-label="워크플로우" onChange={(e) => setOpt({ ...opt, flow: e.target.value })}>
          <option value="">모든 워크플로우</option>
          {(v?.flows ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <div className="seg" role="radiogroup" aria-label="기간">
          {PERIODS.map((p) => <button key={p.days} role="radio" aria-checked={opt.days === p.days} className={opt.days === p.days ? "on" : ""} onClick={() => setOpt({ ...opt, days: p.days })}>{p.label}</button>)}
        </div>
        <button className="icon-btn" title="새로 고침" onClick={() => setTick((t) => t + 1)}>↻</button>
      </div>
      <div className="page-sub">실행 · 실패 · 시간을 한눈에 봅니다.</div>
      <Approvals />
      {error && <div className="banner bad" style={{ marginBottom: 12 }}>{error}</div>}
      {!v || !slices ? <div className="empty">불러오는 중…</div> : v.totals.runs === 0 ? (
        <EmptyState icon={<IconChart size={22} />} title="이 기간에 실행이 없습니다" action={<a className="button" href="#/">워크플로우로 가기</a>}>워크플로우를 실행하면 여기에 쌓입니다. 기간을 늘려 보거나 워크플로우를 한 번 돌려 보세요.</EmptyState>
      ) : (
        <>
          <div className="dash-stats">
            <Stat label="실행" value={num(v.totals.runs)} sub={`성공 ${num(v.totals.success)} · 실패 ${num(v.totals.failure)}${v.totals.running ? ` · 도는 중 ${v.totals.running}` : ""}`} />
            <Stat label="실패율" value={pct(v.totals.errorRate)} tone={(v.totals.errorRate ?? 0) >= 0.1 ? "bad" : "ok"} sub="끝난 실행 중" />
            <Stat label="노드 실패율" value={pct(v.nodes.errorRate)} tone={(v.nodes.errorRate ?? 0) >= 0.1 ? "bad" : "ok"} sub={`노드 ${num(v.nodes.runs)}번 중 ${num(v.nodes.failed)}`} />
            <Stat label="실행 시간 P95" value={dur(v.totals.p95Ms)} sub={`평균 ${dur(v.totals.avgMs)}`} />
          </div>

          <div className="dash-grid two">
            <Panel title="날마다 실행">
              <StackBars days={v.byDay.map((d) => d.day)} series={[
                { label: "성공", color: "var(--ok)", values: v.byDay.map((d) => d.success) },
                { label: "실패", color: "var(--bad)", values: v.byDay.map((d) => d.failure) },
                { label: "막힘", color: "var(--blocked)", values: v.byDay.map((d) => d.blocked ?? 0) },
                { label: "멈춤", color: "var(--warn)", values: v.byDay.map((d) => d.cancelled) },
              ]} />
              <Legend items={[["성공", "var(--ok)"], ["실패", "var(--bad)"], ["멈춤", "var(--warn)"]]} />
            </Panel>
            <Panel title="실행 시간 (P95)">
              <Line days={v.byDay.map((d) => d.day)} values={v.byDay.map((d) => d.p95Ms)} />
              <Legend items={[["날마다 P95", "var(--accent)"]]} />
            </Panel>
          </div>

          <div className="dash-grid four">
            <Panel title="실행 결과"><Donut slices={slices.result} center={num(v.totals.runs)} sub="실행" /></Panel>
            <Panel title="노드 종류"><Donut slices={slices.types} center={num(v.nodes.runs)} sub="노드 실행" /></Panel>
            <Panel title="워크플로우별 실행"><Donut slices={slices.flows} center={num(v.byFlow.length)} sub="워크플로우" /></Panel>
            <Panel title="실행 위치"><Donut slices={slices.places} center={num(v.byPlace.length)} sub="곳" /></Panel>
          </div>

          <div className="dash-grid two">
            <Panel title="최근 오류">
              {v.errors.length === 0 ? <div className="dash-none">이 기간에 실패한 실행이 없습니다</div> : (
                <Paged rows={v.errors} head={["시각", "워크플로우", "노드", "내용"]} cells={(e) => [
                  <a href={runHref(e.flowId, e.runId)}>{dateTime(e.at)}</a>, e.flowName, e.node ?? "—", <span className="dash-msg" title={e.message}>{e.message}</span>,
                ]} />
              )}
            </Panel>
            <Panel title="노드 종류별">
              <Paged rows={v.nodes.byType} head={["종류", "실행", "실패", "평균", "P95"]} num={[1, 2, 3, 4]} cells={(t) => [
                <span className="dash-type"><i style={{ background: TYPE_COLOR[t.type] ?? "var(--custom)" }} />{NODE_TYPE_LABEL[t.type as keyof typeof NODE_TYPE_LABEL] ?? t.type}</span>,
                num(t.count), t.failed ? <span className="bad-text">{num(t.failed)}</span> : "0", dur(t.avgMs), dur(t.p95Ms),
              ]} />
            </Panel>
          </div>

          <Panel title="워크플로우별">
            <Paged rows={v.byFlow} head={["워크플로우", "실행", "성공", "실패", "실패율", "P95", "마지막 실행"]} num={[1, 2, 3, 4, 5]} cells={(f) => [
              <a href={`#/flows/${encodeURIComponent(f.flowId)}`}>{f.name}</a>, num(f.runs), num(f.success),
              f.failure ? <span className="bad-text">{num(f.failure)}</span> : "0", pct(f.errorRate), dur(f.p95Ms), f.lastAt ? dateTime(f.lastAt) : "—",
            ]} />
          </Panel>

          <Panel title="최근 실행">
            <Paged rows={v.recent} head={["시각", "워크플로우", "결과", "시간", "트리거", "위치"]} num={[3]} cells={(r) => [
              <a href={runHref(r.flowId, r.runId)}>{dateTime(r.at)}</a>, r.flowName,
              <span className={`dash-status st-${r.status}`}>{RUN_STATUS_LABEL[r.status] ?? r.status}</span>, dur(r.ms),
              `${TRIGGER_LABEL[r.trigger] ?? r.trigger}${r.startedBy ? ` · ${r.startedBy.split("@")[0]}` : ""}`, r.ranOn ?? "서버",
            ]} />
          </Panel>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" }) {
  return (
    <div className="card dash-stat">
      <span className="dash-stat-label">{label}</span>
      <b className={tone ? `tone-${tone}` : ""}>{value}</b>
      {sub && <span className="dash-stat-sub">{sub}</span>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card dash-panel"><h2>{title}</h2>{children}</section>;
}

function Legend({ items }: { items: [string, string][] }) {
  return <ul className="legend inline">{items.map(([l, c]) => <li key={l}><i style={{ background: c }} /><span className="legend-label">{l}</span></li>)}</ul>;
}

/** 표 — 10줄씩 넘긴다 · num은 오른쪽 맞춤 칸 */
function Paged<T>({ rows, head, cells, num: right = [] }: { rows: T[]; head: string[]; cells: (r: T) => ReactNode[]; num?: number[] }) {
  const [page, setPage] = useState(0);
  const per = 10;
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const p = Math.min(page, pages - 1);
  return (
    <>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead><tr>{head.map((h, i) => <th key={h} className={right.includes(i) ? "r" : ""}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(p * per, p * per + per).map((r, j) => <tr key={j}>{cells(r).map((c, i) => <td key={i} className={right.includes(i) ? "r" : ""}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="dash-pager">
          <span className="small muted">{p * per + 1}–{Math.min(rows.length, p * per + per)} / {rows.length}</span>
          <button className="small" disabled={p === 0} onClick={() => setPage(p - 1)}>이전</button>
          <button className="small" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>다음</button>
        </div>
      )}
    </>
  );
}
