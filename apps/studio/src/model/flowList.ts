/**
 * **워크플로우 목록 정돈** — 묶기 · 정렬 · 찾기 · 살펴볼 것(FlowList가 쓴다).
 *
 * 묶음은 이름에서 읽는다 — «Navigator · 이름 검색»처럼 «묶음 · 이름»으로 지은 것을 같은 묶음으로 본다.
 * 데이터에 묶음 칸을 두기 전의 1단계다(이름을 바꾸면 묶음도 바뀐다). 같은 앞말이 둘 이상일 때만 묶음이다 —
 * 하나뿐이면 «주문 · 조회» 같은 그냥 이름일 수 있다.
 */
// 서버의 모양을 바로 — api.ts는 브라우저 것(fetch · 이벤트)까지 끌고 와서 모델 시험이 무거워진다
import type { FlowSummary } from "@flowsmith/server/api-types";

const SEP = " · ";
/** 앞말이 이보다 길면 묶음이 아니라 문장이다 */
const MAX_GROUP = 24;

/** 이름을 «묶음 · 나머지»로 — 앞말이 없거나 너무 길면 null */
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

/** 이름 · id · 설명에서 찾는다(띄어 쓴 낱말이 모두 들어 있어야) */
export function matchesQuery(f: FlowSummary, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${f.name} ${f.id} ${f.description ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface FlowGroup {
  /** null이면 묶음 없음 */
  name: string | null;
  flows: { flow: FlowSummary; label: string }[];
  attention: number;
}

/**
 * 묶는다 — 묶음은 이름 차례, 묶음 없음은 맨 뒤. 묶음 안의 차례는 받은 차례(정렬한 대로).
 * 묶음 안에서는 이름의 앞말을 떼어 보인다(머리에 이미 있다).
 */
export function groupFlows(flows: readonly FlowSummary[]): FlowGroup[] {
  const count = new Map<string, number>();
  for (const f of flows) { const s = splitName(f.name); if (s) count.set(s.group, (count.get(s.group) ?? 0) + 1); }
  const groups = new Map<string | null, FlowGroup>();
  for (const f of flows) {
    const s = splitName(f.name);
    const key = s && (count.get(s.group) ?? 0) >= 2 ? s.group : null;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: key, flows: [], attention: 0 }));
    g.flows.push({ flow: f, label: key === null ? f.name : s!.rest });
    if (needsAttention(f)) g.attention++;
  }
  return [...groups.values()].sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : byName(a.name, b.name)));
}
