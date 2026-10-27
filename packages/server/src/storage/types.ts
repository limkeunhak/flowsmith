/**
 * 저장소가 주고받는 모양 — 서버의 길 · 실행 관리 · 시험이 함께 쓴다(store.ts가 다시 내보낸다).
 */

export class StoreError extends Error {
  readonly status: number;
  readonly problems: readonly string[];
  constructor(status: number, message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "StoreError";
    this.status = status;
    this.problems = problems;
  }
}

export interface FlowSummary {
  id: string;
  name: string;
  activeVersion: number | null;
  latestVersion: number | null;
  problems: number;
  /** 초안 설명의 첫 줄(200자까지) — 목록이 이름 밑에 보인다 */
  description: string;
  updatedAt: string;
  /** 마지막 변경 감시 — 없으면 null */
  monitor: { status: ProbeRow["status"]; at: string; source: ProbeRow["source"] } | null;
  /** 초안에 쓰인 노드 종류(나온 차례) — 목록의 작은 아이콘 */
  nodeTypes: string[];
  /** 켜 둔 일정(cron) — 초안 기준 */
  schedules: string[];
  /** 마지막으로 끝난 실행 */
  lastRun: { status: RunRow["status"]; at: string } | null;
  /** 속한 팀 — null이면 공용 */
  team: { id: string; name: string } | null;
  /** 어디서 도나 — null 서버 · 「worker:<id>」 · 「label:<라벨>」 */
  runOn: string | null;
  /** 직접 지정한 화면 — 자동(area)이 틀릴 때만(null이면 자동). 초안 밖에 있다 */
  group: string | null;
  /** 어느 화면 — 화면 규칙(주소 앞부분)으로 자동(storage/areas.ts). 규칙에 없으면 호스트 · 주소가 없으면 null */
  area: string | null;
  /** area를 그렇게 본 주소(«qa.msu.io/navigator») — 화면 규칙 제안 · 툴팁 */
  site: string | null;
}

export interface ProbeRow {
  id: string;
  flowId: string;
  version: number | null;
  source: "probe" | "run";
  status: "running" | "ok" | "changed" | "broken" | "error";
  at: string;
  report: unknown;
}

export interface NoticeRow {
  id: string;
  flowId: string;
  ruleId: string;
  event: string;
  channel: string;
  refId: string | null;
  ok: boolean;
  status: number | null;
  error: string;
  at: string;
}

export interface FlowDetail {
  id: string;
  name: string;
  draft: unknown;
  problems: string[];
  activeVersion: number | null;
  /** 마지막으로 게시하거나 내린 때 · 사람(메일) — 옛 기록이면 null */
  deployedAt: string | null;
  deployedBy: string | null;
  /** 바뀌지 않는 이름 — 저장 노드의 폴더 */
  uid: string;
  /** plugins — 그 버전을 만들 때의 확장 플러그인 버전(id → 버전) */
  versions: { version: number; note: string; createdAt: string; createdBy: string | null; plugins: Record<string, string> }[];
  /** 초안을 마지막으로 고친 사람(메일) */
  updatedBy: string | null;
  /** 속한 팀 — null이면 공용 */
  team: { id: string; name: string } | null;
  /** 어디서 도나 — null 서버 · 「worker:<id>」 · 「label:<라벨>」 */
  runOn: string | null;
  group: string | null;
  /** 고정된 출력 — 노드 id → 출력(초안 시험에서 그 노드는 돌지 않고 이 값을 쓴다) */
  pins: Record<string, Record<string, unknown>>;
  /** 초안이 마지막 버전과 다른가 — 「버전 만들기」 단추를 켤지 */
  draftChanged: boolean;
  createdAt: string;
  updatedAt: string;
}

/** flow — 다른 플로우의 «다른 플로우 실행» 노드가 불렀다 */
export type RunTrigger = "manual" | "api" | "schedule" | "webhook" | "flow" | "after" | "file" | "suite";

/** 게시된 버전 — GET /api/flows/:id/published */
export interface PublishedFlow {
  flowId: string;
  uid: string;
  version: number;
  note: string;
  createdAt: string;
  createdBy: string | null;
  deployedAt: string | null;
  deployedBy: string | null;
  /** 검문소를 통과한 매니페스트 */
  manifest: unknown;
}

export interface RunRow {
  id: string;
  flowId: string;
  version: number | null;
  trigger: RunTrigger;
  status: "running" | "success" | "failure" | "cancelled" | "blocked";
  message: string;
  params: Record<string, string>;
  result: unknown;
  startedAt: string;
  ms: number | null;
  /** 다른 플로우가 불렀으면 부른 실행 */
  parentRunId: string | null;
  /** 손으로 · API로 돌린 사람(메일) — 일정 · 웹훅 · 다른 플로우는 null */
  startedBy: string | null;
  /** 어디서 돌았나 — 워커 이름(그때의). null이면 서버 */
  ranOn: string | null;
}

/** 대시보드가 쓰는 실행 · 노드 요약(run/stats.ts) */
export interface StatNode { id: string; name: string; type: string; status: string; ms: number; failure: string | null }
export interface StatRun {
  id: string; flowId: string; status: "running" | "success" | "failure" | "cancelled" | "blocked"; trigger: string;
  startedAt: string; ms: number | null; ranOn: string | null; parentRunId: string | null; message: string;
  version: number | null; startedBy: string | null; nodes: StatNode[];
}

/** plugins · pluginErrors — 서버가 나눠 준 플러그인을 그 PC가 실은 버전 · 못 실은 까닭(PLAN §41) */
/** capabilities — 할 수 있는 일(wallet: 지갑 브라우저 · PLAN §44) */
export interface WorkerInfo { host: string; version: string; extensions: string[]; capabilities?: string[]; plugins?: Record<string, string>; pluginErrors?: Record<string, string> }

export interface WorkerRow {
  id: string;
  name: string;
  labels: string[];
  /** 동시에 도는 실행 수 */
  slots: number;
  /** 이 팀(과 공용) 플로우만 — null이면 모든 팀 */
  team: { id: string; name: string } | null;
  /** false = 잠시 끔 */
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  info: WorkerInfo | null;
  /** 이 워커에서 돌게 정해 둔 플로우 수 */
  flows: number;
  /**
   * 공용 워커(shared) — 누구의 실행이든 · 일정 · 웹훅을 받는다(도커 · 서버실 PC).
   * 개인 워커(personal) — **주인이 «내 PC에서 실행하기»로 돌린 실행만** 받는다(데스크톱 앱). 워크플로우의 «어디서 돌리나» · 라벨로는 고를 수 없다
   */
  kind: WorkerKind;
  /** 개인 워커의 주인(메일) — 공용이면 null */
  owner: string | null;
}

export const WORKER_KINDS = ["shared", "personal"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export interface TeamRow {
  id: string;
  name: string;
  createdAt: string;
  /** 사람 id들 */
  members: string[];
  /** 이 팀의 플로우 수 */
  flows: number;
}

/** API 토큰 — ★토큰 값은 없다(만들 때 한 번만 준다) */
export interface ApiTokenRow {
  id: string;
  userId: string;
  name: string;
  role: UserRole;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export const USER_ROLES =["admin", "editor", "runner", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  disabled: boolean;
  mustChange: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
