/**
 * AI 설명서의 노드 · 동작 목록과 예시(ai/catalog.ts) — **진짜 길로 돌려 본다**: 예시가 ai/build.ts · 검문소를 통과해야 한다.
 * 노드 종류 · 웹 동작마다 하나씩 있어야 한다 — core가 바뀌어 예시가 어긋나면 여기서 걸린다.
 * 그리고 «다시 쓸 수 있는 요소»(ai/refs.ts) — from이면 검증된 요소를 그대로 옮기고, 목록에 없는 ref는 받지 않는다 · 같은 사이트의 녹화를 찾아 보인다.
 */
import { describe, expect, it } from "vitest";
import { NODE_TYPES, type Flow, type Target } from "@flowsmith/core";
import { ask, type Message, type ModelReply, type Send } from "../src/ai/agent.ts";
import { buildProposal, WEB_KINDS } from "../src/ai/build.ts";
import { ACTION_DOCS, DOC_WRAPPER, EXAMPLES, NODE_DOCS } from "../src/ai/catalog.ts";
import { hostsOf, siteRefs, type SiteFlow } from "../src/ai/refs.ts";
import { systemPrompt } from "../src/ai/spec.ts";
import type { ExtensionMeta } from "../src/ext-meta.ts";

const EXT: ExtensionMeta = { id: "my-extension", title: "시험 확장", description: "", options: [{ name: "이름", label: "이름", required: false }], outputs: ["out"], browser: "none", risk: "safe" };
const build = (flow: unknown, refs?: Map<string, never>) => buildProposal(flow, { draft: null, extensions: [EXT], newId: "t", ...(refs ? { refs } : {}) });

describe("AI 설명서 — 노드 · 동작 목록(catalog)", () => {
  it("★노드 종류마다(커스텀 코드 빼고) · AI가 낼 수 있는 웹 동작마다 하나씩", () => {
    expect(NODE_DOCS.map((d) => d.type).sort()).toEqual(NODE_TYPES.filter((t) => t !== "custom").sort());
    expect(ACTION_DOCS.map((a) => a.kind).sort()).toEqual([...WEB_KINDS].sort());
  });

  it.each(NODE_DOCS.map((d) => [d.type, d] as const))("★예시 config가 검문소를 통과한다 — %s", (_t, d) => {
    const b = build({ name: "예시", ...DOC_WRAPPER, nodes: [{ id: "n1", type: d.type, name: d.title, config: d.config }], edges: [] });
    expect(b.problems).toEqual([]);
    expect(b.flow).not.toBeNull();
  });

  it.each(ACTION_DOCS.map((a) => [a.kind, a] as const))("웹 동작 예시가 통과한다 — %s", (_k, a) => {
    const b = build({ name: "예시", ...DOC_WRAPPER, nodes: [{ id: "w", type: "web", name: "웹", config: { start: { kind: "url", url: "https://shop.example.com" }, actions: [a.example] } }], edges: [] });
    expect(b.problems).toEqual([]);
  });

  it.each(EXAMPLES.map((e) => [e.ask, e] as const))("★잘 만든 예가 통과한다 — %s", (_ask, e) => {
    const b = build(e.flow);
    expect(b.problems).toEqual([]);
    expect(b.todo.length).toBeGreaterThan(0);   // 웹 동작은 빈 자리(녹화로)
  });

  it("설명서에 노드 종류 · 예가 다 보인다", () => {
    const s = systemPrompt({ draft: null, extensions: [], flows: [] });
    for (const d of NODE_DOCS) expect(s).toContain(`**${d.type}**`);
    for (const e of EXAMPLES) expect(s).toContain(e.ask);
    expect(s).toContain("다시 쓸 수 있는 요소");
  });
});

