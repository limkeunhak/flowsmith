/**
 * 라이브 패널 ↔ 서버 메시지 — **표시 방식과 무관한 약속** (PLAN §4.3).
 *
 * 지금은 WebSocket + CDP screencast(A)로 오간다. Electron(B)로 바꾸면 화면은 WebContentsView가
 * 직접 그리고, 입력 메시지(mouse · key · text)는 필요 없어진다. 나머지(모드 · 녹화된 동작 · 고르기 ·
 * 대화상자)는 그대로다.
 *
 * ★타입만 있다 — 브라우저(apps/studio)가 그대로 가져다 쓴다. 여기에 실행 코드를 두지 않는다.
 */
import type { Flow, RowPick, Target, TableTarget, WebAction } from "@flowsmith/core";

export type RecordMode = "browse" | "record" | "read";

// ─── 화면 → 서버 ───────────────────────────────────────────────────

export interface OpenRequest {
  t: "open";
  flowId: string;
  nodeId: string;
  /** 지금 편집 중인 초안 — 앞 단계 재생에 쓴다 */
  draft: Flow;
  params: Record<string, string>;
  /** 앞 노드들을 재생해 이 노드의 시작 지점까지 간다 */
  replay: boolean;
  /** 이 노드에 이미 있는 동작도 재생한 뒤 이어서 녹화한다 */
  replayExisting: boolean;
  /** 다시 지정 — 이 동작 **바로 앞까지만** 재생한다(그 동작의 요소를 사람이 다시 고른다) */
  stopBeforeAction?: string;
  /** 준비가 끝나면 어느 모드로 시작하나(기본 녹화). ★다시 지정은 «읽기»로 연다 — 녹화 모드인 틈에 누르면 진짜로 눌린다 */
  startMode?: RecordMode;
  /** 라이브 패널 크기(CSS px) */
  viewport: { width: number; height: number };
  /**
   * 어디서 녹화하나 — 없거나 「server」면 서버, 「worker:<id>」면 그 PC의 워커 프로그램(그 PC의 크롬).
   * 사람의 크롬에 붙는 플로우를 사내 서버에서 녹화할 때 (PLAN §28)
   */
  on?: string;
}

export type ClientMessage =
  | OpenRequest
  | { t: "mode"; mode: RecordMode }
  | { t: "mouse"; type: "move" | "down" | "up"; x: number; y: number; button: "left" | "right" | "middle"; clickCount: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; type: "down" | "up"; key: string }
  | { t: "text"; text: string }
  | { t: "nav"; url: string }
  | { t: "back" }
  | { t: "reload" }
  | { t: "resize"; width: number; height: number }
  | { t: "select-choose"; token: string; value: string | null }
  | { t: "dialog"; accept: boolean; text?: string }
  /** 팝업 창을 닫고 연 창으로 돌아간다(녹화 중이면 «창 닫기»로 남는다) */
  | { t: "close-window" };

// ─── 서버 → 화면 ───────────────────────────────────────────────────

export type Phase = "starting" | "replaying" | "ready" | "closed";

/** 녹화된 동작 하나 — 화면이 사람에게 보이고, 「녹화 끝」에서 노드에 넣는다 */
export interface Recorded {
  /** 임시 id — 노드에 넣을 때 다시 짓는다 */
  id: string;
  action: WebAction;
  /** 사람이 더 정해 줘야 하는 것 */
  needs: "secret" | "output" | null;
  /** 읽기에서 표 전체로 바꿀 수 있으면 */
  table: { action: Extract<WebAction, { kind: "readTable" }>; rows: number; /** 표가 아니라 되풀이되는 목록(뉴스 · 검색 결과) */ list?: boolean } | null;
  warnings: string[];
  /** 고른 요소를 사람이 부르는 이름(「'검색' 버튼」) — 읽기는 둘레 글자로 이름을 짓지만, 다시 지정할 때는 이것을 쓴다 */
  humanLabel?: string;
  /** 표의 행 안을 눌렀으면 — 「행 고르기」로 바꿀 수 있다(행 번호가 아니라 키 칸의 글자로 고른다) */
  row?: RowSuggestion;
  /** 읽기 — 고를 때 화면의 값(「확인」으로 바꾸면 기대값이 된다) */
  current?: string | null;
  /** 녹화기가 알아서 정한 것의 설명(팝업 · 있을 때만) — 경고가 아니다 */
  hints?: string[];
}

export interface RowSuggestion {
  /** 키 칸 · 값만 정하면 되는 행 고르기 */
  pick: RowPick;
  /** 누른 행이 몇 번째였나(1부터) — «몇 번째로»의 처음 값 */
  nth: number;
  /** 누른 행의 칸들 — 키로 쓸 칸을 고르는 데 */
  columns: { name: string; selector: string; text: string }[];
  rows: number;
}

export type ServerMessage =
  | { t: "phase"; phase: Phase; message: string }
  | { t: "progress"; text: string }
  | { t: "viewport"; width: number; height: number }
  | { t: "page"; url: string; title: string; canBack: boolean; /** 팝업 창 안이면 몇 겹째인가(0 = 처음 창) */ depth: number }
  | { t: "mode"; mode: RecordMode }
  | { t: "recorded"; item: Recorded }
  | { t: "notice"; level: "info" | "warn" | "error"; text: string }
  | { t: "select-open"; token: string; record: boolean; options: { value: string; label: string; selected: boolean }[]; rect: { x: number; y: number; width: number; height: number } }
  | { t: "dialog"; kind: string; message: string; defaultValue: string }
  /**
   * 앞 단계 재생이 **사람을 기다린다**(사람 기다리기 — 로그인) — 화면은 재생 중이어도 이 동안 사람이 페이지를 만진다.
   * prompt가 null이면 끝. ★이때 모드는 «둘러보기»라 사람이 넣은 것은 녹화되지 않는다
   */
  | { t: "human"; prompt: string | null; deadline: string | null }
  /**
   * 앞 단계 재생이 이 노드에 넘겨준 값(`$input`) — 화면이 «앞 단계에서 읽은 값»으로 보이고,
   * 녹화한 입력의 글자가 이 값과 같으면 `{{ $input.이름 }}`으로 저절로 잇는다. 재생하지 않았으면 오지 않는다
   */
  | { t: "inputs"; input: Record<string, unknown> };

export type { Target, TableTarget };
