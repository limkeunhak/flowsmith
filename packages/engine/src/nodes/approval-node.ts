/**
 * **승인 기다리기** 노드 — 되돌릴 수 없는 일(제출 · 저장 · 발송) 앞에서 사람이 승인해야 이어 간다(Jenkins input · Airflow의 사람 확인).
 *
 *   안내 글(표현식 — 시크릿은 못 읽는다)을 보이고, 승인 · 거절 · 시간 넘김 · 멈춤 중 하나를 기다린다.
 *   승인 → 받은 입력 + { approved, by, comment, at }을 내놓는다(뒤 노드가 앞의 값을 그대로 쓴다)
 *   거절 · 시간 넘김 → 이 노드가 실패한다(실행이 멈춘다)
 *
 * ★엔진은 누가 승인하는지 모른다 — 서버가 준 `approval`이 묻고 기다린다(run/runs.ts — 역할 · 화면 · 알림).
 *  없으면(CLI · 서버 밖) 바로 멈춘다 — 아무도 답할 수 없는 기다림을 만들지 않는다.
 */
import { evaluate, type ApprovalNode, type ApprovalRole, type Output, type Scope } from "@flowsmith/core";
import { RunStopped } from "../errors.ts";

export interface ApprovalAsk {
  nodeId: string;
  message: string;
  minRole: ApprovalRole;
  deadline: string;
  signal: AbortSignal;
}
export interface ApprovalAnswer {
  approved: boolean;
  /** 누가 — 로그인을 끈 서버면 null */
  by: string | null;
  comment: string;
}
/** 서버가 준다 — 묻고 답을 기다린다(멈추면 signal로 그만둔다) */
export type AskApproval = (ask: ApprovalAsk) => Promise<ApprovalAnswer>;

export type ApprovalState = "waiting" | "approved" | "rejected" | "timeout" | "stopped";

export async function runApprovalNode(
  node: ApprovalNode, scope: Scope, ask: AskApproval | undefined, log: (text: string) => void, signal: AbortSignal,
  event: (state: ApprovalState, e: { message: string; minRole: ApprovalRole; deadline: string | null; by?: string | null; comment?: string }) => void,
): Promise<Output> {
  if (!ask) throw new Error("이 실행기는 승인을 받을 수 없습니다 — 서버에서 돌리세요(승인 기다리기)");
  const c = node.config;
  const message = String(evaluate(c.message, { ...scope, secrets: {} }).value ?? "").trim() || "진행해도 될까요?";
  const deadline = new Date(Date.now() + c.timeoutMin * 60_000).toISOString();
  log(`승인을 기다립니다 — ${message} (${c.timeoutMin >= 60 ? `${Math.round(c.timeoutMin / 60)}시간` : `${c.timeoutMin}분`}까지)`);
  event("waiting", { message, minRole: c.minRole, deadline });

  const quit = new AbortController();
  const onStop = () => quit.abort();
  signal.addEventListener("abort", onStop, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      ask({ nodeId: node.id, message, minRole: c.minRole, deadline, signal: quit.signal }),
      new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), c.timeoutMin * 60_000); }),
      new Promise<"stopped">((resolve) => { if (signal.aborted) resolve("stopped"); else signal.addEventListener("abort", () => resolve("stopped"), { once: true }); }),
    ]);
    if (answer === "stopped") { event("stopped", { message, minRole: c.minRole, deadline: null }); throw new RunStopped(); }
    if (answer === "timeout") {
      event("timeout", { message, minRole: c.minRole, deadline: null });
      throw new Error(`승인을 받지 못했습니다 — ${c.timeoutMin >= 60 ? `${Math.round(c.timeoutMin / 60)}시간` : `${c.timeoutMin}분`} 안에 아무도 승인하지 않았습니다`);
    }
    const who = answer.by ?? "누군가";
    if (!answer.approved) {
      event("rejected", { message, minRole: c.minRole, deadline: null, by: answer.by, comment: answer.comment });
      throw new Error(`${who}이(가) 거절했습니다${answer.comment ? ` — ${answer.comment}` : ""}`);
    }
    event("approved", { message, minRole: c.minRole, deadline: null, by: answer.by, comment: answer.comment });
    log(`${who}이(가) 승인했습니다${answer.comment ? ` — ${answer.comment}` : ""}`);
    return { ...scope.input, approved: true, by: answer.by, comment: answer.comment, at: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
    quit.abort();   // 묻던 쪽(서버)에게 «이제 그만» — 화면의 승인 띠를 걷는다
    signal.removeEventListener("abort", onStop);
  }
}