const tgt = (label: string, css: string): Target => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: "2026-10-25T00:00:00.000Z" });
const SITE: SiteFlow[] = [{
  id: "order-check", name: "주문 조회", nodes: [{
    id: "w", name: "로그인 · 읽기", start: { kind: "url", url: "https://admin.shop.example.com/login" }, actions: [
      { id: "a1", kind: "fill", target: tgt("아이디", "#uid"), value: "{{ $secrets.shop.username }}" },
      { id: "a2", kind: "click", target: tgt("로그인", "button[type=submit]") },
      { id: "a3", kind: "read", target: tgt("주문 상태", "#order-status"), output: "status" },
      { id: "a4", kind: "readTable", table: { label: "주문 목록", rows: tgt("주문 목록", "#orders tr"), columns: [{ name: "주문번호", selector: "td:nth-child(1)", strategy: "auto" }] } as never, output: "orders" },
      { id: "a5", kind: "click", target: { label: "빈 것", locators: [], fingerprint: null, frames: [], verifiedAt: null } },
    ],
  }],
}];

describe("다시 쓸 수 있는 요소 — from", () => {
  const refs = new Map(siteRefs(SITE).map((r) => [r.ref, r]));
  it("★녹화된 동작만 ref가 된다(요소가 빈 것은 빼고) · 시크릿 값 자리는 값으로 보이지 않는다", () => {
    expect([...refs.values()].map((r) => [r.ref, r.kind, r.label])).toEqual([["r1", "fill", "아이디"], ["r2", "click", "로그인"], ["r3", "read", "주문 상태"], ["r4", "readTable", "주문 목록"]]);
    expect(refs.get("r1")!.value).toBeUndefined();
  });
  it("★from이면 그 요소(위치 · 지문)를 옮긴다 — 녹화로 채울 곳에 들지 않는다 · 목록에 없는 ref는 받지 않는다", () => {
    const flow = { name: "주문 상태", params: [{ name: "orderNo", label: "주문번호" }], nodes: [{ id: "w", type: "web", name: "읽기", config: { start: { kind: "url", url: "https://admin.shop.example.com/orders" }, actions: [
      { kind: "click", from: "r2" }, { kind: "read", from: "r3" }, { kind: "readTable", from: "r4", output: "rows" }, { kind: "click", label: "새 단추" },
    ] } }], edges: [] };
    const b = build(flow, refs as never);
    expect(b.problems).toEqual([]);
    const acts = b.flow!.nodes[0]!.type === "web" ? b.flow!.nodes[0]!.config.actions : [];
    expect(acts[0]).toMatchObject({ kind: "click", target: { label: "로그인", locators: [{ kind: "css", value: "button[type=submit]" }] } });
    expect(acts[1]).toMatchObject({ kind: "read", output: "status", target: { locators: [{ value: "#order-status" }] } });
    expect(acts[2]).toMatchObject({ kind: "readTable", output: "rows", table: { rows: { locators: [{ value: "#orders tr" }] } } });
    expect(b.todo).toEqual(["읽기 › 새 단추"]);
    const bad = build({ ...flow, nodes: [{ ...flow.nodes[0]!, config: { ...flow.nodes[0]!.config, actions: [{ kind: "click", from: "r99" }] } }] }, refs as never);
    expect(bad.flow).toBeNull();
    expect(bad.problems.join()).toMatch(/r99.*목록에 없습니다/);
  });
  it("사이트 이름 — 글의 주소 · 도메인과 초안의 시작 주소(변수를 풀어)", () => {
    const draft = { nodes: [{ type: "web", config: { start: { kind: "url", url: "{{ $vars.site }}/login" } } }], vars: { site: "https://portal.corp.example.kr" } } as unknown as Flow;
    expect(hostsOf("admin.shop.example.com 에서 주문 상태 읽어줘 https://www.iana.org/x", draft)).toEqual(["admin.shop.example.com", "www.iana.org", "portal.corp.example.kr"]);
  });
  it("★같은 사이트의 녹화를 찾아 설명서에 보이고 · AI가 from으로 다시 쓴다", async () => {
    const asked: string[][] = [];
    const calls: { system: string }[] = [];
    const replies: ModelReply[] = [
      { content: [{ type: "tool_use", id: "t1", name: "propose_flow", input: { summary: "상태 읽기", flow: { name: "상태", nodes: [{ id: "w", type: "web", name: "읽기", config: { start: { kind: "url", url: "https://admin.shop.example.com/orders" }, actions: [{ kind: "read", from: "r3" }] } }], edges: [] } } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "만들었습니다" }], stop_reason: "end_turn" },
    ];
    const send = (async (req: { system: string; messages: Message[] }) => { calls.push({ system: req.system }); return replies.shift()!; }) as unknown as Send;
    const t = await ask(send, [], "admin.shop.example.com 주문 상태를 읽는 워크플로우", { draft: null, extensions: [], flows: [], newId: "n", siteFlows: async (h) => { asked.push(h); return SITE; } });
    expect(asked).toEqual([["admin.shop.example.com"]]);
    expect(calls[0]!.system).toContain("r3 — 주문 조회 › 로그인 · 읽기 · read «주문 상태» → status");
    expect(t.proposal?.todo).toEqual([]);
    const a = t.proposal!.flow.nodes[0]!.type === "web" ? t.proposal!.flow.nodes[0]!.config.actions[0] : null;
    expect(a).toMatchObject({ kind: "read", output: "status", target: { locators: [{ value: "#order-status" }] } });
  });
});

