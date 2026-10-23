/**
 * **대시보드 집계** (PLAN §29) — 실행 기록에서 숫자를 모은다. 순수하다(저장소는 실행 목록만 준다).
 *
 *   실행        수 · 결과(성공 · 실패 · 멈춤 · 도는 중) · 실패율 · 실행 시간(평균 · P95)
 *   노드        종류마다 횟수 · 실패 · 시간 · 노드 실패율
 *   흐름        날마다(결과별 수 · P95) · 플로우마다 · 트리거마다 · 어디서(서버 · 워커)
 *   목록        최근 오류(어느 노드가 왜) · 최근 실행
 *
 * ★실패율은 끝난 것(성공 + 실패)으로 나눈다 — 사람이 멈춘 것 · 아직 도는 것은 빼고.
 * ★날은 서버 시각(TZ)으로 자른다 — 사람이 보는 «오늘»과 같게.
 */

import type { StatNode, StatRun } from "../storage/types.ts";
export type { StatNode, StatRun };

export interface Dashboard {
  range: { days: number; since: string; until: string };
  totals: { runs: number; success: number; failure: number; cancelled: number; blocked: number; running: number; errorRate: number | null; avgMs: number | null; p95Ms: number | null };
  nodes: { runs: number; failed: number; errorRate: number | null; byType: { type: string; count: number; failed: number; avgMs: number | null; p95Ms: number | null }[] };
  byDay: { day: string; success: number; failure: number; cancelled: number; blocked: number; p95Ms: number | null }[];
  byFlow: { flowId: string; name: string; runs: number; success: number; failure: number; errorRate: number | null; p95Ms: number | null; lastAt: string | null }[];
  byTrigger: { trigger: string; count: number }[];
  byPlace: { place: string | null; count: number }[];
  errors: { runId: string; flowId: string; flowName: string; at: string; message: string; node: string | null; nodeType: string | null; ms: number | null; trigger: string; ranOn: string | null }[];
  recent: { runId: string; flowId: string; flowName: string; at: string; status: StatRun["status"]; ms: number | null; trigger: string; version: number | null; ranOn: string | null; startedBy: string | null }[];
}

/** 열쇠마다 모은다(나온 차례 그대로) */
function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}

/** 백분위(가까운 순위) — 비었으면 null */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}
const avg = (v: readonly number[]): number | null => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
const rate = (bad: number, all: number): number | null => (all > 0 ? bad / all : null);
const pad = (n: number) => String(n).padStart(2, "0");
/** 서버 시각의 날 — 2026-10-17 */
export const dayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * runs — 기간 안의 실행(저장소가 since 이후만 준다) · names — 보이는 플로우의 이름(이 밖의 플로우 실행은 뺀다)
 */
export function dashboard(runs: readonly StatRun[], names: ReadonlyMap<string, string>, days: number, now = new Date()): Dashboard {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const mine = runs.filter((r) => names.has(r.flowId) && new Date(r.startedAt) >= start);
  const done = mine.filter((r) => r.status === "success" || r.status === "failure");
  const msOf = (rs: readonly StatRun[]) => rs.filter((r) => r.status !== "running" && r.ms !== null).map((r) => r.ms!);
  const count = (rs: readonly StatRun[], s: StatRun["status"]) => rs.filter((r) => r.status === s).length;

  // 노드 — 돌지 않은(건너뜀 · 기다림) 노드는 세지 않는다
  const ran = mine.flatMap((r) => r.nodes).filter((n) => n.status === "succeeded" || n.status === "failed");
  const types = groupBy(ran, (n) => n.type);

  // 날마다 — 빈 날도 0으로(그래프가 끊기지 않게)
  const perDay = groupBy(mine, (r) => dayOf(new Date(r.startedAt)));
  const byDay: Dashboard["byDay"] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayOf(d);
    const rs = perDay.get(key) ?? [];
    byDay.push({ day: key, success: count(rs, "success"), failure: count(rs, "failure"), cancelled: count(rs, "cancelled"), blocked: count(rs, "blocked"), p95Ms: percentile(msOf(rs), 95) });
  }

  const flows = groupBy(mine, (r) => r.flowId);
  const tally = <K extends string | null>(key: (r: StatRun) => K) => {
    const m = new Map<K, number>();
    for (const r of mine) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const latest = [...mine].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const nameOf = (id: string) => names.get(id) ?? id;

  return {
    range: { days, since: start.toISOString(), until: now.toISOString() },
    totals: {
      runs: mine.length, success: count(mine, "success"), failure: count(mine, "failure"), cancelled: count(mine, "cancelled"), blocked: count(mine, "blocked"), running: count(mine, "running"),
      errorRate: rate(count(done, "failure"), done.length), avgMs: avg(msOf(mine)), p95Ms: percentile(msOf(mine), 95),
    },
    nodes: {
      runs: ran.length, failed: ran.filter((n) => n.status === "failed").length, errorRate: rate(ran.filter((n) => n.status === "failed").length, ran.length),
      byType: [...types.entries()].map(([type, ns]) => ({ type, count: ns.length, failed: ns.filter((n) => n.status === "failed").length, avgMs: avg(ns.map((n) => n.ms)), p95Ms: percentile(ns.map((n) => n.ms), 95) }))
        .sort((a, b) => b.count - a.count),
    },
    byDay,
    byFlow: [...flows.entries()].map(([flowId, rs]) => {
      const fin = rs.filter((r) => r.status === "success" || r.status === "failure");
      return { flowId, name: nameOf(flowId), runs: rs.length, success: count(rs, "success"), failure: count(rs, "failure"), errorRate: rate(count(fin, "failure"), fin.length), p95Ms: percentile(msOf(rs), 95), lastAt: rs.map((r) => r.startedAt).sort().at(-1) ?? null };
    }).sort((a, b) => b.runs - a.runs),
    byTrigger: tally((r) => r.trigger).map(([trigger, c]) => ({ trigger, count: c })),
    byPlace: tally((r) => r.ranOn).map(([place, c]) => ({ place, count: c })),
    errors: latest.filter((r) => r.status === "failure").slice(0, 50).map((r) => {
      const bad = r.nodes.find((n) => n.status === "failed");
      return { runId: r.id, flowId: r.flowId, flowName: nameOf(r.flowId), at: r.startedAt, message: bad?.failure ?? r.message, node: bad?.name ?? null, nodeType: bad?.type ?? null, ms: r.ms, trigger: r.trigger, ranOn: r.ranOn };
    }),
    recent: latest.slice(0, 50).map((r) => ({ runId: r.id, flowId: r.flowId, flowName: nameOf(r.flowId), at: r.startedAt, status: r.status, ms: r.ms, trigger: r.trigger, version: r.version, ranOn: r.ranOn, startedBy: r.startedBy })),
  };
}
