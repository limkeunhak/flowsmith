/**
 * 승인 기다리기(2026-10-18) — 엔진 쪽: 묻고 · 승인이면 받은 값 + 누가 · 거절 · 시간 넘김 · 멈춤 · 물을 곳이 없으면 멈춤.
 * ★누가 승인하는지(역할)는 서버의 일이다(server/test/priority2.test.ts).
 */
import { describe, expect, it } from "vitest";
import { parseFlow, type ApprovalNode } from "@flowsmith/core";
import { runApprovalNode, runFlow, type ApprovalAsk, type RunEvent } from "../src/index.ts";

const pos = { x: 0, y: 0 };
const flow = () => parseFlow({
  schemaVersion: 1, id: "ap", name: "승인",
  nodes: [
    { id: "a", type: "custom", name: "앞", position: pos, config: { code: "return { n: 7 };", outputs: ["n"] } },
    { id: "ok", type: "approval", name: "결재", position: pos, config: { message: "{{ $input.n }}건 제출?", minRole: "editor", timeoutMin: 3 } },
    { id: "b", type: "custom", name: "뒤", position: pos, config: { code: "return { n: input.n, by: input.by };", outputs: ["n", "by"] } },
  ],
  edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "ok" } }, { id: "e2", from: { node: "ok", port: "out" }, to: { node: "b" } }],
});

describe("승인 기다리기", () => {
  it("★묻는다(안내 · 역할 · 언제까지) → 승인하면 받은 값 + 누가로 이어 간다", async () => {
    const asks: ApprovalAsk[] = [];
    const events: RunEvent[] = [];
    const r = await runFlow(flow(), {
      approval: async (a) => { asks.push(a); return { approved: true, by: "kim@x.com", comment: "좋아요" }; },
      onEvent: (e) => events.push(e),
    });
    expect(r.status).toBe("success");
    expect(r.output).toEqual({ n: 7, by: "kim@x.com" });
    expect(asks).toEqual([expect.objectContaining({ nodeId: "ok", message: "7건 제출?", minRole: "editor" })]);
    const left = new Date(asks[0]!.deadline).getTime() - Date.now();
    expect(left).toBeGreaterThan(2.5 * 60_000);
    expect(left).toBeLessThanOrEqual(3 * 60_000);
    expect(events.filter((e) => e.kind === "approval").map((e) => e.kind === "approval" && e.state)).toEqual(["waiting", "approved"]);
  });

  it("★거절 → 그 노드가 실패(뒤는 돌지 않는다) · 물을 곳이 없으면(CLI) 바로 멈춘다", async () => {
    const r = await runFlow(flow(), { approval: async () => ({ approved: false, by: "lee@x.com", comment: "금액 확인" }) });
    expect(r.status).toBe("failure");
    expect(r.nodes.find((n) => n.id === "ok")!.failure!.message).toBe("lee@x.com이(가) 거절했습니다 — 금액 확인");
    expect(r.nodes.find((n) => n.id === "b")!.status).not.toBe("succeeded");
    const none = await runFlow(flow());
    expect(none.nodes.find((n) => n.id === "ok")!.failure!.message).toMatch(/승인을 받을 수 없습니다/);
  });

  it("★멈추기 — 기다리던 승인을 그만두고(묻던 쪽에 signal) 결과는 «멈춤»", async () => {
    const stop = new AbortController();
    let asked: ApprovalAsk | null = null;
    const r = await runFlow(flow(), {
      signal: stop.signal,
      approval: (a) => { asked = a; setTimeout(() => stop.abort(), 30); return new Promise(() => undefined); },
    });
    expect(r.status).toBe("cancelled");
    expect(asked!.signal.aborted).toBe(true);
  });

  it("★시간을 넘기면 실패 — 아무도 답하지 않았다", async () => {
    const node = { id: "ok", type: "approval", name: "결재", position: pos, config: { message: "제출?", minRole: "runner", timeoutMin: 0.001 } } as ApprovalNode;
    const states: string[] = [];
    await expect(runApprovalNode(node, { input: {}, nodes: {}, params: {}, vars: {}, secrets: {} }, () => new Promise(() => undefined), () => undefined, new AbortController().signal, (s) => states.push(s)))
      .rejects.toThrow(/안에 아무도 승인하지 않았습니다/);
    expect(states).toEqual(["waiting", "timeout"]);
  });

  it("★검문소 — 기다리는 시간(1분~7일) · 역할 · 안내", () => {
    const bad = (config: unknown) => () => parseFlow({ schemaVersion: 1, id: "x", name: "x", nodes: [{ id: "ok", type: "approval", name: "결재", position: pos, config }], edges: [] });
    expect(bad({ message: "a", minRole: "editor", timeoutMin: 0 })).toThrow();
    expect(bad({ message: "a", minRole: "editor", timeoutMin: 7 * 24 * 60 + 1 })).toThrow();
    expect(bad({ message: "a", minRole: "viewer", timeoutMin: 5 })).toThrow();
    expect(bad({ message: "", minRole: "editor", timeoutMin: 5 })).toThrow();
  });
});
