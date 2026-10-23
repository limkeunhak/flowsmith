import { describe, expect, it } from "vitest";
import { checkFlow, FlowError, parseFlow } from "../src/index.ts";
import { cond, custom, edge, example, flow, target, web } from "./fixtures.ts";

const problemsOf = (json: unknown): string[] => {
  try { parseFlow(json); return []; } catch (e) { if (e instanceof FlowError) return [...e.problems]; throw e; }
};
const hasProblem = (json: unknown, re: RegExp) => expect(problemsOf(json).some((p) => re.test(p)), problemsOf(json).join("\n")).toBe(true);

describe("검문소 — 모양", () => {
  it("예시 워크플로우가 통과하고 빠진 칸은 기본값이 채워진다", () => {
    const f = parseFlow(example());
    expect(f.nodes.map((n) => n.id)).toEqual(["login", "search", "check", "shape"]);
    const login = f.nodes[0]!;
    if (login.type !== "web") throw new Error();
    expect(login.config.actions[0]!.risk).toBe("safe");
    expect(login.config.actions[0]!.timeoutMs).toBeNull();
  });

  it("★문제를 하나씩이 아니라 한꺼번에 모은다", () => {
    const j = example();
    j.schemaVersion = 2;
    j.nodes[0].type = "webpage";
    j.nodes[1].config.actions[1].kind = "type";
    j.edges[0].id = "1bad";
    const ps = problemsOf(j);
    expect(ps.length).toBeGreaterThanOrEqual(4);
    expect(ps.join("\n")).toMatch(/schemaVersion/);
    expect(ps.join("\n")).toMatch(/webpage/);
    expect(ps.join("\n")).toMatch(/"type"/);
    expect(ps.join("\n")).toMatch(/1bad/);
  });

  it("★매니페스트에 시크릿 값을 넣으면 거부한다", () => {
    const j = example();
    j.secrets[0].password = "hunter2";
    hasProblem(j, /시크릿 값을 넣지 않습니다/);
  });

  it("위치가 하나도 없는 요소는 거부한다", () => {
    const j = example();
    j.nodes[0].config.actions[2].target.locators = [];
    hasProblem(j, /위치가 하나도 없습니다/);
  });

  it("정규식이 틀린 금지 버튼은 거부한다", () => {
    const j = example();
    j.settings.forbiddenLabels.push("(");
    hasProblem(j, /정규식이 틀렸습니다/);
  });

  it("출력 이름이 겹치면 거부한다", () => {
    const j = example();
    j.nodes[1].config.actions[4].output = "status";
    hasProblem(j, /출력 이름 "status"가 두 번/);
  });

  it("이름에 점이나 공백을 쓰면 거부한다 — 표현식에 그대로 들어가기 때문이다", () => {
    const j = example();
    j.nodes[1].config.actions[3].output = "order status";
    hasProblem(j, /글자 · 숫자 · _ 만/);
  });

  it("단항 연산에 오른쪽 값이 있거나, 이항 연산에 없으면 거부한다", () => {
    const j = example();
    j.nodes[2].config.cases[0].rules.push({ left: "{{ $input.status }}", op: "empty", right: "x" });
    j.nodes[2].config.cases[0].rules.push({ left: "{{ $input.status }}", op: "gt", right: null });
    hasProblem(j, /empty는 오른쪽 값을 쓰지 않습니다/);
    hasProblem(j, /gt에는 오른쪽 값이 있어야/);
  });

  it("갈래 id로 예약된 포트 이름은 못 쓴다", () => {
    hasProblem(flow([custom("a", ["v"]), cond("c", [{ id: "else" }])], [edge("e1", "a", "c")]), /예약된 포트/);
  });

  it("attribute 읽기에는 속성 이름이 있어야 한다", () => {
    const j = flow([web("a")], []);
    (j.nodes[0] as any).config.actions[0].strategy = "attribute";
    hasProblem(j, /attribute\(속성 이름\)/);
  });

  it("checkFlow는 던지지 않고 문제만 돌려준다", () => {
    expect(checkFlow(example())).toEqual([]);
    expect(checkFlow({})).not.toEqual([]);
  });

  it("모양이 틀리면 의미 검사는 하지 않는다", () => {
    // 모양 문제(타입) + 의미 문제(순환)가 같이 있어도 모양 문제만 나온다
    const j = flow([web("a"), { ...web("b"), type: "nope" }], [edge("e1", "a", "b"), edge("e2", "b", "a")]);
    const ps = problemsOf(j);
    expect(ps.some((p) => /nope/.test(p))).toBe(true);
    expect(ps.some((p) => /순환/.test(p))).toBe(false);
  });

  it("고정 대기에는 ms가 있어야 한다", () => {
    const j = flow([web("a")], []);
    (j.nodes[0] as any).config.actions.push({ id: "w", kind: "wait", wait: { kind: "fixed" } });
    hasProblem(j, /ms가 없습니다/);
  });

  it("확장 노드 — id 모양 · 출력 이름 · 값은 표현식(시크릿은 안 된다)", () => {
    const ext = (config: Record<string, unknown>) => flow([custom("a", ["orderNo"]), { id: "x", type: "extension", name: "x", position: { x: 0, y: 0 }, config }], [edge("e1", "a", "x")]);
    expect(problemsOf(ext({ extension: "shop.order-read", options: { orderNo: "{{ $input.orderNo }}" }, outputs: ["values"] }))).toEqual([]);
    hasProblem(ext({ extension: "Shop Read", options: {}, outputs: [] }), /소문자/);
    hasProblem(ext({ extension: "a.b", options: {}, outputs: ["a b"] }), /글자 · 숫자/);
    hasProblem(ext({ extension: "a.b", options: { k: "{{ $input.nope }}" }, outputs: [] }), /"nope"를 내놓지 않습니다/);
    hasProblem(ext({ extension: "a.b", options: { k: "{{ $secrets.x }}" }, outputs: [] }), /시크릿/);
  });

  it("«사람이 연 탭에서»는 attach 모드에서만", () => {
    const j = flow([web("a")], []);
    (j.nodes[0] as any).config.start = { kind: "tab", match: "hi.co.kr" };
    hasProblem(j, /사람의 브라우저에 붙기/);
    (j as any).settings = { browser: "attach" };
    expect(problemsOf(j)).toEqual([]);
  });

  it("press는 요소 없이도 된다", () => {
    const j = flow([web("a")], []);
    (j.nodes[0] as any).config.actions.push({ id: "p", kind: "press", key: "Enter" }, { id: "p2", kind: "press", key: "Tab", target: target() });
    expect(problemsOf(j)).toEqual([]);
  });
});
