/**
 * **웹페이지 노드** — 시작(주소 · 이어서 · 사람의 탭)과 동작들, 요소를 가리키는 위치(Target) (PLAN §3.4).
 */
import type { Rule } from "./condition.ts";

export interface WebConfig {
  /**
   * url: 이 주소로 가서 시작한다 · continue: 앞 웹페이지 노드가 머문 페이지에서 이어서
   * tab: **사람이 열어 둔 탭** 중 주소에 이 글자가 든 것에서 시작한다(attach 전용) — 주소를 옮기지 않는다.
   *      WebSquare처럼 페이지를 옮기면 껍데기가 날아가는 사이트가 있다
   */
  start: { kind: "url"; url: string } | { kind: "continue" } | { kind: "tab"; match: string };
  actions: WebAction[];
}

export const LOCATOR_KINDS = ["testid", "role", "label", "placeholder", "text", "css", "xpath"] as const;
export type LocatorKind = (typeof LOCATOR_KINDS)[number];

export interface Locator {
  kind: LocatorKind;
  value: string;
  /** role일 때 접근성 이름 */
  name?: string;
}

/** 녹화 때 요소의 모습. 변경 감시가 지금 요소와 비교한다 (PLAN §6) */
export interface Fingerprint {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  nearText: string;
}

export interface Target {
  /** 사람 말 — "'로그인' 버튼" */
  label: string;
  /** ★실행은 locators[0]만 쓴다. 정확히 하나를 가리켜야 한다 — 나머지는 진단용(결정 3) */
  locators: Locator[];
  fingerprint: Fingerprint | null;
  /** iframe 경로 — 바깥부터 차례로 iframe을 가리키는 css */
  frames: string[];
  verifiedAt: string | null;
}

export const RISKS = ["safe", "unsafe"] as const;
export type Risk = (typeof RISKS)[number];

export const READ_STRATEGIES = ["auto", "value", "text", "innerText", "checked", "attribute", "selected", "link"] as const;
export type ReadStrategy = (typeof READ_STRATEGIES)[number];

