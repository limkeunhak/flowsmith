/**
 * **워커 경계** (PLAN §4.1 · §26) — 서버는 엔진을 이 인터페이스로만 부른다.
 *
 * 구현은 둘: 같은 프로세스(`InProcessWorker`, standalone) · 원격(서버의 WorkerHub가 사람 PC의 워커에 보낸다).
 * 그래서 작업에는 **실행에 필요한 것 전부**가 들어 있다 — 워커는 저장소를 모른다.
 * 실행 중에 서버에 부탁하는 것(다른 플로우 실행 · 파일)은 hooks로 — 원격이면 연결을 타고 서버로 간다.
 */
import type { Page } from "playwright";
import type { Flow, SecretValue } from "@flowsmith/core";
import type { CallFlow, FileOps, RunEvent, RunResult, AskApproval } from "@flowsmith/engine";

export interface RunJob {
  runId: string;
  flow: Flow;
  params: Record<string, string>;
  /** 이 실행에 쓸 시크릿 — 이미 풀린 값. ★워커 밖으로 다시 나가지 않는다(엔진이 결과에서 가린다) */
  secrets: Record<string, SecretValue>;
  /** 점검 실행 — 되돌릴 수 없는 동작 앞에서 멈추고, 요소를 녹화 때와 견준다 */
  probe?: boolean;
  /** 플로우의 바뀌지 않는 이름 — 파일 쓰기 노드가 이 플로우 폴더(files/<uid>)에 쓴다 */
  flowUid?: string;
  /** 파일 읽기가 «다른 플로우의 폴더»를 읽을 때 — 플로우 id → uid */
  flowUids?: Record<string, string>;
  /** 일부만 — 편집 화면의 «앞 단계까지 · 이 단계까지 실행»(초안만) */
  stopBefore?: string;
  stopAfter?: string;
  /** 지갑 브라우저 — 이 지갑의 프로필을 지우고 처음부터 준비한 뒤 돈다(«지갑 다시 준비» · PLAN §44) */
  resetWallet?: boolean;
  /**
   * 어디서 도나 — 없으면 서버. 「worker:<id>」 그 워커 · 「label:<라벨>」 그 라벨이 붙은 워커 중 한 곳.
   * 서버(WorkerHub)가 보고 고른다 — 워커에는 보내지 않는다
   */
  on?: string | null;
  /** 부른 실행 — 같은 워커에서 부모가 돌고 있으면 그 자리를 함께 쓴다(부모가 자리를 쥔 채 자식을 기다리다 막히지 않게) */
  parentRunId?: string | null;
  /** 고정된 출력 — 노드 id → 출력(초안 시험만, 엔진 RunOptions.pins) */
  pins?: Record<string, Record<string, unknown>>;
}

/** 실행 화면의 크기 · 주소(화면 중계 — 원격 워커가 서버로) */
export type ScreenMeta = { t: "page"; url: string; title: string } | { t: "viewport"; width: number; height: number };
/** 실행 화면에서 오는 사람의 손 — 사람 기다리기 동안만(서버가 거른다) */
export type ScreenInput =
  | { t: "mouse"; type: "move" | "down" | "up"; x: number; y: number; button: "left" | "right" | "middle"; clickCount: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; type: "down" | "up"; key: string }
  | { t: "text"; text: string };
/** 원격 워커의 실행 화면 — 서버가 «보는 사람이 있다 · 없다» · 사람의 손을 보낸다 */
export interface ScreenControl { watch(on: boolean): void; input(m: ScreenInput): void }
/** 원격 워커의 실행 화면이 서버로 — 화면 한 장 · 크기 · 주소 */
export interface ScreenSink { frame(jpeg: Buffer): void; meta(m: ScreenMeta): void }

/** 실행 중에 워커가 서버에 부탁하는 것 · 서버가 알고 싶은 것 */
export interface RunHooks {
  /** 다른 플로우 실행 */
  callFlow?: CallFlow;
  /** 파일 — 없으면 워커의 파일 뿌리(디스크). 원격 워커는 서버에 맡긴다(파일은 늘 서버에) */
  fileOps?: FileOps;
  /** 실행의 지금 페이지가 바뀌면 — 실행 화면 보기(RunScreens)가 따라간다. 원격 워커는 그 PC에서 받아 화면을 중계한다(screen-relay.ts) */
  onPage?: (page: Page) => void;
  /** 원격 워커로 간 실행의 화면이 오는 곳(WorkerHub → RunScreens) */
  screen?: ScreenSink;
  /** 멈추기 */
  signal?: AbortSignal;
  /** 승인 기다리기 — 서버가 묻고 답을 기다린다(run/runs.ts). 원격 워커는 서버에 묻는다(ask) */
  approval?: AskApproval;
  /** 워커 자리를 기다린다 — 앞에 몇 개 */
  onQueued?: (ahead: number) => void;
  /** 어디에 갔나 — 워커 이름(서버면 null). 기록에 남긴다 · 원격이면 그 실행 화면을 켜고 끄는 길(screen) */
  onPlaced?: (worker: { id: string; name: string; screen?: ScreenControl } | null) => void;
}

export interface WorkerClient {
  run(job: RunJob, onEvent: (e: RunEvent) => void, hooks?: RunHooks): Promise<RunResult>;
  close(): Promise<void>;
}

/** 엔진이 돌지도 못한 실행의 결과 — 워커가 없다 · 연결이 끊겼다 · 멈췄다 */
export function notRun(job: RunJob, status: "failure" | "cancelled", message: string): RunResult {
  return { runId: job.runId, flowId: job.flow.id, status, message, output: {}, nodes: [], startedAt: new Date().toISOString(), ms: 0 };
}
