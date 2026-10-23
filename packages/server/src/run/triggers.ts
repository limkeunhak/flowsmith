/**
 * **트리거** — 사람이 누르지 않아도 게시된 플로우가 돈다 (PLAN §8 M6).
 *
 *   일정  settings.schedules의 cron — ★게시된 버전의 일정만. 같은 분에 두 번 돌지 않는다(DB가 막는다)
 *   웹훅  POST /api/hooks/:flowId — 토큰으로 막는다(같은 출처 검사는 하지 않는다 — 서버끼리 부르는 길이다)
 *
 * ★일정이 돌 수 없으면(시크릿이 없다 · 앞 실행이 아직 돈다) **실패한 실행으로 적는다** — 조용히 안 돌면 아무도 모른다.
 * ☆서버가 꺼져 있던 동안 지난 일정은 다시 돌리지 않는다.
 */
import { cronMatches, minuteKey, parseCron, explainProblems, problemLine } from "@flowsmith/core";
import type { Runs } from "./runs.ts";
import { StoreError, type Store } from "../storage/store.ts";
import { hashToken, newToken, sameSecret } from "../auth/tokens.ts";

const TICK_MS = 15_000;

export interface Fired {
  flowId: string;
  scheduleId: string;
  runId: string;
  started: boolean;
}

export class Scheduler {
  readonly #store: Store;
  readonly #runs: Runs;
  #timer: NodeJS.Timeout | null = null;

  constructor(store: Store, runs: Runs) {
    this.#store = store;
    this.#runs = runs;
  }

  start(tickMs = TICK_MS): void {
    this.#timer = setInterval(() => { try { this.tick(); } catch (e) { console.error("일정 확인 실패:", e); } }, tickMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** 이 분에 돌 일정을 돌린다 */
  tick(now = new Date()): Fired[] {
    const minute = minuteKey(now);
    const fired: Fired[] = [];
    for (const { id: flowId, version } of this.#store.activeFlows()) {
      let schedules;
      try { schedules = this.#store.getVersion(flowId, version).settings.schedules; } catch { continue; }
      for (const s of schedules) {
        if (!s.enabled) continue;
        try { if (!cronMatches(parseCron(s.cron), now)) continue; } catch { continue; }
        if (!this.#store.claimFire(flowId, s.id, minute)) continue;   // 이미 이 분에 돌았다
        const tag = `일정 ${s.id}(${s.cron})`;
        if (this.#runs.isRunning(flowId)) {
          fired.push({ flowId, scheduleId: s.id, started: false, runId: this.#runs.recordRejected(flowId, version, "schedule", s.params, `${tag} — 앞 실행이 아직 돌고 있어 이번 차례는 건너뛰었습니다`) });
          continue;
        }
        try {
          fired.push({ flowId, scheduleId: s.id, started: true, runId: this.#runs.start(flowId, { version, params: s.params, trigger: "schedule" }) });
        } catch (e) {
          const why = e instanceof StoreError ? [e.message, ...explainProblems(e.problems).map(problemLine)].join(" · ") : e instanceof Error ? e.message : String(e);
          fired.push({ flowId, scheduleId: s.id, started: false, runId: this.#runs.recordRejected(flowId, version, "schedule", s.params, `${tag} — 시작하지 못했습니다: ${why}`) });
        }
      }
    }
    return fired;
  }
}

// ─── 웹훅 토큰 ────────────────────────────────────────────────────────

/** 새 토큰 — 이 함수가 돌려준 것이 사람이 보는 유일한 순간이다 */
export function issueWebhookToken(store: Store, flowId: string): { token: string; createdAt: string } {
  const token = newToken("fsk_");
  return { token, createdAt: store.setWebhook(flowId, hashToken(token)) };
}

/** 맞는 토큰인가 — 시간으로 새지 않게 같은 길이를 견준다 */
export function checkWebhookToken(store: Store, flowId: string, token: string): "ok" | "off" | "bad" {
  const w = store.getWebhook(flowId);
  if (!w) return "off";
  return sameSecret(w.tokenHash, hashToken(token)) ? "ok" : "bad";
}
