/**
 * **AI 도우미의 반복** — 모델에 묻고(서버가 대신 부른다 · /api/ai/messages) · propose_flow가 오면 검문소로 보고(ai/build.ts) ·
 * 문제가 있으면 돌려줘 다시 하게 · 받아들여지면 «제안»으로 둔다. ★적용은 사람이(바뀐 것 보기 → 적용) · 저장 · 게시도 사람이.
 * 사이트 보기(PLAN §42-8 · 관리자가 켰을 때만): open_page · look_page — 화면 요약의 요소에 ref(p1 …)를 붙여 돌려주고, AI는 from으로 쓴다.
 * 순수하다 — 모델 부르기(send) · 화면 보기(browse)를 받아서, 시험이 정해 둔 답을 넣을 수 있다.
 */
import type { Flow } from "@flowsmith/core";
import type { ExtensionMeta } from "../ext-meta.ts";
import { buildProposal } from "./build.ts";
import { hostsOf, pageRefs, refLines, siteRefs, type BrowseView, type RefElement, type SiteFlow } from "./refs.ts";
import { systemPrompt, toolsFor, type Tool } from "./spec.ts";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface Message { role: "user" | "assistant"; content: string | Block[] }
export interface ModelReply { content: Block[]; stop_reason?: string }
export type Send = (req: { system: string; messages: Message[]; tools: Tool[] }) => Promise<ModelReply>;

export interface AgentContext {
  draft: Flow | null;
  extensions: ExtensionMeta[];
  flows: { id: string; name: string }[];
  /** 새 워크플로우의 id */
  newId: string;
  /**
   * 같은 사이트의 워크플로우(서버 GET /api/ai/site-flows) — 사람이 쓴 글 · 초안의 사이트 이름으로 찾는다.
   * 녹화해 둔 요소를 AI가 from으로 다시 쓴다(ai/refs.ts). 없으면 찾지 않는다
   */
  siteFlows?: (hosts: string[]) => Promise<SiteFlow[]>;
  /** 사이트 보기(관리자가 켰을 때만) — 주소를 열어 · 지금 화면을 다시 요약 */
  browse?: { open(url: string): Promise<BrowseView>; look(): Promise<BrowseView> };
  /** 앞 말에서 본 화면의 요소(p1 …) — 대화를 이어 갈 때 그대로 쓴다 */
  pageRefs?: RefElement[];
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
  /** 지금까지 본 화면의 요소 — 다음 말에 넘긴다 */
  pageRefs: RefElement[];
}

const MAX_ROUNDS = 8;

/**
 * 하는 일 — 화면이 실시간으로 보인다(«AI가 하는 일»). round는 0부터.
 *   ask       모델에 묻는 중
 *   look      사이트를 열어 · 다시 봤다(요소 수 · 화면)
 *   proposed  초안이 왔다(노드 수) → 검사 중
 *   rejected  검사에서 문제 — 고쳐 달라고 돌려준다
 *   accepted  검사 통과 — 녹화로 채울 곳
 *   reply     말로 답했다(제안 없음 · 마무리 말)
 */
export type Step =
  | { kind: "ask"; round: number }
  | { kind: "look"; round: number; url: string; title: string; elements: number; shot?: string; error?: string }
  | { kind: "proposed"; round: number; nodes: number; summary: string }
  | { kind: "rejected"; round: number; problems: string[] }
  | { kind: "accepted"; round: number; nodes: number; todo: number }
  | { kind: "reply"; round: number };
export interface AskOptions { maxRounds?: number; onStep?: (s: Step) => void }

