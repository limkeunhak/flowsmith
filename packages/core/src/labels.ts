/**
 * 화면 · 문제 문장 · 알림이 함께 쓰는 이름 — 노드 종류 · 웹페이지 동작 · 트리거 · 역할 · 실행/점검 결과 · 시간.
 * 한 곳에 두어 같은 것을 같은 말로 부른다(서버의 알림과 화면이 같은 말).
 */
import type { NodeType } from "./flow.ts";
import type { WebAction } from "./nodes/web.ts";

export const NODE_TYPE_LABEL: Record<NodeType, string> = { web: "웹페이지", condition: "조건", custom: "커스텀", extension: "확장", fileWrite: "파일 쓰기", fileRead: "파일 읽기", flowCall: "다른 워크플로우 실행", http: "HTTP 요청", transform: "값 다듬기", approval: "승인 기다리기", check: "검사" };

export const ACTION_LABEL: Record<WebAction["kind"], string> = {
  goto: "주소로 가기", click: "누르기", fill: "넣기", select: "고르기", check: "체크",
  press: "키 누르기", wait: "기다리기", read: "읽기", readTable: "표 읽기",
  closeWindow: "창 닫기", switchWindow: "새 창으로 옮기기", recheck: "넣은 칸 다시 확인", pickRow: "행 고르기", assert: "확인", human: "사람 기다리기", walletApprove: "MetaMask 승인",
};

/** 어느 브라우저에서 도나(settings.browser) */
export const BROWSER_MODE_LABEL = { launch: "띄우기", attach: "사람의 크롬에 붙기", wallet: "지갑 브라우저(MetaMask)", app: "앱 안 브라우저" } as const;

/** 실행을 시작한 길 */
export const TRIGGER_LABEL: Record<string, string> = { manual: "손으로", api: "API", schedule: "일정", webhook: "웹훅", flow: "다른 워크플로우", after: "다른 워크플로우가 끝나서", file: "파일이 생겨서", suite: "Suite(테스트)" };

export const ROLE_LABEL = { admin: "관리자", editor: "편집자", runner: "실행자", viewer: "보는 사람" } as const;

export const RUN_STATUS_LABEL: Record<string, string> = { running: "도는 중", success: "성공", failure: "실패", cancelled: "멈춤", blocked: "막힘" };

export const PROBE_STATUS_LABEL: Record<string, string> = { running: "점검 중", ok: "정상", changed: "바뀜", broken: "깨짐", error: "점검 못 함" };

/**
 * 걸린 시간 — 320ms · 4.2초 · 12초 · 1분 5초 · 1시간 2분. 없으면 empty
 * ★화면 · 알림이 모두 이것을 쓴다 — 같은 실행이 곳마다 «65.0초» · «1분 5초»로 다르게 보이지 않게
 */
export function durationText(ms: number | null | undefined, empty = ""): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return empty;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}초`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s / 60}분`;
  const m = Math.round(s / 60);
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`;
}