describe("사이트 보기 — open_page · from p…", () => {
  const VIEW = {
    url: "https://admin.shop.example.com/login", title: "로그인",
    elements: [
      { kind: "input" as const, label: "'아이디' 칸", target: tgt("'아이디' 칸", "#uid") },
      { kind: "input" as const, label: "'비밀번호' 칸", target: tgt("'비밀번호' 칸", "#pw") },
      { kind: "button" as const, label: "'로그인' 버튼", target: tgt("'로그인' 버튼", "button[type=submit]") },
    ],
    shot: "AAAA",
  };
  it("★관리자가 켰을 때만 도구가 있다 · 연 화면의 요소(p1 …)를 from으로 쓰면 위치가 들어간다 · 다음 말에 넘긴다", async () => {
    const opened: string[] = [];
    const tools: string[][] = [];
    const steps: string[] = [];
    const replies: ModelReply[] = [
      { content: [{ type: "tool_use", id: "o1", name: "open_page", input: { url: "https://admin.shop.example.com/login" } }], stop_reason: "tool_use" },
      { content: [{ type: "tool_use", id: "p1", name: "propose_flow", input: { summary: "로그인", flow: { name: "로그인", secrets: [{ name: "shop", kind: "login" }], nodes: [{ id: "w", type: "web", name: "로그인", config: { start: { kind: "url", url: "https://admin.shop.example.com/login" }, actions: [
        { kind: "fill", from: "p1", value: "{{ $secrets.shop.username }}" }, { kind: "fill", from: "p2", value: "{{ $secrets.shop.password }}" }, { kind: "click", from: "p3" },
      ] } }], edges: [] } } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "로그인 노드를 만들었습니다" }], stop_reason: "end_turn" },
    ];
    let toolResult = "";
    const send = (async (req: { messages: Message[]; tools: { name: string }[] }) => {
      tools.push(req.tools.map((t) => t.name));
      const last = req.messages.at(-1);
      if (last && Array.isArray(last.content) && last.content[0]?.type === "tool_result" && !toolResult) toolResult = last.content[0].content;
      return replies.shift()!;
    }) as unknown as Send;
    const t = await ask(send, [], "admin.shop.example.com 로그인 노드를 만들어줘", {
      draft: null, extensions: [], flows: [], newId: "n",
      browse: { open: async (u) => { opened.push(u); return VIEW; }, look: async () => VIEW },
    }, { onStep: (s) => steps.push(s.kind) });
    expect(tools[0]).toEqual(["propose_flow", "open_page", "look_page"]);
    expect(opened).toEqual(["https://admin.shop.example.com/login"]);
    expect(toolResult).toContain("p3 — 화면 «로그인» · click «'로그인' 버튼»");
    expect(steps).toContain("look");
    expect(t.proposal?.todo).toEqual([]);
    const acts = t.proposal!.flow.nodes[0]!.type === "web" ? t.proposal!.flow.nodes[0]!.config.actions : [];
    expect(acts.map((a) => ("target" in a && a.target ? a.target.locators[0]?.value : null))).toEqual(["#uid", "#pw", "button[type=submit]"]);
    expect(t.pageRefs.map((r) => r.ref)).toEqual(["p1", "p2", "p3"]);
    // 켜지 않았으면 도구도 없고 설명서도 «볼 수 없음»
    const s = systemPrompt({ draft: null, extensions: [], flows: [] });
    expect(s).toContain("관리자가 켜지 않았습니다");
  });
});