export async function ask(send: Send, history: Message[], text: string, ctx: AgentContext, opts: number | AskOptions = {}): Promise<Turn> {
  const { maxRounds = MAX_ROUNDS, onStep } = typeof opts === "number" ? { maxRounds: opts } : opts;
  const step = (st: Step) => { try { onStep?.(st); } catch { /* 보이는 쪽의 사고는 여기서 멈춘다 */ } };
  // 같은 사이트의 녹화 — 찾지 못해도 그냥 간다(빈 자리로)
  let refs: RefElement[] = [];
  const hosts = ctx.siteFlows ? hostsOf(text, ctx.draft) : [];
  if (hosts.length) { try { refs = siteRefs(await ctx.siteFlows!(hosts)); } catch { refs = []; } }
  const page: RefElement[] = [...(ctx.pageRefs ?? [])];
  const refMap = new Map([...refs, ...page].map((r) => [r.ref, r]));
  const system = systemPrompt({ ...ctx, refs, pageRefs: page, browse: ctx.browse !== undefined });
  const tools = toolsFor(ctx.browse !== undefined);
  const messages: Message[] = [...history, { role: "user", content: text }];
  let proposal: Turn["proposal"] = null;
  let problems: string[] = [];
  const said: string[] = [];

  /** 화면을 보고 요소에 ref를 붙여 돌려준다 */
  const looked = (round: number, v: BrowseView): string => {
    const fresh = pageRefs(v, page.length + 1);
    for (const r of fresh) { page.push(r); refMap.set(r.ref, r); }
    step({ kind: "look", round, url: v.url, title: v.title, elements: fresh.length, ...(v.shot ? { shot: v.shot } : {}) });
    return `화면 «${v.title || "(제목 없음)"}» ${v.url}\n${fresh.length ? refLines(fresh) : "(쓸 수 있는 요소가 없습니다)"}\n` +
      "이 요소를 동작의 from으로 쓰세요(p…). 로그인이 필요한 뒤 화면은 볼 수 없습니다 — 그 뒤 동작은 이름만 붙인 빈 자리로 두세요.";
  };

  for (let round = 0; round < maxRounds; round++) {
    step({ kind: "ask", round });
    const r = await send({ system, messages, tools });
    const content = Array.isArray(r.content) ? r.content : [];
    messages.push({ role: "assistant", content });
    for (const b of content) if (b.type === "text" && b.text.trim()) said.push(b.text.trim());
    const uses = content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length === 0) { step({ kind: "reply", round }); break; }
    const results: Block[] = [];
    for (const u of uses) {
      const err = (content: string): Block => ({ type: "tool_result", tool_use_id: u.id, content, is_error: true });
      if ((u.name === "open_page" || u.name === "look_page") && ctx.browse) {
        const url = String((u.input as { url?: unknown } | null)?.url ?? "");
        try {
          const v = u.name === "open_page" ? await ctx.browse.open(url) : await ctx.browse.look();
          results.push({ type: "tool_result", tool_use_id: u.id, content: looked(round, v) });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          step({ kind: "look", round, url, title: "", elements: 0, error: message });
          results.push(err(`화면을 열지 못했습니다 — ${message}`));
        }
        continue;
      }
      if (u.name !== "propose_flow") { results.push(err(`모르는 도구 «${u.name}» — ${tools.map((t) => t.name).join(" · ")}만 있습니다`)); continue; }
      const input = (u.input ?? {}) as { flow?: unknown; summary?: unknown };
      const rawNodes = (input.flow as { nodes?: unknown[] } | undefined)?.nodes;
      step({ kind: "proposed", round, nodes: Array.isArray(rawNodes) ? rawNodes.length : 0, summary: typeof input.summary === "string" ? input.summary : "" });
      const b = buildProposal(input.flow, { draft: proposal?.flow ?? ctx.draft, extensions: ctx.extensions, newId: ctx.newId, refs: refMap });
      if (!b.flow) {
        problems = b.problems;
        step({ kind: "rejected", round, problems: b.problems });
        results.push(err(`받지 못했습니다 — 고쳐서 다시 부르세요:\n- ${b.problems.slice(0, 30).join("\n- ")}`));
        continue;
      }
      problems = [];
      proposal = { flow: b.flow, summary: typeof input.summary === "string" ? input.summary : "", todo: b.todo };
      step({ kind: "accepted", round, nodes: b.flow.nodes.length, todo: b.todo.length });
      results.push({ type: "tool_result", tool_use_id: u.id, content: `받았습니다.${b.todo.length ? ` 사람이 녹화로 채울 자리 ${b.todo.length}곳: ${b.todo.join(", ")}` : ""} 이제 사람에게 무엇을 만들었는지 · 할 일을 두세 줄로 말하고 끝내세요.` });
    }
    messages.push({ role: "user", content: results });
    if (r.stop_reason === "end_turn" && uses.length === 0) break;
  }
  // 마지막이 도구 결과로 끝났으면(횟수를 넘김) 대화를 이어 갈 수 있게 닫아 둔다
  const last = messages[messages.length - 1];
  if (last?.role === "user" && Array.isArray(last.content)) messages.push({ role: "assistant", content: [{ type: "text", text: proposal ? "제안을 만들었습니다." : "여기서 멈춥니다." }] });
  const reply = said.join("\n\n") || (proposal ? "제안을 만들었습니다." : problems.length ? "워크플로우를 끝내 만들지 못했습니다." : "");
  return { reply, proposal, problems, messages, pageRefs: page };
}
