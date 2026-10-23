/**
 * AI 도우미의 반복(ai/agent.ts · ai/build.ts) — 정해 둔 답으로(모델 없이).
 * ★검문소를 지나야 받는다 · 커스텀 코드는 막는다(있던 것은 그대로) · 웹 동작은 이름만 있는 빈 자리 → «녹화로 채울 곳» · 설명만이면 제안 없음.
 */
import { describe, expect, it } from "vitest";
import { checkFlow, type Flow } from "@flowsmith/core";
import { ask, type Message, type ModelReply, type Send } from "../src/ai/agent.ts";
import { buildProposal } from "../src/ai/build.ts";
import { systemPrompt } from "../src/ai/spec.ts";
import { blankFlow } from "../src/model/index.ts";

/** 차례로 답하는 가짜 모델 — 받은 요청도 남긴다 */
function script(...replies: ModelReply[]): Send & { calls: { messages: Message[]; system: string }[] } {
  const calls: { messages: Message[]; system: string }[] = [];
  const f = (async (req: { messages: Message[]; system: string }) => { calls.push({ messages: structuredClone(req.messages), system: req.system }); const r = replies.shift(); if (!r) throw new Error("답이 더 없습니다"); return r; }) as unknown as Send & { calls: typeof calls };
  f.calls = calls;
  return f;
}
const propose = (flow: unknown, id = "t1"): ModelReply => ({ content: [{ type: "tool_use", id, name: "propose_flow", input: { flow, summary: "목록 읽어 저장" } }], stop_reason: "tool_use" });
const say = (text: string): ModelReply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });

const LIST_FLOW = {
  name: "주문 목록 저장",
  params: [{ name: "day", label: "날짜", required: false, type: "date" }],
  secrets: [{ name: "shop", kind: "login", description: "쇼핑몰 계정" }],
  nodes: [
    { id: "w", type: "web", name: "주문 목록 읽기", config: { start: { kind: "url", url: "https://shop.example/login" }, actions: [
      { kind: "fill", label: "아이디", value: "{{ $secrets.shop.username }}" },
      { kind: "fill", label: "비밀번호", value: "{{ $secrets.shop.password }}" },
      { kind: "click", label: "로그인" },
      { kind: "readTable", label: "주문 목록", output: "orders", columns: ["주문번호", "상태"] },
    ] } },
    { id: "t", type: "transform", name: "배송중만", config: { source: "{{ $input.orders }}", steps: [{ kind: "filter", match: "all", rules: [{ field: "상태", op: "eq", value: "배송중" }] }] } },
    { id: "f", type: "fileWrite", name: "저장", config: { data: "{{ $input.rows }}", target: { name: "주문", format: "csv", mode: "append" } } },
  ],
  edges: [{ from: "w", to: "t" }, { from: "t", to: "f" }],
  notes: [{ text: "로그인 · 목록은 녹화로 채우세요", near: "w" }],
};
const ctx = (draft: Flow | null = null) => ({ draft, extensions: [], flows: [], newId: "ai-flow-1" });

