/**
 * **알림** — 플로우 설정의 «언제 · 어디로» (PLAN §15). 보내는 일은 서버(run/notifier.ts)가 한다.
 *
 *   언제   failure 실패 · recovered 실패 뒤 다시 성공 · success 성공 · cancelled 멈춤 · drift 사이트가 바뀜(변경 감시) ·
 *          human 사람을 기다림(사람 기다리기 동작 — 로그인 · 인증) · approval 승인을 기다림(승인 기다리기 노드) ·
 *          blocked 막힘(고르면 안 되는 행에 걸려 막힘 갈래로 끝남)
 *   어디로 slack · teams(Workflows 웹훅) · webhook(아무 주소에 JSON)
 *
 * ★게시된 버전의 실행만 알린다 — 편집 화면에서 초안을 시험할 때마다 울리면 아무도 안 본다.
 *  다른 플로우가 부른 실행도 알리지 않는다(부른 쪽이 알린다).
 * ★주소는 시크릿에 넣고 `{{ $secrets.slack }}`로 쓰는 것을 권한다 — Slack 웹훅 주소는 그 자체가 열쇠다.
 */

/** human — 실행이 **사람을 기다린다**(로그인 · 인증). 보는 사람이 없는 일정 · 웹훅 실행을 위해 — 그 실행으로 가는 링크를 붙인다 */
export const NOTIFY_EVENTS = ["failure", "recovered", "success", "cancelled", "blocked", "drift", "human", "approval"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export const NOTIFY_EVENT_LABEL: Record<NotifyEvent, string> = {
  failure: "실패", recovered: "다시 성공(회복)", success: "성공", cancelled: "멈춤", blocked: "막힘(고르면 안 되는 건)", drift: "사이트가 바뀜", human: "사람을 기다림(로그인 등)", approval: "승인을 기다림",
};

export const NOTIFY_CHANNELS = ["slack", "teams", "webhook", "email"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export interface NotifyRule {
  id: string;
  on: NotifyEvent[];
  channel: NotifyChannel;
  /**
   * 어디로 — 웹훅 주소, 메일이면 **받는 사람**(쉼표로 여럿). `$vars` · `$secrets`만 쓸 수 있다.
   * ☆메일을 보내는 서버(SMTP)는 플로우가 아니라 서버 설정이다(FLOWSMITH_SMTP_URL)
   */
  url: string;
  /** 메일 — 성공했을 때 결과(목록)를 엑셀로 붙인다 */
  attach: boolean;
  /** 실패 · 사이트 바뀜이 이어지면 처음 한 번만(회복하면 다시) — 5분마다 도는 일정이 5분마다 울리지 않게 */
  firstOnly: boolean;
  enabled: boolean;
}

/** 메일 주소 하나 — 넉넉하게(받는 서버가 마지막에 본다) */
export const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** 받는 사람 글자 → 주소들 — 「a@x.com, b@y.com」 · 「a@x.com; b@y.com」 · 줄바꿈 */
export const recipientsOf = (s: string): string[] => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
