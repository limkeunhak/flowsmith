/**
 * 막힘 갈래(2026-10-19) — 웹페이지 노드의 «고르면 안 되는 행»에 걸리면 가는 출력.
 *   포트는 막는 행이 있을 때만 · 막힘 갈래 뒤는 받은 값 + blockedReason만 · RunState.block → 끝나면 «막힘»
 */
import { describe, expect, it } from "vitest";
import { blockRules, compile, outPorts, parseFlow, RunState, type FlowNode } from "../src/index.ts";
import { custom, edge, flow, target, web } from "./fixtures.ts";

const pick = (refuse: unknown) => ({ id: "p1", kind: "pickRow", pick: { label: "목록", rows: target("행", "#t > tbody > tr"), keyColumn: "td:nth-child(2)", keyLabel: "번호", value: "x", click: "", refuse } });
const guarded = () => web("w", { config: { start: { kind: "url", url: "http://x" }, actions: [pick({ column: "td:nth-child(5)", values: ["주문확정"], reason: "확정된 건" }), { id: "r", kind: "read", output: "amount", target: target() }] } });

describe("막힘 갈래", () => {
  it("포트 — 막는 행이 있을 때만", () => {
    const f = parseFlow(flow([custom("a", ["orderNo"]), guarded()], [edge("e1", "a", "w")]));
    const w = f.nodes[1] as FlowNode;
    expect(outPorts(w)).toEqual(["out", "blocked"]);
    expect(blockRules(w)).toEqual([{ values: ["주문확정"], reason: "확정된 건" }]);
    const plain = parseFlow(flow([web("v")], []));
    expect(outPorts(plain.nodes[0]!)).toEqual(["out"]);
    expect(() => parseFlow(flow([web("v"), custom("x")], [edge("e1", "v", "x", "blocked")]))).toThrow(/"blocked" 포트가 없습니다/);
  });

  it("★막힘 갈래 뒤는 받은 값 + blockedReason — 그 노드가 읽은 것은 없다", () => {
    const j = flow([custom("a", ["orderNo"]), guarded(), custom("ok"), custom("skip")], [edge("e1", "a", "w"), edge("e2", "w", "ok"), edge("e3", "w", "skip", "blocked")]);
    const c = compile(parseFlow(j));
    expect([...c.outputs.get("w")!]).toEqual(["amount"]);
    // 검문소 — 막힘 갈래 뒤에서 그 노드의 읽기를 쓰면 문제
    const bad = JSON.parse(JSON.stringify(j));
    bad.nodes.push({ id: "t", type: "transform", name: "t", position: { x: 0, y: 0 }, config: { steps: [], source: "{{ $input.amount }}" } });
    bad.edges.push(edge("e4", "w", "t", "blocked"));
    expect(() => parseFlow(bad)).toThrow(/amount/);
  });

  it("★RunState.block — 막힘 갈래로만 넘기고 정상 갈래는 건너뛴다 · 끝나면 «막힘»", () => {
    const st = new RunState(compile(parseFlow(flow([custom("a", ["orderNo"]), guarded(), custom("ok"), custom("skip")], [edge("e1", "a", "w"), edge("e2", "w", "ok"), edge("e3", "w", "skip", "blocked")]))));
    st.next(); st.succeed("a", { orderNo: "A-2" });
    const w = st.next()!;
    st.block("w", { ...w.input, blockedReason: "확정된 건" }, "blocked", "확정된 건");
    expect(st.status("w")).toBe("blocked");
    const s = st.next()!;
    expect(s.nodeId).toBe("skip");
    expect(s.input).toEqual({ orderNo: "A-2", blockedReason: "확정된 건" });
    expect(st.status("ok")).toBe("skipped");
    st.succeed("skip", { logged: true });
    expect(st.next()).toBeNull();
    expect(st.outcome).toEqual({ status: "blocked", message: "확정된 건", blockedNode: "w", output: { logged: true } });
  });

  it("★성공하면 막힘 갈래는 건너뛴다 — 정상 갈래로만", () => {
    const st = new RunState(compile(parseFlow(flow([guarded(), custom("ok"), custom("skip")], [edge("e2", "w", "ok"), edge("e3", "w", "skip", "blocked")]))));
    st.next(); st.succeed("w", { amount: 1 });
    expect(st.next()!.nodeId).toBe("ok");
    st.succeed("ok", { done: 1 });
    expect(st.next()).toBeNull();
    expect(st.status("skip")).toBe("skipped");
    expect(st.outcome).toEqual({ status: "success", message: "", output: { done: 1 } });
  });
});
