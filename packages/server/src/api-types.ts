/**
 * **API가 주고받는 모양 — 타입만** (`@flowsmith/server/api-types`). 편집 화면(브라우저)이 가져다 쓴다.
 * ★여기와 여기서 가져오는 파일(storage/types.ts · run/stats.ts)은 node: 모듈을 쓰지 않는다 — 브라우저에서도 타입 검사가 된다.
 *  서버의 몸(store.ts · SQLite)을 끌어오지 않게 이 길로만 내보낸다(recorder/protocol과 같은 꼴).
 */
import type { WorkerRow } from "./storage/types.ts";

export type {
  FlowSummary, FlowDetail, PublishedFlow, ProbeRow, NoticeRow, RunRow, RunTrigger, StatNode, StatRun,
  WorkerInfo, WorkerRow, TeamRow, UserRole, UserRow, ApiTokenRow,
} from "./storage/types.ts";
export type { Dashboard } from "./run/stats.ts";
export type { AreaRule } from "./storage/areas.ts";
export type { Suite, SuiteItem, SuiteRun, SuiteRunItem, SuiteSchedule, SuiteNotifyRule, SuiteRunStatus } from "./storage/suites.ts";

/** 워커 화면이 보는 지금 상태(run/worker-hub.ts) */
export interface WorkerLive {
  online: boolean;
  connectedAt: string | null;
  running: { runId: string; flowId: string; flowName: string }[];
  /** 이 워커로 갈 수 있는 줄 선 실행 */
  queued: number;
  /** 지금 열린 녹화 수 */
  recording: number;
}

/** GET /api/workers */
export interface WorkersView {
  /** 서버(내장) — 지금 도는 수 · 한도 · 기다리는 수 */
  server: { active: number; max: number; waiting: number };
  workers: (WorkerRow & WorkerLive)[];
  labels: string[];
}

/** 확장 플러그인(run/plugins.ts · PLAN §41) — GET /api/plugins */
export interface PluginVersionView { version: string; sha256: string; signer: string | null; size: number; source: string; installedAt: string; installedBy: string | null; builtAt: string | null }
export interface PluginView {
  id: string;
  name: string;
  description: string;
  /** 지금 쓰는 버전 */
  version: string;
  enabled: boolean;
  nodes: { id: string; title: string }[];
  signer: string | null;
  /** 불러졌나 — 켜 두었는데 못 불렀으면 error */
  loaded: boolean;
  error: string | null;
  changedAt: string;
  changedBy: string | null;
  versions: PluginVersionView[];
}
export interface PluginEventView { at: string; action: string; plugin: string; version: string | null; by: string | null; note: string }
export interface PluginsView {
  signing: { required: boolean; keys: { name: string; fingerprint: string }[] };
  source: string | null;
  builtIn: { id: string; title: string }[];
  plugins: PluginView[];
  events: PluginEventView[];
}
/** 사내 저장소의 묶음 하나 — 깔려 있나(installed: 지금 버전) · 이 버전이 있나(have) · 더 새것인가(newer) */
export interface PluginSourceEntry { id: string; name: string; version: string; description: string; nodes: string[]; signer: string | null; size: number; installed: string | null; have: boolean; newer: boolean }
