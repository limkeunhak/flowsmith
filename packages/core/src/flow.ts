/**
 * 플로우 매니페스트의 모양 — 플로우 · 실행 입력 · 시크릿 · 설정 · 노드 공통 · 엣지 (PLAN §3).
 * 노드 종류마다의 설정은 nodes/*.ts에 있다.
 *
 * ★이 타입은 `parseFlow`를 통과한 값에만 붙는다. 밖에서 들어온 JSON에 `as Flow`로 붙이지 않는다 —
 *  검문소는 하나다.
 */

import type { WebConfig } from "./nodes/web.ts";
import type { ConditionConfig } from "./nodes/condition.ts";
import type { CustomConfig } from "./nodes/custom.ts";
import type { ExtensionConfig } from "./nodes/extension.ts";
import type { FileReadConfig, StoreConfig } from "./nodes/file.ts";
import type { ZipConfig } from "./nodes/zip.ts";
import type { FlowCallConfig } from "./nodes/flow-call.ts";
import type { HttpConfig } from "./nodes/http.ts";
import type { TransformConfig } from "./nodes/transform.ts";
import type { ApprovalConfig } from "./nodes/approval.ts";
import type { CheckConfig } from "./nodes/check.ts";
import type { WalletSettings } from "./wallet.ts";
import type { NotifyRule } from "./notify.ts";

export const SCHEMA_VERSION = 1 as const;

export interface Flow {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description: string;
  /** 실행할 때 받는 입력 — 수동 실행 폼 · 웹훅 본문. `{{ $params.x }}` */
  params: ParamDef[];
  nodes: FlowNode[];
  edges: Edge[];
  /** 플로우 전용 환경변수. 평문이고 화면에 보인다. `{{ $vars.x }}` */
  vars: Record<string, string>;
  /** 시크릿의 **이름과 종류만**. 값은 여기 없다. `{{ $secrets.x }}` · `{{ $secrets.x.password }}` */
  secrets: SecretDef[];
  settings: FlowSettings;
  /** 캔버스 메모(n8n의 Sticky Note) — 사람에게 보이는 설명뿐, 실행과 상관없다 */
  notes: FlowNote[];
  /**
   * **팀 공용 변수**를 쓴다 — 이름만. 값은 팀(없으면 «모두 공용»)에 있고, 돌릴 때 서버가 `$vars`에 채운다.
   * 같은 이름을 이 플로우의 변수(vars)에도 두면 검문소가 막는다(어느 값인지 헷갈리게 하지 않는다)
   */
  sharedVars: string[];
}

