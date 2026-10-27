/**
 * **워크플로우 목록 정돈** — 묶어 보기 · 정렬 · 찾기 · 살펴볼 것(FlowList가 쓴다).
 *
 * 묶음은 사람이 적지 않는다 — **고른 축으로 본다**(GroupBy).
 *   화면   서버가 주소로 알아낸 화면(FlowSummary.area — 화면 규칙, server storage/areas.ts). 틀린 것만 직접 지정(FlowSummary.group)이 이긴다
 *   Suite  들어 있는 Suite마다(여럿이면 여러 곳에) · 어느 Suite에도 없는 것은 맨 뒤
 * 화면 규칙이 아직 없으면 주소의 «호스트/첫 마디»로 규칙을 제안한다(suggestAreas).
 */
// 서버의 모양을 바로 — api.ts는 브라우저 것(fetch · 이벤트)까지 끌고 와서 모델 시험이 무거워진다
import type { FlowSummary } from "@flowsmith/server/api-types";

const SEP = " · ";
/** 앞말이 이보다 길면 묶음이 아니라 문장이다 */
const MAX_GROUP = 24;

/** 이름을 «앞말 · 나머지»로 — 앞말이 없거나 너무 길면 null */
export function splitName(name: string): { group: string; rest: string } | null {
  const i = name.indexOf(SEP);
  if (i <= 0) return null;
  const group = name.slice(0, i).trim();
  const rest = name.slice(i + SEP.length).trim();
  if (!group || !rest || group.length > MAX_GROUP) return null;
  return { group, rest };
}

/** 살펴볼 것 — 고칠 문제 · 마지막 실행 실패 · 사이트가 바뀜/깨짐 */
export function needsAttention(f: FlowSummary): boolean {
  return f.problems > 0 || f.lastRun?.status === "failure" || (f.monitor !== null && (f.monitor.status === "broken" || f.monitor.status === "changed"));
}

export type FlowSort = "updated" | "run" | "name" | "attention";
export const SORT_LABEL: Record<FlowSort, string> = { updated: "최근 고침", run: "최근 실행", name: "이름", attention: "살펴볼 것 먼저" };

export type GroupBy = "area" | "suite" | "none";
export const GROUP_BY_LABEL: Record<GroupBy, string> = { area: "화면", suite: "Suite", none: "묶지 않음" };

const byName = (a: string, b: string) => a.localeCompare(b, "ko", { numeric: true });

export function sortFlows(flows: readonly FlowSummary[], by: FlowSort): FlowSummary[] {
  const out = [...flows];
  const updated = (a: FlowSummary, b: FlowSummary) => b.updatedAt.localeCompare(a.updatedAt);
  if (by === "updated") out.sort(updated);
  // 돌린 적 없는 것은 뒤로
  else if (by === "run") out.sort((a, b) => (b.lastRun?.at ?? "").localeCompare(a.lastRun?.at ?? "") || updated(a, b));
  else if (by === "name") out.sort((a, b) => byName(a.name, b.name));
  else out.sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || updated(a, b));
  return out;
}

/** 보이는 화면 — 직접 지정이 자동을 이긴다 */
export const areaName = (f: FlowSummary): string | null => f.group ?? f.area;

/** 이름 · id · 설명 · 화면에서 찾는다(띄어 쓴 낱말이 모두 들어 있어야) */
export function matchesQuery(f: FlowSummary, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${f.name} ${f.id} ${f.description ?? ""} ${areaName(f) ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface FlowGroup {
  /** null이면 «화면 모름» · «Suite에 없음» */
  name: string | null;
  flows: { flow: FlowSummary; label: string }[];
  attention: number;
}

/** 묶음 안에서 보일 이름 — 이름이 «묶음 · …»으로 시작하면 앞말을 뗀다(머리에 이미 있다) */
export function labelIn(group: string | null, name: string): string {
  if (group === null) return name;
  const s = splitName(name);
  return s && s.group === group ? s.rest : name;
}

/**
 * 묶는다 — keysOf가 준 묶음마다(여럿이면 여러 곳에 · 빈 목록이면 null 묶음). 묶음은 later가 아닌 것 먼저 · 그 안에서 이름 차례, null은 맨 뒤.
 * later — 뒤로 보낼 묶음(화면 규칙에 없는 호스트 — 아직 정하지 않은 것). 묶음 안의 차례는 받은 차례(정렬한 대로)
 */
export function groupFlows(flows: readonly FlowSummary[], keysOf: (f: FlowSummary) => readonly string[] = (f) => { const a = areaName(f); return a ? [a] : []; }, later: (name: string) => boolean = () => false): FlowGroup[] {
  const groups = new Map<string | null, FlowGroup>();
  for (const f of flows) {
    const keys = keysOf(f);
    for (const key of keys.length ? [...new Set(keys)] : [null]) {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { name: key, flows: [], attention: 0 }));
      g.flows.push({ flow: f, label: labelIn(key, f.name) });
      if (needsAttention(f)) g.attention++;
    }
  }
  return [...groups.values()].sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : Number(later(a.name)) - Number(later(b.name)) || byName(a.name, b.name)));
}

