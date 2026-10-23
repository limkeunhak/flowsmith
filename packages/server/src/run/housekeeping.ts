/**
 * **기록 정리** — 실행 기록 · 변경 감시 기록 · 일정 발화 기록이 끝없이 쌓이지 않게 (운영 2026-10-16).
 *
 *   실행 기록     플로우마다 최근 keepRuns개만 · keepDays일 지난 것은 지운다(도는 실행은 두고)
 *   감시 기록     플로우마다 최근 keepProbes개만 · keepDays일 지난 것
 *   일정 발화     3일 지난 것(같은 분에 두 번 돌지 않게 하는 데만 쓴다)
 *   보낸 알림     플로우마다 최근 200개 · keepDays일 지난 것
 *
 * ★파일 쓰기 노드의 파일은 여기서 지우지 않는다 — 노드마다 «n일 지난 파일 지우기»(keepDays)로 정한다.
 */
import type { Store } from "../storage/store.ts";

export interface Retention {
  /** 플로우마다 남길 실행 기록 수 — null이면 수로는 지우지 않는다 */
  keepRuns: number | null;
  /** 이보다 오래된 기록은 지운다(일) — null이면 날짜로는 지우지 않는다 */
  keepDays: number | null;
  /** 플로우마다 남길 감시 기록 수 */
  keepProbes: number;
}

export const DEFAULT_RETENTION: Retention = { keepRuns: 500, keepDays: 90, keepProbes: 100 };
const HOUR = 3_600_000;

export class Housekeeper {
  readonly #store: Store;
  readonly retention: Retention;
  #timer: NodeJS.Timeout | null = null;

  constructor(store: Store, retention: Partial<Retention> = {}) {
    this.#store = store;
    this.retention = { ...DEFAULT_RETENTION, ...retention };
  }

  /** 한 번 정리한다 — 지운 수 */
  sweep(now = new Date()): { runs: number; probes: number; fires: number; notices: number } {
    const r = this.retention;
    const before = r.keepDays === null ? null : new Date(now.getTime() - r.keepDays * 24 * HOUR).toISOString();
    return {
      runs: this.#store.pruneRuns(r.keepRuns, before),
      probes: this.#store.pruneProbes(r.keepProbes, before),
      fires: this.#store.pruneScheduleFires(new Date(now.getTime() - 3 * 24 * HOUR).toISOString()),
      notices: this.#store.pruneNotices(200, before),
    };
  }

  start(everyMs = HOUR): void {
    const run = () => {
      try {
        const n = this.sweep();
        if (n.runs + n.probes > 0) console.log(`기록 정리 — 실행 ${n.runs}개 · 감시 ${n.probes}개를 지웠습니다`);
      } catch (e) { console.error("기록 정리 실패:", e); }
    };
    run();
    this.#timer = setInterval(run, everyMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