export const NOTE_COLORS = ["yellow", "blue", "green", "pink", "gray"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface FlowNote {
  id: string;
  text: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  color: NoteColor;
}

/** 실행 입력의 종류 — 글자 · 숫자 · 날짜(YYYY-MM-DD) · 고르기(보기 중 하나) */
export const PARAM_TYPES = ["text", "number", "date", "select"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export interface ParamDef {
  name: string;
  label: string;
  required: boolean;
  /** 종류 — 실행 전에 맞는지 본다(Jenkins의 매개변수처럼). 없으면 글자 */
  type: ParamType;
  /** 고르기의 보기들 */
  options: string[];
  /** 비워 두고 돌리면 이 값 — 일정 · 웹훅 · 실행 폼이 같이 쓴다 */
  default: string;
  /** 사람에게 보일 한 줄 설명(실행 폼 · 실행 창) */
  help: string;
}

/** 값이 그 입력의 종류에 맞나 — 맞으면 null, 아니면 사람 말 한 줄 */
export function paramProblem(p: Pick<ParamDef, "type" | "options">, v: string): string | null {
  const s = v.trim();
  switch (p.type) {
    case "text": return null;
    case "number": return s !== "" && Number.isFinite(Number(s.replace(/,/g, ""))) ? null : `숫자가 아닙니다("${v}")`;
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `날짜는 2026-10-18처럼 적습니다("${v}")`;
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? null : `없는 날짜입니다("${v}")`;
    }
    case "select": return p.options.includes(s) ? null : `보기(${p.options.join(" · ")}) 중 하나여야 합니다("${v}")`;
  }
}

/** 비어 있는 입력은 기본값으로 — 돌리기 전에 한 번(서버 · 엔진 · 실행 폼이 같은 규칙) */
export function withParamDefaults(defs: readonly ParamDef[], given: Record<string, string>): Record<string, string> {
  const out = { ...given };
  for (const p of defs) if ((out[p.name] ?? "").trim() === "" && p.default !== "") out[p.name] = p.default;
  return out;
}

export const SECRET_KINDS = ["text", "login"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** 종류마다 꺼낼 수 있는 칸. `text`는 칸 없이 `$secrets.x`로 쓴다. */
export const SECRET_PARTS: Record<SecretKind, readonly string[]> = {
  text: [],
  login: ["username", "password", "extra"],
};

export interface SecretDef {
  name: string;
  kind: SecretKind;
  description: string;
  /**
   * **팀 공용 값을 쓴다** — 값은 이 플로우가 아니라 팀(없으면 «모두 공용»)에 있다. 포털 비밀번호를 바꿀 때 한 곳만 고친다.
   * 이름 · 종류는 여기서 정한다(검문소가 «정의된 시크릿만» 보게)
   */
  shared: boolean;
}

export interface FlowSettings {
  /**
   * 금지 버튼 — 누를 요소의 글자가 이 정규식 중 하나에 걸리면 클릭을 거부한다.
   * 웹페이지 노드의 클릭이 통과해야 한다.
   * ★커스텀 노드는 날 Playwright `page`를 받으므로 이 가드 밖이다(PLAN 결정 4).
   */
  forbiddenLabels: string[];
  /** 동작 하나의 기본 타임아웃 */
  defaultTimeoutMs: number;
  /** 변경 감시 주기(분). null이면 감시하지 않는다 */
  monitorIntervalMin: number | null;
  /** 점검 실행 때 쓰는 입력값 (PLAN §6) */
  probeParams: Record<string, string>;
  /**
   * 어느 브라우저에서 도나 (PLAN 결정 2 · 2026-10-15).
   *   launch — 실행기가 자기 브라우저를 띄운다(기본)
   *   attach — **사람이 로그인한 크롬**에 CDP로 붙는다. 보안 프로그램 · OTP 사이트용.
   *            ★사람의 브라우저 · 탭은 닫지 않는다. 붙을 주소는 워커 설정(FLOWSMITH_CDP_URL)이다
   *   wallet — **지갑 브라우저**(PLAN §44): 진짜 MetaMask를 실은 크롬 · 창이 있어야 한다(settings.wallet.mode = metamask).
   *            지갑마다 프로필 하나를 워커가 계속 쓴다 — 같은 지갑으로는 한 번에 하나만 돈다
   *   app    — **앱 안 브라우저**(PLAN §44 · DESKTOP.md §4): 데스크톱 앱의 WebContentsView. 실행마다 뷰 하나(쿠키가 새지 않게 따로 세션) ·
   *            사람이 그 창을 바로 만진다(사람 기다리기 · 녹화). 데스크톱 앱의 워커만 받는다
   */
  browser: BrowserMode;
  /**
   * 일정 트리거(M6) — ★**게시된 버전의 것만** 돈다. 일정마다 넣을 실행 입력을 함께 적는다.
   */
  schedules: Schedule[];
  /**
   * 실패하면 다시 — 웹페이지 동작이 시간 초과 · 못 찾음 같은 일시적 실패로 멈추면 몇 번 더 해 보나(0~5).
   * ★«되돌릴 수 있는» 동작만. 동작마다 따로 정할 수 있다
   */
  retries: number;
  /** 다시 해 보기 전에 쉬는 시간 */
  retryDelayMs: number;
  /**
   * **동작 사이 쉬기** — 웹페이지 동작 하나를 마칠 때마다 minMs~maxMs 사이에서 무작위로 쉰다(사람이 하는 빠르기 · 사이트에 무리를 주지 않게).
   * 둘 다 0이면 쉬지 않는다. 건너뛴 동작(조건 · 있을 때만) 뒤와 점검 실행은 쉬지 않는다
   */
  actionPause: { minMs: number; maxMs: number };
  /** 실행 전체 시간 제한(분) — 넘으면 멈춘다. null이면 없음 */
  runTimeoutMin: number | null;
  /** 알림 — 언제 · 어디로 (notify.ts). ★게시된 버전의 실행만 */
  notify: NotifyRule[];
  /**
   * **다른 플로우가 끝나면 실행**(Jenkins upstream · Airflow Dataset) — 그 플로우의 게시된 버전이 성공(또는 실패)하면 이 플로우의 게시된 버전을 돌린다.
   * params — 실행 입력 이름 → 표현식(`{{ $input.x }}` = 앞 플로우의 결과)
   */
  after: AfterTrigger[];
  /**
   * **파일이 생기면 실행**(Airflow Sensor) — 공유 폴더(files/shared/<dir>)에 이름이 맞는 새 파일이 들어오면 게시된 버전을 돌린다.
   * 다 써질 때까지 기다린다(크기가 두 번 같을 때). 켜기 전에 있던 파일로는 돌지 않는다
   */
  fileTriggers: FileTrigger[];
  /**
   * **자원 잠금**(Jenkins Lockable Resources · Airflow Pools) — 같은 이름을 쓰는 실행은 서버 전체에서 한 번에 하나만 돈다.
   * 예: «쇼핑몰 관리자 계정A» — 같은 계정으로 두 실행이 동시에 로그인하면 서로 세션을 끊는다. 플로우가 달라도 이름이 같으면 줄을 선다
   */
  locks: string[];
  /** 테스트 지갑 — 블록체인 사이트를 메타마스크 없이(wallet.ts). 없으면 null */
  wallet: WalletSettings | null;
}

export interface AfterTrigger {
  id: string;
  /** 앞 플로우 */
  flowId: string;
  /** 언제 — 성공 · 실패(둘 다 고를 수 있다) */
  on: ("success" | "failure")[];
  /** 실행 입력 이름 → 표현식 — `$input`은 앞 플로우의 결과 · `$vars`만 쓸 수 있다 */
  params: Record<string, string>;
  enabled: boolean;
}

export interface FileTrigger {
  id: string;
  /** 공유 폴더 안의 폴더 — 「inbox」(비우면 공유 폴더 바로 아래) */
  dir: string;
  /** 파일 이름 — `*.xlsx` · `주문_*.csv`(* · ? 만) */
  pattern: string;
  /** 새 파일의 이름을 받을 실행 입력 — 없으면 null */
  param: string | null;
  enabled: boolean;
}

export interface Schedule {
  id: string;
  /** 분 시 일 월 요일 — 「0 9 * * 1-5」 */
  cron: string;
  params: Record<string, string>;
  enabled: boolean;
}

export const BROWSER_MODES = ["launch", "attach", "wallet", "app"] as const;
export type BrowserMode = (typeof BROWSER_MODES)[number];

// ─── 노드 ──────────────────────────────────────────────────────────

export const NODE_TYPES = ["web", "condition", "custom", "extension", "fileWrite", "fileRead", "flowCall", "http", "transform", "approval", "check", "zip"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface NodeBase {
  id: string;
  name: string;
  /** 캔버스 위치. 실행과 무관하다 */
  position: { x: number; y: number };
}

export interface WebNode extends NodeBase {
  type: "web";
  config: WebConfig;
}

export interface ConditionNode extends NodeBase {
  type: "condition";
  config: ConditionConfig;
}

export interface CustomNode extends NodeBase {
  type: "custom";
  config: CustomConfig;
}

export interface ExtensionNode extends NodeBase {
  type: "extension";
  config: ExtensionConfig;
}

/** 파일 쓰기 — 앞에서 모은 것을 파일에 쓴다 (nodes/file.ts) */
export interface FileWriteNode extends NodeBase {
  type: "fileWrite";
  config: StoreConfig;
}

/** 압축 — 폴더의 파일들을 zip 하나로 (nodes/zip.ts) */
export interface ZipNode extends NodeBase {
  type: "zip";
  config: ZipConfig;
}

/** 파일 읽기 — 파일 쓰기 노드가 쓴 것을 읽는다 (nodes/file.ts) */
export interface FileReadNode extends NodeBase {
  type: "fileRead";
  config: FileReadConfig;
}

/** 다른 플로우 실행 — 행마다(또는 한 번) 다른 플로우를 돌린다 */
export interface FlowCallNode extends NodeBase {
  type: "flowCall";
  config: FlowCallConfig;
}

/** HTTP 요청 — 다른 시스템의 API를 부른다 (nodes/http.ts) */
export interface HttpNode extends NodeBase {
  type: "http";
  config: HttpConfig;
}

/** 값 다듬기 — 코드 없이 목록을 다듬는다 (nodes/transform.ts) */
export interface TransformNode extends NodeBase {
  type: "transform";
  config: TransformConfig;
}

/** 승인 기다리기 — 사람이 승인해야 이어 간다 (nodes/approval.ts) */
export interface ApprovalNode extends NodeBase {
  type: "approval";
  config: ApprovalConfig;
}

/** 검사 — 값이 기대대로인지 항목마다 본다(웹 e2e 테스트, nodes/check.ts) */
export interface CheckNode extends NodeBase {
  type: "check";
  config: CheckConfig;
}
export type FlowNode = WebNode | ConditionNode | CustomNode | ExtensionNode | FileWriteNode | FileReadNode | FlowCallNode | HttpNode | TransformNode | ApprovalNode | CheckNode | ZipNode;

/** 출력 포트 이름. 조건 노드는 갈래 id와 `else`, 나머지는 `out` 하나. */
export const OUT_PORT = "out";
export const ELSE_PORT = "else";
/**
 * **막힘** 갈래 — 웹페이지 노드의 «고르면 안 되는 행»(행 고르기의 refuse)에 걸렸을 때 가는 출력.
 * 이어 두면 실행이 그쪽으로 이어 가고 «막힘»으로 끝난다 · 잇지 않으면 지금처럼 그 노드가 실패한다
 */
export const BLOCKED_PORT = "blocked";
/** 막힘 갈래로 가는 값 — 받은 값 그대로 + 막힌 까닭 */
export const BLOCKED_OUTPUTS = ["blockedReason"] as const;

export interface Edge {
  id: string;
  from: { node: string; port: string };
  to: { node: string };
}
