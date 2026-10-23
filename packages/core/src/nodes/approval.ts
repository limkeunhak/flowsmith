/**
 * **승인 기다리기 노드** — 되돌릴 수 없는 일(제출 · 저장 · 발송) 앞에서 사람이 «승인»해야 이어 간다 (n8n Wait · Jenkins input step).
 *
 *   message    무엇을 승인하나 — 표현식을 쓸 수 있다(「{{ $input.orderNo }} 주문을 제출할까요?」)
 *   minRole    누가 승인하나 — 이 역할 이상(실행자 · 편집자 · 관리자). 로그인을 끈 서버는 누구나
 *   timeoutMin 기다리는 시간(분) — 넘으면 실패
 *
 * 승인하면 { approved: true, by, comment, at }을 내놓고 이어 간다. **거절하면 그 자리에서 멈춘다**(노드 실패 — 까닭이 기록에 남는다).
 * ★점검 실행은 이 앞에서 멈춘다. 알림 «승인 요청»이 그 실행으로 가는 링크를 보낸다.
 */
export const APPROVAL_ROLES = ["runner", "editor", "admin"] as const;
export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

export interface ApprovalConfig {
  message: string;
  minRole: ApprovalRole;
  timeoutMin: number;
}

export const APPROVAL_OUTPUTS = ["approved", "by", "comment", "at"] as const;
/** 기다리는 시간 — 기본 하루 · 1분~7일 */
export const APPROVAL_TIMEOUT = { defaultMin: 24 * 60, minMin: 1, maxMin: 7 * 24 * 60 } as const;
