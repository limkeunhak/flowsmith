/**
 * **멈추는 품질** — 실패는 사람이 5분 안에 다시 지정할 수 있게 설명돼야 한다.
 *
 * ★후보는 **붙이기만** 한다. 엔진이 후보로 대신 누르거나 읽지 않는다(결정 3) —
 *  «비슷한 요소를 찾아 대신 읽는» 순간 틀린 값을 성공으로 보고할 수 있다.
 */
import type { Locator } from "@flowsmith/core";

export const PROBLEMS = {
  missing: "요소를 찾지 못했습니다",
  many: "요소가 여러 개입니다 — 어느 것인지 정할 수 없습니다",
  forbidden: "금지 버튼입니다 — 누르지 않았습니다",
  notFilled: "값을 넣었는데 칸에 남지 않았습니다",
  noPage: "이어서 쓸 페이지가 없습니다",
  refused: "고르면 안 되는 행입니다 — 멈췄습니다",
  mismatch: "화면이 기대한 건이 아닙니다 — 멈췄습니다",
  check: "검사가 기대와 다릅니다 — 불통과",
  timeout: "시간 안에 끝나지 않았습니다",
  stopped: "실행을 멈췄습니다",
  other: "실패했습니다",
} as const;

/**
 * 실행을 멈춘다 — 사람이 «멈추기»를 눌렀거나 전체 시간 제한을 넘었다. 노드 실패가 아니다(실행기가 받아 끝낸다)
 */
export class RunStopped extends Error {
  constructor() {
    super(PROBLEMS.stopped);
    this.name = "RunStopped";
  }
}

/** 기다리되 멈추면 바로 깬다 */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok) => {
    if (signal?.aborted) return ok();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener("abort", done); ok(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * 다시 해 볼 만한 실패인가 — 시간 · 일시적 실패 · 못 찾음(늦게 뜬 화면)은 다시, 판단이 정해진 것은 다시 해도 같다:
 * 금지 버튼 · 고르면 안 되는 행 · 기대한 건이 아님 · 여러 개 · 이어 갈 페이지 없음
 */
export function retryable(problem: Problem): boolean {
  return problem === "timeout" || problem === "other" || problem === "missing" || problem === "notFilled";
}
export type Problem = keyof typeof PROBLEMS;

export interface Candidate {
  locator: Locator;
  /** 지금 페이지에서 몇 개를 가리키나 */
  count: number;
}

export interface StepFailure {
  problem: Problem;
  message: string;
  /** 동작 순번(1부터) · id · 종류 */
  action: { index: number; id: string; kind: string } | null;
  /** 사람 말 — "'로그인' 버튼" */
  label: string | null;
  locator: Locator | null;
  url: string | null;
  /** 녹화 때 적어 둔 다른 위치들이 지금 몇 개를 가리키나 — 고르는 건 사람이다 */
  candidates: Candidate[];
}

export class StepError extends Error {
  readonly failure: StepFailure;
  constructor(f: Omit<StepFailure, "action" | "url"> & Partial<Pick<StepFailure, "action" | "url">>) {
    super(f.message);
    this.name = "StepError";
    this.failure = { action: null, url: null, ...f };
  }

  /** 동작 · 주소를 덧붙인 새 오류 — 아래에서 던진 것을 위에서 감쌀 때 */
  with(extra: Partial<Pick<StepFailure, "action" | "url">>): StepError {
    return new StepError({ ...this.failure, ...extra });
  }
}

/** 무엇이 던져졌든 StepFailure로. Playwright 타임아웃은 timeout으로 */
export function toFailure(e: unknown): StepFailure {
  if (e instanceof StepError) return e.failure;
  const message = e instanceof Error ? e.message : String(e);
  const timeout = e instanceof Error && e.name === "TimeoutError";
  return { problem: timeout ? "timeout" : "other", message, action: null, label: null, locator: null, url: null, candidates: [] };
}
