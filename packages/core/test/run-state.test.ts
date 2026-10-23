import { describe, expect, it } from "vitest";
import { compile, parseFlow, RunState, RunStateError } from "../src/index.ts";
import { cond, custom, edge, example, flow } from "./fixtures.ts";

const stateOf = (json: unknown) => new RunState(compile(parseFlow(json)));

describe("실행 상태", () => {
  it("곧은 워크플로우 — 순서대로 돌고 마지막 노드의 출력이 결과다", () => {
    const st = stateOf(flow([custom("a"), custom("b")], [edge("e1", "a", "b")]));
    const j1 = st.next()!;
    expect(j1.nodeId).toBe("a");
    expect(j1.input).toEqual({});
    st.succeed("a", { x: 1 });
    const j2 = st.next()!;
    expect(j2.input).toEqual({ x: 1 });
    st.succeed("b", { y: 2 });
    expect(st.next()).toBeNull();
    expect(st.outcome).toEqual({ status: "success", message: "", output: { y: 2 } });
    expect(st.outputs).toEqual({ a: { x: 1 }, b: { y: 2 } });
  });

  it("★한 번에 하나씩 — 앞 노드를 끝내지 않고 다음을 달라면 던진다", () => {
    const st = stateOf(flow([custom("a"), custom("b")], []));
    st.next();
    expect(() => st.next()).toThrow(RunStateError);
  });

  it("고르지 않은 갈래 뒤는 건너뛰고, 합류 노드는 값을 받은 쪽으로 돈다", () => {
    //        ┌ yes → x ┐
    //  a → c ┤         ├ j
    //        └ else→ y ┘
    const st = stateOf(flow([custom("a", ["v"]), cond("c", [{ id: "yes" }]), custom("x"), custom("y"), custom("j")], [
      edge("e0", "a", "c"), edge("e1", "c", "x", "yes"), edge("e2", "c", "y", "else"), edge("e3", "x", "j"), edge("e4", "y", "j"),
    ]));
    st.next(); st.succeed("a", { v: "no" });
    const c = st.next()!;
    st.succeed("c", c.input, "else");
    const y = st.next()!;
    expect(y.nodeId).toBe("y");
    expect(st.status("x")).toBe("skipped");
    st.succeed("y", { from: "y" });
    const j = st.next()!;
    expect(j.nodeId).toBe("j");
    expect(j.input).toEqual({ from: "y" });
    st.succeed("j", { done: true });
    expect(st.next()).toBeNull();
    expect(st.outcome).toMatchObject({ status: "success", output: { done: true } });
  });

  it("들어오는 엣지가 전부 건너뛰어지면 그 노드도, 그 뒤도 건너뛴다", () => {
    //        ┌ yes → x → z
    //  a → c ┤
    //        └ else→ y
    const st = stateOf(flow([custom("a", ["v"]), cond("c", [{ id: "yes" }]), custom("x"), custom("z"), custom("y")], [
      edge("e0", "a", "c"), edge("e1", "c", "x", "yes"), edge("e2", "x", "z"), edge("e3", "c", "y", "else"),
    ]));
    st.next(); st.succeed("a", { v: 1 });
    st.next(); st.succeed("c", { v: 1 }, "else");
    expect(st.next()!.nodeId).toBe("y");
    st.succeed("y", { r: 1 });
    expect(st.next()).toBeNull();
    expect([st.status("x"), st.status("z")]).toEqual(["skipped", "skipped"]);
    expect(st.outcome).toMatchObject({ status: "success", output: { r: 1 } });
  });

  it("★«종료» 갈래를 고르면 그 상태로 끝나고 남은 노드는 돌지 않는다", () => {
    const j = example();
    const st = stateOf(j);
    st.next(); st.succeed("login", { userName: "홍" });
    st.next(); st.succeed("search", { status: "취소", amount: "1,000" });
    const c = st.next()!;
    expect(c.input).toEqual({ status: "취소", amount: "1,000" });
    st.succeed("check", c.input, "cancelled");
    expect(st.next()).toBeNull();
    expect(st.outcome).toEqual({ status: "failure", message: "취소된 주문입니다", failedNode: null });
    expect(st.status("shape")).toBe("cancelled");
  });

  it("노드가 실패하면 워크플로우가 실패하고 남은 노드는 cancelled", () => {
    const st = stateOf(flow([custom("a"), custom("b"), custom("c")], [edge("e1", "a", "b")]));
    st.next(); st.fail("a", "요소를 못 찾았습니다");
    expect(st.next()).toBeNull();
    expect(st.outcome).toEqual({ status: "failure", message: "요소를 못 찾았습니다", failedNode: "a" });
    expect([st.status("b"), st.status("c")]).toEqual(["cancelled", "cancelled"]);
  });

  it("조건 노드에 없는 갈래를 주면 던진다", () => {
    const st = stateOf(flow([custom("a", ["v"]), cond("c", [{ id: "yes" }]), custom("x"), custom("y")],
      [edge("e0", "a", "c"), edge("e1", "c", "x", "yes"), edge("e2", "c", "y", "else")]));
    st.next(); st.succeed("a", { v: 1 });
    st.next();
    expect(() => st.succeed("c", {}, "maybe")).toThrow(/maybe/);
  });

  it("문제가 있는 워크플로우로는 만들 수 없다", () => {
    const f = parseFlow(flow([custom("a")], []));
    const c = compile(f);
    c.problems.push("가짜 문제");
    expect(() => new RunState(c)).toThrow(RunStateError);
  });
});
