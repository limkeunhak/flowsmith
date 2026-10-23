/**
 * **AI 도우미의 반복** — 모델에 묻고(서버가 대신 부른다 · /api/ai/messages) · propose_flow가 오면 검문소로 보고(ai/build.ts) ·
 * 문제가 있으면 돌려줘 다시 하게 · 받아들여지면 «제안»으로 둔다. ★적용은 사람이(바뀐 것 보기 → 적용) · 저장 · 게시도 사람이.
 * 순수하다 — 모델 부르기(send)를 받아서, 시험이 정해 둔 답을 넣을 수 있다.
 */
import type { Flow } from "@flowsmith/core";
import type { ExtensionMeta } from "../ext-meta.ts";
import { buildProposal } from "./build.ts";
import { systemPrompt, TOOLS } from "./spec.ts";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface Message { role: "user" | "assistant"; content: string | Block[] }
export interface ModelReply { content: Block[]; stop_reason?: string }
export type Send = (req: { system: string; messages: Message[]; tools: typeof TOOLS }) => Promise<ModelReply>;

export interface AgentContext {
  draft: Flow | null;
  extensions: ExtensionMeta[];
  flows: { id: string; name: string }[];
  /** 새 워크플로우의 id */
  newId: string;
}

export interface Turn {
  /** 사람에게 보일 답 */
  reply: string;
  /** 받아들인 제안 — 없으면 null(설명만 · 끝내 못 만듦) */
  proposal: { flow: Flow; summary: string; todo: string[] } | null;
  /** 끝내 못 고친 문제(모델이 포기했거나 횟수를 넘김) */
  problems: string[];
  /** 다음 말을 이어 갈 대화 */
  messages: Message[];
}

const MAX_ROUNDS = 6;

/**
 * 하는 일 — 화면이 실시간으로 보인다(«AI가 하는 일»). round는 0부터.
 *   ask       모델에 묻는 중
 *   proposed  초안이 왔다(노드 수) → 검사 중
 *   rejected  검사에서 문제 — 고쳐 달라고 돌려준다
 *   accepted  검사 통과 — 녹화로 채울 곳
 *   reply     말로 답했다(제안 없음 · 마무리 말)
 */
export type Step =
  | { kind: "ask"; round: number }
  | { kind: "proposed"; round: number; nodes: number; summary: string }
  | { kind: "rejected"; round: number; problems: string[] }
  | { kind: "accepted"; round: number; nodes: number; todo: number }
  | { kind: "reply"; round: number };
export interface AskOptions { maxRounds?: number; onStep?: (s: Step) => void }

export async function ask(send: Send, history: Message[], text: string, ctx: AgentContext, opts: number | AskOptions = {}): Promise<Turn> {
  const { maxRounds = MAX_ROUNDS, onStep } = typeof opts === "number" ? { maxRounds: opts } : opts;
  const step = (st: Step) => { try { onStep?.(st); } catch { /* 보이는 쪽의 사고는 여기서 멈춘다 */ } };
  const system = systemPrompt(ctx);
  const messages: Message[] = [...history, { role: "user", content: text }];
  let proposal: Turn["proposal"] = null;
  let problems: string[] = [];
  const said: string[] = [];
  for (let round = 0; round < maxRounds; round++) {
    step({ kind: "ask", round });
    const r = await send({ system, messages, tools: TOOLS });
    const content = Array.isArray(r.content) ? r.content : [];
    messages.push({ role: "assistant", content });
    for (const b of content) if (b.type === "text" && b.text.trim()) said.push(b.text.trim());
    const uses = content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length === 0) { step({ kind: "reply", round }); break; }
    const results: Block[] = uses.map((u) => {
      if (u.name !== "propose_flow") return { type: "tool_result", tool_use_id: u.id, content: `모르는 도구 «${u.name}» — propose_flow만 있습니다`, is_error: true };
      const input = (u.input ?? {}) as { flow?: unknown; summary?: unknown };
      const rawNodes = (input.flow as { nodes?: unknown[] } | undefined)?.nodes;
      step({ kind: "proposed", round, nodes: Array.isArray(rawNodes) ? rawNodes.length : 0, summary: typeof input.summary === "string" ? input.summary : "" });
      const b = buildProposal(input.flow, { draft: proposal?.flow ?? ctx.draft, extensions: ctx.extensions, newId: ctx.newId });
      if (!b.flow) {
        problems = b.problems;
        step({ kind: "rejected", round, problems: b.problems });
        return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `받지 못했습니다 — 고쳐서 다시 부르세요:\n- ${b.problems.slice(0, 30).join("\n- ")}` };
      }
      problems = [];
      proposal = { flow: b.flow, summary: typeof input.summary === "string" ? input.summary : "", todo: b.todo };
      step({ kind: "accepted", round, nodes: b.flow.nodes.length, todo: b.todo.length });
      return { type: "tool_result", tool_use_id: u.id, content: `받았습니다.${b.todo.length ? ` 사람이 녹화로 채울 자리 ${b.todo.length}곳: ${b.todo.join(", ")}` : ""} 이제 사람에게 무엇을 만들었는지 · 할 일을 두세 줄로 말하고 끝내세요.` };
    });
    messages.push({ role: "user", content: results });
    if (r.stop_reason === "end_turn" && uses.length === 0) break;
  }
  // 마지막이 도구 결과로 끝났으면(횟수를 넘김) 대화를 이어 갈 수 있게 닫아 둔다
  const last = messages[messages.length - 1];
  if (last?.role === "user" && Array.isArray(last.content)) messages.push({ role: "assistant", content: [{ type: "text", text: proposal ? "제안을 만들었습니다." : "여기서 멈춥니다." }] });
  const reply = said.join("\n\n") || (proposal ? "제안을 만들었습니다." : problems.length ? "워크플로우를 끝내 만들지 못했습니다." : "");
  return { reply, proposal, problems, messages };
}