/** Suite로 묶기 — 워크플로우 id → 들어 있는 Suite 이름들 */
export function suiteKeys(suites: readonly { name: string; items: readonly { flowId: string }[] }[]): (f: FlowSummary) => string[] {
  const by = new Map<string, string[]>();
  for (const s of suites) for (const id of new Set(s.items.map((i) => i.flowId))) by.set(id, [...(by.get(id) ?? []), s.name]);
  return (f) => by.get(f.id) ?? [];
}

/** 있는 화면 이름들(이름 차례) — 직접 지정 메뉴. 규칙의 이름 + 지금 쓰이는 이름 */
export function areaNames(flows: readonly FlowSummary[], rules: readonly { name: string }[] = []): string[] {
  return [...new Set([...rules.map((r) => r.name), ...flows.flatMap((f) => { const a = areaName(f); return a ? [a] : []; })])].sort(byName);
}

/** 직접 지정했지만 자동과 같은 것 — 지정을 풀어도 그대로라 풀 수 있다 */
export const redundantOverrides = (flows: readonly FlowSummary[]): string[] => flows.filter((f) => f.group !== null && f.group === f.area).map((f) => f.id);

/**
 * 화면 규칙 제안 — 규칙에 안 맞은 워크플로우(직접 지정 없이)의 주소를 «호스트/첫 마디»로 모아 둘 이상인 것. 많은 차례.
 * 이름은 첫 마디(첫 글자만 크게) · 첫 마디가 없으면 호스트 — 사람이 고쳐 쓴다
 */
export function suggestAreas(flows: readonly FlowSummary[], rules: readonly { prefix: string; name: string }[]): { prefix: string; name: string; count: number }[] {
  const named = new Set(rules.map((r) => r.name));
  const have = new Set(rules.map((r) => r.prefix));
  const by = new Map<string, number>();
  for (const f of flows) {
    if (f.group !== null || f.site === null || (f.area !== null && named.has(f.area))) continue;
    const [host, seg] = f.site.split("/");
    const prefix = seg ? `${host}/${seg}` : host!;
    by.set(prefix, (by.get(prefix) ?? 0) + 1);
  }
  return [...by].filter(([p, n]) => n >= 2 && !have.has(p))
    .map(([prefix, count]) => { const seg = prefix.split("/")[1]; return { prefix, count, name: seg ? seg[0]!.toUpperCase() + seg.slice(1) : prefix }; })
    .sort((a, b) => b.count - a.count || byName(a.prefix, b.prefix));
}

/** 사람이 적은 주소 앞부분을 서버처럼 다듬는다(스킴 · 물음표 뒤 · 끝의 / 떼기 · 호스트는 작은 글자) — 틀린 꼴이면 null */
export function normPrefix(raw: string): string | null {
  const m = /^(?:https?:\/\/)?([^/?#\s]+)([^?#\s]*)/i.exec(raw.split("{{")[0]!.trim());
  return m ? m[1]!.toLowerCase() + m[2]!.replace(/\/+$/, "") : null;
}

/** 고치는 중인 규칙마다 맞는 워크플로우 수(미리 보기 — 직접 지정한 것은 빼고 · site로 가장 긴 것) */
export function previewAreaCounts(flows: readonly FlowSummary[], prefixes: readonly string[]): number[] {
  const norm = prefixes.map(normPrefix);
  const out = prefixes.map(() => 0);
  for (const f of flows) {
    if (f.group !== null || f.site === null) continue;
    let best = -1;
    norm.forEach((p, i) => { if (p && (f.site === p || f.site!.startsWith(p + "/")) && (best < 0 || p.length > norm[best]!.length)) best = i; });
    if (best >= 0) out[best]!++;
  }
  return out;
}
