/**
 * **워커 고르기** (PLAN §26) — 실행을 어느 워커에 보낼지. 순수하다(연결 · DB를 모른다 — WorkerHub가 지금 상태를 넘긴다).
 *
 *   on        「worker:<id>」 그 워커 · 「label:<라벨>」 그 라벨이 붙은 공용 워커 중 한 곳(개인 워커는 콕 집어야만)
 *   받나      켜 둠 · 팀이 맞음 · 그 워커이거나 그 라벨
 *   못 가면   갈 곳이 하나도 없으면 까닭(사람 말) — 기다리지 않고 바로 실패
 *   자리      부모가 도는 워커가 먼저(자리를 함께 쓴다) · 그다음 빈 자리 중 덜 바쁜 곳
 */
import type { WorkerRow } from "../storage/store.ts";
import { workerFits } from "../rules/teams.ts";

/** 이 워커가 이 일을 받나 — 자리 · 연결은 따로 본다 */
export function accepts(w: WorkerRow, flowTeam: string | null, on: string): boolean {
  if (!w.enabled || !workerFits(w.team?.id ?? null, flowTeam)) return false;
  // ★개인 워커는 그 워커를 콕 집은 실행만(주인이 «내 PC에서»로 — runs.ts가 주인인지 먼저 봤다) · 라벨로는 받지 않는다
  return on === `worker:${w.id}` || (w.kind === "shared" && on.startsWith("label:") && w.labels.includes(on.slice(6)));
}

/** 지금 갈 곳이 하나도 없으면 그 까닭 — online은 그 워커가 붙어 있나 */
export function unavailable(on: string, flowTeam: string | null, workers: readonly WorkerRow[], online: (id: string) => boolean): string | null {
  const when = (w: WorkerRow) => (w.lastSeenAt ? ` (마지막 연결 ${new Date(w.lastSeenAt).toLocaleString("ko-KR")})` : " (한 번도 붙은 적이 없습니다)");
  if (on.startsWith("worker:")) {
    const w = workers.find((x) => x.id === on.slice(7));
    if (!w) return "이 워크플로우를 돌릴 워커가 지워졌습니다 — 워크플로우 설정의 «어디서 돌리나»를 다시 고르세요";
    if (!workerFits(w.team?.id ?? null, flowTeam)) return `«${w.name}»는 ${w.team!.name} 전용 워커입니다 — 이 워크플로우는 돌릴 수 없습니다`;
    if (!w.enabled) return `워커 «${w.name}»를 잠시 꺼 두었습니다 — «워커» 화면에서 다시 켜거나 다른 곳에서 돌리세요`;
    if (!online(w.id)) return w.kind === "personal"
      ? `내 PC «${w.name}»가 연결돼 있지 않습니다 — 그 PC에서 Flowsmith 앱을 켜세요${when(w)}`
      : `워커 «${w.name}»가 연결돼 있지 않습니다 — 그 PC에서 워커 프로그램을 켜세요${when(w)}`;
    return null;
  }
  if (on.startsWith("label:")) {
    const label = on.slice(6);
    const carry = workers.filter((w) => w.kind === "shared" && w.labels.includes(label) && workerFits(w.team?.id ?? null, flowTeam));
    if (carry.length === 0) return `라벨 «${label}»이 붙은 워커가 없습니다 — «워커» 화면에서 라벨을 붙이세요`;
    if (!carry.some((w) => w.enabled && online(w.id))) return `라벨 «${label}»이 붙은 워커(${carry.map((w) => w.name).join(", ")})가 하나도 연결돼 있지 않습니다 — 그 PC에서 워커 프로그램을 켜세요`;
    return null;
  }
  return `어디서 돌릴지를 읽을 수 없습니다 — ${on}`;
}

/** 붙어 있는 워커의 자리 — 지금 몇 개가 돌고, 그 실행이 거기서 도나 */
export interface Seat { id: string; running: number; has(runId: string): boolean }

/** 보낼 워커(id) — 없으면 null(줄에서 기다린다) */
export function pick(on: string, flowTeam: string | null, parentRunId: string | null | undefined, seats: readonly Seat[], workers: ReadonlyMap<string, WorkerRow>): string | null {
  const can = seats.filter((s) => { const w = workers.get(s.id); return w !== undefined && accepts(w, flowTeam, on); });
  // ★부른 실행 — 부모가 도는 워커면 자리를 함께 쓴다(부모가 자리를 쥔 채 자식을 기다리다 막히지 않게)
  if (parentRunId) { const home = can.find((s) => s.has(parentRunId)); if (home) return home.id; }
  const free = can.filter((s) => s.running < (workers.get(s.id)?.slots ?? 1)).sort((a, b) => a.running - b.running);
  return free[0]?.id ?? null;
}
