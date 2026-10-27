/**
 * 여기서부터 다시(core resume.ts) — 앞 단계는 지난 출력 · 브라우저 화면이 필요하면 앞 웹페이지는 다시 · 가린 값은 다시 · 끝나지 않은 앞 단계면 못 한다.
 */
import { describe, expect, it } from "vitest";
import { parseFlow, planResume, ResumeError, type ResumeSource } from "../src/index.ts";

const pos = { x: 0, y: 0 };
const web = (id: string, start: unknown) => ({ id, type: "web", name: id, position: pos, config: { start, actions: [{ id: `${id}-w`, kind: "wait", wait: { kind: "fixed", ms: 1 } }] } });
const code = (id: string, usesPage = false) => ({ id, type: "custom", name: id, position: pos, config: { code: "return {};", outputs: [], usesPage } });
const edge = (a: string, b: string) => ({ id: `${a}-${b}`, from: { node: a, port: "out" }, to: { node: b } });
const flowOf = (nodes: unknown[], edges: unknown[]) => parseFlow({ schemaVersion: 1, id: "f", name: "f", nodes, edges });
const ok = (id: string, output: Record<string, unknown> = { [id]: 1 }): ResumeSource => ({ id, status: "succeeded", output });

describe("planResume", () => {
  it("★그 단계와 뒤는 돌고 · 앞은 지난 출력(웹 화면이 필요 없으면 웹페이지도 안 돈다)", () => {
    const f = flowOf([web("login", { kind: "url", url: "https://x.example" }), code("list"), code("csv"), code("pdf"), code("judge")],
      [edge("login", "list"), edge("list", "csv"), edge("csv", "pdf"), edge("pdf", "judge")]);
    const p = planResume(f, [ok("login"), ok("list"), ok("csv"), { id: "pdf", status: "failed", output: null }, { id: "judge", status: "pending", output: null }], "pdf");
    expect(p).toEqual({ from: "pdf", pins: { login: { login: 1 }, list: { list: 1 }, csv: { csv: 1 } }, again: [] });
  });
  it("★뒤에 앞 화면을 이어 쓰는 노드가 있으면 — 앞의 웹페이지 조상은 다시(화면을 다시 만든다) · 웹이 아닌 것은 지난 출력", () => {
    const f = flowOf([web("login", { kind: "url", url: "https://x.example" }), web("open", { kind: "continue" }), code("list", true), code("csv"), web("pdf", { kind: "continue" })],
      [edge("login", "open"), edge("open", "list"), edge("list", "csv"), edge("csv", "pdf")]);
    const p = planResume(f, ["login", "open", "list", "csv"].map((id) => ok(id)), "pdf");
    expect(p.again).toEqual([{ id: "login", why: "browser" }, { id: "open", why: "browser" }]);
    expect(Object.keys(p.pins)).toEqual(["list", "csv"]);
    // 페이지를 쓰는 커스텀부터도 같다
    expect(planResume(f, ["login", "open"].map((id) => ok(id)), "list").again.map((x) => x.id)).toEqual(["login", "open"]);
  });
  it("가린 값(개인정보)이 있는 출력은 쓰지 않고 다시 돈다", () => {
    const f = flowOf([code("a"), code("b"), code("c")], [edge("a", "b"), edge("b", "c")]);
    const p = planResume(f, [ok("a", { name: "«가림»" }), ok("b")], "c", (o) => JSON.stringify(o).includes("«가림»"));
    expect(p).toEqual({ from: "c", pins: { b: { b: 1 } }, again: [{ id: "a", why: "masked" }] });
  });
  it("★앞 단계가 그 실행에서 끝나지 않았으면 · 단계가 없어졌으면 못 한다", () => {
    const f = flowOf([code("a"), code("b"), code("c")], [edge("a", "b"), edge("b", "c")]);
    expect(() => planResume(f, [ok("a"), { id: "b", status: "failed", output: null }], "c")).toThrow(/앞 단계 «b»가 그 실행에서 끝나지 않아/);
    expect(() => planResume(f, [ok("a")], "없음")).toThrow(ResumeError);
    // 첫 단계부터면 고정할 것이 없다 — 처음부터와 같다
    expect(planResume(f, [], "a")).toEqual({ from: "a", pins: {}, again: [] });
  });
});