describe("AI 도우미 — 만들기", () => {
  it("★검문소를 지난 제안 — 빈 칸은 기본값 · 웹 동작은 녹화로 채울 곳 · 위치 · 메모", async () => {
    const send = script(propose(LIST_FLOW), say("주문 목록을 읽어 CSV로 저장하는 뼈대를 만들었습니다. 로그인과 목록은 녹화로 채워 주세요."));
    const t = await ask(send, [], "쇼핑몰에서 배송중인 주문 목록을 저장하고 싶어", ctx());
    expect(t.proposal).not.toBeNull();
    const f = t.proposal!.flow;
    expect(f.id).toBe("ai-flow-1");
    expect(f.nodes.map((n) => [n.id, n.type])).toEqual([["w", "web"], ["t", "transform"], ["f", "fileWrite"]]);
    expect(f.nodes.map((n) => n.position.x)).toEqual([0, 260, 520]);
    expect(f.edges).toEqual([{ id: "e1", from: { node: "w", port: "out" }, to: { node: "t" } }, { id: "e2", from: { node: "t", port: "out" }, to: { node: "f" } }]);
    expect(t.proposal!.todo).toEqual(["주문 목록 읽기 › 아이디", "주문 목록 읽기 › 비밀번호", "주문 목록 읽기 › 로그인", "주문 목록 읽기 › 주문 목록"]);
    expect(f.notes[0]).toMatchObject({ text: "로그인 · 목록은 녹화로 채우세요", color: "yellow" });
    const fw = f.nodes[2]!;
    expect(fw.type === "fileWrite" && fw.config.target).toMatchObject({ name: "주문", format: "csv", mode: "append", kind: "file", scope: "flow" });
    // ★사람이 보는 초안에서는 «요소가 비었다» 문제만 남는다(녹화로 채울 것)
    expect(checkFlow(f).every((p) => /비었|위치/.test(p))).toBe(true);
    expect(t.reply).toMatch(/녹화로 채워/);
    // 두 번째 부르기에는 «받았습니다 · 녹화로 채울 자리 4곳»이 도구 결과로 갔다
    expect(JSON.stringify(send.calls[1]!.messages.at(-1))).toMatch(/받았습니다.*4곳/);
  });

  it("★문제가 있으면 돌려주고 고친 것을 받는다 — 커스텀 코드는 막는다", async () => {
    const bad = { ...LIST_FLOW, nodes: [...LIST_FLOW.nodes, { id: "c", type: "custom", name: "계산", config: { code: "return {}" } }] };
    const wrongRef = { ...LIST_FLOW, nodes: LIST_FLOW.nodes.map((n) => (n.id === "f" ? { ...n, config: { ...n.config, data: "{{ $input.nope }}" } } : n)) };
    const send = script(propose(bad, "a"), propose(wrongRef, "b"), propose(LIST_FLOW, "c"), say("고쳤습니다."));
    const t = await ask(send, [], "만들어 줘", ctx());
    expect(t.proposal?.flow.nodes.map((n) => n.id)).toEqual(["w", "t", "f"]);
    const results = send.calls.slice(1).map((c) => JSON.stringify(c.messages.at(-1)));
    expect(results[0]).toMatch(/커스텀 코드 노드는 만들 수 없습니다/);
    expect(results[1]).toMatch(/nope/);
    expect(results[2]).toMatch(/받았습니다/);
  });

  it("설명만 — 도구를 안 부르면 제안 없이 답만 · 대화는 이어 간다", async () => {
    const send = script(say("이 워크플로우는 아무것도 하지 않습니다."), say("네, 맞습니다."));
    const t1 = await ask(send, [], "설명해 줘", ctx(blankFlow("x", "빈")));
    expect(t1.proposal).toBeNull();
    expect(t1.reply).toBe("이 워크플로우는 아무것도 하지 않습니다.");
    const t2 = await ask(send, t1.messages, "정말?", ctx(blankFlow("x", "빈")));
    expect(send.calls[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(t2.reply).toBe("네, 맞습니다.");
  });

  it("횟수를 넘기면 멈추고 남은 문제를 알린다", async () => {
    const send = script(...Array.from({ length: 3 }, (_, i) => propose({ nodes: [] }, `x${i}`)));
    const t = await ask(send, [], "만들어 줘", ctx(), 3);
    expect(t.proposal).toBeNull();
    expect(t.problems.join(" ")).toMatch(/nodes가 비었습니다/);
    expect(t.messages.at(-1)!.role).toBe("assistant");   // 다음 말을 이어 갈 수 있게 닫아 둔다
  });

  it("★나눠 만든 웹 노드 — 페이지 접속(동작 없음) → 사람 기다리기 → 주문 읽기 · 사람 기다리기의 끝 표시는 녹화로 채울 곳(2026-10-22)", () => {
    const raw = {
      name: "주문 읽기",
      nodes: [
        { id: "open", type: "web", name: "페이지 접속", config: { start: { kind: "url", url: "https://shop.example" }, actions: [] } },
        { id: "login", type: "web", name: "사람 기다리기", config: { start: { kind: "continue" }, actions: [{ kind: "human", prompt: "쇼핑몰에 로그인해 주세요" }] } },
        { id: "read", type: "web", name: "주문 읽기", config: { start: { kind: "continue" }, actions: [{ kind: "readTable", label: "주문 목록", output: "orders", columns: ["주문번호"] }] } },
        { id: "save", type: "fileWrite", name: "저장", config: { data: "{{ $input.orders }}", target: { name: "주문", format: "csv" } } },
      ],
      edges: [{ from: "open", to: "login" }, { from: "login", to: "read" }, { from: "read", to: "save" }],
    };
    const b = buildProposal(raw, ctx());
    expect(b.problems).toEqual([]);
    const login = b.flow!.nodes.find((n) => n.id === "login")!;
    expect(login.type === "web" && login.config.actions[0]).toMatchObject({ kind: "human", prompt: "쇼핑몰에 로그인해 주세요" });
    expect(b.todo).toContain("사람 기다리기 › 쇼핑몰에 로그인해 주세요(끝 표시)");
    expect(systemPrompt(ctx())).toMatch(/한 웹페이지 노드에 단계를 몰지 말고 나눕니다/);
  });
});

describe("AI 도우미 — 고치기", () => {
  const draft = (): Flow => {
    const f = blankFlow("edit", "고치기");
    return {
      ...f,
      nodes: [
        { id: "w", type: "web", name: "읽기", position: { x: 40, y: 40 }, config: { start: { kind: "url", url: "https://a.example" }, actions: [
          { id: "a1", kind: "read", risk: "safe", timeoutMs: null, optional: false, output: "amount", strategy: "auto", attribute: null, transform: null,
            target: { label: "금액", locators: [{ kind: "css", value: "#amount" }], fingerprint: null, frames: [], verifiedAt: null } },
        ] } },
        { id: "c", type: "custom", name: "계산", position: { x: 300, y: 40 }, config: { code: "return { x: 1 };", outputs: ["x"], usesPage: false, timeoutMs: null } },
      ],
      edges: [{ id: "e1", from: { node: "w", port: "out" }, to: { node: "c" } }],
    };
  };

  it("★녹화한 동작 · 위치 · 있던 커스텀 코드는 그대로 — 노드를 더하면 그것만", () => {
    const d = draft();
    const raw = {
      name: "고치기",
      nodes: [
        { id: "w", type: "web", name: "읽기", config: { start: { kind: "url", url: "https://a.example" }, actions: [{ id: "a1", kind: "read", label: "금액", output: "amount" }] } },
        { id: "c", type: "custom", name: "계산", config: "(커스텀 코드 — 바꾸지 마세요)" },
        { id: "k", type: "check", name: "검사", config: { items: [{ id: "k1", label: "금액 있음", actual: "{{ $input.amount }}", op: "notEmpty", expected: null }] } },
      ],
      edges: [{ from: "w", to: "c" }, { from: "w", to: "k" }],
    };
    const b = buildProposal(raw, { draft: d, extensions: [], newId: "edit" });
    expect(b.problems).toEqual([]);
    const w = b.flow!.nodes.find((n) => n.id === "w")!;
    expect(w.position).toEqual({ x: 40, y: 40 });
    expect(w.type === "web" && w.config.actions[0]!.kind === "read" && w.config.actions[0]!.target.locators[0]!.value).toBe("#amount");
    expect(b.flow!.nodes.find((n) => n.id === "c")).toEqual(d.nodes[1]);
    expect(b.todo).toEqual([]);
  });

  it("있던 커스텀 코드를 바꾸려 하면 막는다 · 없는 확장도", () => {
    const d = draft();
    const b = buildProposal({ nodes: [{ id: "c", type: "transform", name: "계산", config: {} }, { id: "x", type: "extension", name: "확장", config: { extension: "shop.nope" } }], edges: [] }, { draft: d, extensions: [], newId: "edit" });
    expect(b.flow).toBeNull();
    expect(b.problems.join("\n")).toMatch(/커스텀 코드 노드 «계산»는 바꿀 수 없습니다/);
    expect(b.problems.join("\n")).toMatch(/확장 «shop\.nope»가 이 서버에 없습니다/);
  });

  it("설명서 — 지금 초안(요소 없이) · 확장 · 다른 워크플로우 · ★시크릿 값 · 커스텀 코드 금지 규칙", () => {
    const s = systemPrompt({ draft: draft(), extensions: [{ id: "shop.order-read", title: "읽기", description: "쇼핑몰", options: [], outputs: ["orderNo"], browser: "attach", risk: "safe" }], flows: [{ id: "f2", name: "다른 것" }] });
    expect(s).toMatch(/커스텀 코드 노드\(type "custom"\)는 만들지도 고치지도 않습니다/);
    expect(s).toMatch(/시크릿\(비밀번호 · 토큰\)의 값은 절대 적지 않습니다/);
    expect(s).toMatch(/shop\.order-read «읽기»/);
    expect(s).toMatch(/f2 «다른 것»/);
    expect(s).not.toMatch(/#amount/);          // 선택자는 보내지 않는다
    expect(s).not.toMatch(/return \{ x: 1 \}/); // 코드도
  });
});