export const WAIT_KINDS = ["fixed", "visible", "hidden", "url", "networkIdle", "filled", "stable", "changed"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

/**
 * «값이 그대로일 때까지»의 조용한 시간 — 기본 2초 · 0.3~30초.
 * NexusFlow 실측(2026-08-18)에서 채우는 도중 멎는 틈이 최대 1초 남짓이었다. 그보다 넉넉하게 잡는다
 */
export const STABLE_WAIT = { defaultMs: 2_000, minMs: 300, maxMs: 30_000 } as const;

/**
 * «보일 때까지» · «사라질 때까지»를 **새로고침하며** — 다른 실행 · 다른 사람이 바꾼 것이 이 화면에 저절로 오지 않는 곳
 * (다른 지갑이 올린 매물 · 거래 정산). 이 간격마다 다시 읽는다 · 2초~10분
 */
export const RELOAD_WAIT = { minMs: 2_000, maxMs: 600_000 } as const;

export type Wait =
  | { kind: "fixed"; ms: number }
  | { kind: "visible"; target: Target; reloadEveryMs?: number }
  | { kind: "hidden"; target: Target; reloadEveryMs?: number }
  | { kind: "url"; pattern: string }
  | { kind: "networkIdle" }
  /** 칸 · 요소에 값이 찰 때까지 — 조회 뒤 결과가 늦게 채워지는 화면 */
  | { kind: "filled"; target: Target }
  /**
   * 값이 ms 동안 그대로일 때까지 — 두 번 바뀌는 칸(금액 · 조회 결과).
   * ★«찼다»와 «다 됐다»는 다르다. 중간값도 비어 있지 않고 그럴듯하다. 빈 값은 그대로여도 끝으로 치지 않는다
   */
  | { kind: "stable"; target: Target; ms: number }
  /**
   * 값이 **바로 앞 동작 직전**과 달라질 때까지, 달라지면 다시 그대로일 때까지 — 같은 화면에서 조회를 다시 하는 곳.
   * 앞 결과가 남아 있으면 «찼다» · «보인다»는 곧바로 통과해 묵은 값을 읽는다.
   * ★시간이 다 돼도 안 바뀌면 멈추지 않고 이어 간다(두 결과가 정말 같을 수 있다). 그 사실은 실행 기록에 남긴다
   */
  | { kind: "changed"; target: Target };

interface ActionBase {
  id: string;
  /** 되돌릴 수 없는 동작이면 unsafe — 점검 실행이 누르지 않는다 */
  risk: Risk;
  timeoutMs: number | null;
  /**
   * «있을 때만» — 요소를 잠깐(2초) 찾아보고 없으면 건너뛴다. 처음 들어올 때만 뜨는 안내창 닫기 같은 것.
   * ★«없음»을 성공으로 넘기는 자리라 꼭 필요한 동작에는 켜지 않는다
   */
  optional: boolean;
  /** 실패하면 다시 — 없으면 플로우 설정을 따른다. 되돌릴 수 없는 동작은 다시 하지 않는다 */
  retries?: number;
  /**
   * «조건이 맞을 때만» — 조건 노드의 규칙 하나. 안 맞으면 건너뛴다(선물 포장이 「있음」일 때만 체크 같은 것).
   * 없으면 늘 한다
   */
  when?: Rule;
}

/**
 * «사람 기다리기»가 끝났다는 표시 — 로그인 화면이 사라지면 · 이 요소가 보이면 · 주소가 이렇게 되면
 * (기다리기의 일부만 — 「고정 시간」 · 「네트워크 조용」은 사람이 끝냈다는 뜻이 아니다)
 */
export type HumanDone = Extract<Wait, { kind: "hidden" | "visible" | "url" }>;
export const HUMAN_DONE_KINDS = ["hidden", "visible", "url"] as const;
/** 사람을 기다리는 시간 — 기본 5분 · 10초~30분 */
export const HUMAN_TIMEOUT = { defaultMs: 5 * 60_000, minMs: 10_000, maxMs: 30 * 60_000 } as const;

/**
 * **누르면 뜨는 브라우저 확인창**(alert · confirm)에 답하기 — 등록 · 삭제 앞의 «정말 하시겠습니까?» 같은 것.
 *   accept  참이면 «확인», 거짓이면 «취소»
 *   expect  확인창 문구에 들어 있어야 할 글자 — 다르면 «취소»로 닫고 **멈춘다**(다른 경고 알림을 등록 확인으로 넘기지 않게). 비우면 보지 않는다
 * ★확인창이 뜨지 않으면 멈춘다. 이 칸이 없는 누르기에서 뜬 확인창은 브라우저 기본대로 «취소»로 닫힌다(Playwright)
 */
export interface DialogAnswer {
  accept: boolean;
  expect: string;
}

/** 읽은 글자를 바꾸는 법 — number: 숫자 · 부호 · 소수점만 남겨 숫자로(「651,170원」→ 651170) */
export const READ_TRANSFORMS = ["number"] as const;
export type ReadTransform = (typeof READ_TRANSFORMS)[number];

export type WebAction =
  | (ActionBase & { kind: "goto"; url: string })
  | (ActionBase & { kind: "click"; target: Target; popup: boolean; dialog?: DialogAnswer })
  | (ActionBase & { kind: "fill"; target: Target; value: string })
  | (ActionBase & { kind: "select"; target: Target; value: string })
  | (ActionBase & { kind: "check"; target: Target; checked: boolean })
  | (ActionBase & { kind: "press"; target: Target | null; key: string })
  | (ActionBase & { kind: "wait"; wait: Wait })
  | (ActionBase & { kind: "read"; target: Target; output: string; strategy: ReadStrategy; attribute: string | null; transform: ReadTransform | null })
  | (ActionBase & { kind: "readTable"; table: TableTarget; output: string })
  /** 팝업 창을 닫고 연 창으로 돌아간다(닫기 단추가 없을 때) */
  | (ActionBase & { kind: "closeWindow" })
  /**
   * **새 창으로 옮기기** — 누르기와 바로 이어지지 않고 열리는 창(확인창에 답한 뒤 열리는 창 · 늦게 열리는 창)으로 옮겨 간다.
   * 지금 창이 연 창 중 아직 옮겨 가지 않은 가장 최근 것을 시간 제한까지 기다린다. 닫히면 연 창으로 돌아온다(누르기의 팝업과 같다)
   */
  | (ActionBase & { kind: "switchWindow" })
  /**
   * **넣은 칸 다시 확인** — 이 노드에서 지금 창에 넣고 · 고르고 · 켠 칸을 다시 읽는다. 지워졌거나 바뀐 칸은 한 번만 다시 넣고,
   * 그래도 안 맞으면 멈춘다. 늦게 온 조회 응답이 이미 넣은 칸을 지우는 화면에서, 제출 · 계산 단추 바로 앞에 둔다
   */
  | (ActionBase & { kind: "recheck" })
  /** 표에서 키 열이 그 값인 행을 찾아 누른다 — 행 번호가 아니라 값으로 찾는다 */
  | (ActionBase & { kind: "pickRow"; pick: RowPick })
  /** 확인 — 화면의 값이 기대와 다르면 **멈춘다**(신원 대조: 다른 고객의 화면이면 더 가지 않는다) */
  | (ActionBase & { kind: "assert"; target: Target; strategy: ReadStrategy; equals: string })
  /**
   * **사람 기다리기** — 로그인 · 본인 인증처럼 사람이 직접 해야 하는 일. 실행이 멈춰 기다리고, 끝났다는 표시가 오면 이어 간다.
   *   appears  이 요소가 보일 때만 기다린다(로그인 화면일 때만) — 없으면 건너뛴다. null이면 늘 기다린다
   *   done     끝났다는 표시. 처음부터 맞으면(이미 로그인됨) 기다리지 않는다
   *   timeoutMs 기다리는 시간(ActionBase) — 없으면 5분. 넘으면 실패
   * ★사람이 넣은 것(아이디 · 비밀번호)은 녹화하지도 기록하지도 않는다. 점검 실행은 이 동작 앞에서 멈춘다
   */
  | (ActionBase & { kind: "human"; prompt: string; appears: Target | null; done: HumanDone })
  /**
   * **MetaMask 승인**(PLAN §44) — 지갑 브라우저(browser: "wallet")에서. MetaMask 화면(새 창이든 열린 탭 안이든)을 읽고
   * 누를 만한 것(core approvalDecision)만 누르며, 끝났다는 표시(done — 로그인 뒤에만 보이는 것)가 오면 멈춘다.
   *   timeoutMs 기다리는 시간(ActionBase) — 없으면 2분. 넘으면 실패
   * 처음부터 끝 표시가 맞으면(이미 연결됨) 아무것도 누르지 않는다. 점검 실행은 이 동작 앞에서 멈춘다
   *   atLeast  적어도 몇 개를 승인해야 끝으로 치나(1~10) — 구매 · 등록처럼 **지갑이 꼭 불려야 하는** 자리.
   *            누른 단추가 처리 중 모양으로 바뀌면 «사라짐» 끝 표시가 지갑 요청 전에 맞아 버린다(그대로 끝내면 요청이 버려진다)
   */
  | (ActionBase & { kind: "walletApprove"; done: HumanDone; atLeast?: number });

export const ACTION_KINDS = ["goto", "click", "fill", "select", "check", "press", "wait", "read", "readTable", "closeWindow", "switchWindow", "recheck", "pickRow", "assert", "human", "walletApprove"] as const;
/** MetaMask 승인을 기다리는 시간 — 기본 2분 · 10초~10분 */
export const WALLET_APPROVE_TIMEOUT = { defaultMs: 2 * 60_000, minMs: 10_000, maxMs: 10 * 60_000 } as const;
export type ActionKind = WebAction["kind"];

export interface TableTarget {
  label: string;
  /** 행 하나하나를 가리키는 위치 */
  rows: Target;
  /** 행 안에서의 상대 위치(css) */
  columns: TableColumn[];
  maxRows: number;
  /**
   * 빈 표 표시 — 「조회 결과가 없습니다」처럼 행이 없을 때만 보이는 것. 보이면 행을 기다리지 않고 빈 표로 끝낸다
   * (그 문구가 행 모양으로 그려져도 빈 표다). 없으면 행이 안 나올 때 시간 제한까지 기다린 뒤 빈 표로 본다
   */
  empty?: Target;
  /**
   * 스크롤 상자(css, 행과 같은 iframe) — 보이는 행만 그리는 표(가상 스크롤)일 때. 맨 위부터 반 화면씩 내리며 읽고,
   * 앞 묶음과 겹치는 행으로 이어 붙인다. ★겹침이 없으면 행을 건너뛴 것이라 멈춘다. 다 읽으면 스크롤을 원래 자리로 돌린다
   */
  scroll?: string;
}

/**
 * 행을 찾는 방법 — key: 키 칸의 글자가 value인 행(순서가 바뀌어도 같은 건) ·
 * index: value번째 행(1부터 · 음수는 끝에서 — -1은 마지막). 목록의 «n번째 레코드»
 */
export const ROW_PICK_BY = ["key", "index"] as const;
export type RowPickBy = (typeof ROW_PICK_BY)[number];

export interface RowPick {
  label: string;
  /** 행 하나하나를 가리키는 위치(여러 개가 정상) */
  rows: Target;
  /** 찾는 방법 — 없으면 key(옛 매니페스트) */
  by?: RowPickBy;
  /** 키 칸 — 행 안에서의 css · 그 칸의 글자가 value와 같은 행을 고른다(by key만) */
  keyColumn: string;
  keyLabel: string;
  /** 표현식 — key면 찾을 글자「{{ $params.orderNo }}」 · index면 몇 번째「3」「{{ $params.n }}」「-1」 */
  value: string;
  /** 행 안에서 누를 것(css). 비우면 행 자체를 누른다 */
  click: string;
  /** 고르면 안 되는 행 — 이 칸의 글자가 값들 중 하나면 이유를 말하며 멈춘다(「주문확정」) */
  refuse: { column: string; values: string[]; reason: string } | null;
}

export interface TableColumn {
  name: string;
  selector: string;
  strategy: ReadStrategy;
}
