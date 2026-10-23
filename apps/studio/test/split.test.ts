/**
 * 웹페이지 노드 나누기(model/split.ts · 2026-10-22) — 사람 기다리기마다 · 여기서 · 이어진 노드는 읽은 값도 넘긴다.
 * ★원래 id는 마지막 조각 — 뒤 선 · {{ $node.원래.x }}가 그대로 맞는다. 들어오던 선은 첫 조각으로.
 */
import { describe, expect, it } from "vitest";
import { checkFlow, type Flow, type Target, type WebAction, type WebNode } from "@flowsmith/core";
import { canSplitStages, guideItems, newNode, normalize, outputsOf, splitStages, splitWebNode, stageCuts, subtitleOf, webFace } from "../src/model/index.ts";

const t = (label: string): Target => ({ label, locators: [{ kind: "css", value: `#${label}` }], fingerprint: null, frames: [], verifiedAt: null });
const base = { risk: "safe" as const, timeoutMs: null, optional: false };
const human = (id: string): WebAction => ({ ...base, id, kind: "human", prompt: "로그인해 주세요", appears: null, done: { kind: "url", pattern: "^https://portal\\.example/home" } });
const click = (id: string): WebAction => ({ ...base, id, kind: "click", target: t(id), popup: false });
const read = (id: string, output: string): WebAction => ({ ...base, id, kind: "read", target: t(id), output, strategy: "auto", attribute: null, transform: null });

/** 시작 → [웹: 사람 · 클릭 · 읽기(orders) · 사람 · 읽기(amount)] → 파일 쓰기(orders · amount을 쓴다) */
const flow = (): Flow => normalize({
  id: "f", name: "가나상회 주문",
  nodes: [
    { id: "web1", type: "web", name: "주문 읽기", position: { x: 100, y: 0 }, config: { start: { kind: "url", url: "https://portal.example" }, actions: [human("h1"), click("c1"), read("r1", "orders"), human("h2"), read("r2", "amount")] } },
    { id: "save", type: "fileWrite", name: "저장", position: { x: 400, y: 0 }, config: { data: "{{ $input.orders }} {{ $input.amount }} {{ $node.web1.orders }}", target: { name: "주문", format: "csv" } } },
  ],
  edges: [{ id: "e1", from: { node: "web1", port: "out" }, to: { node: "save" } }],
});
const web = (f: Flow, id: string) => f.nodes.find((n) => n.id === id) as WebNode;

describe("웹페이지 노드 나누기", () => {
  it("★사람 기다리기마다 — 페이지 접속 → 사람 기다리기 → 주문 읽기(1) → 사람 기다리기 → 주문 읽기(2)", () => {
    const f = flow();
    expect(stageCuts(web(f, "web1"))).toEqual([0, 1, 3, 4]);
    expect(checkFlow(f)).toEqual([]);
    const r = splitStages(f, "web1");
    expect(r.ids).toHaveLength(5);
    expect(r.ids.at(-1)).toBe("web1");   // 원래 id는 마지막 조각
    const parts = r.ids.map((id) => web(r.flow, id));
    expect(parts.map((p) => p.name)).toEqual(["페이지 접속", "사람 기다리기", "주문 읽기 (1)", "사람 기다리기", "주문 읽기 (2)"]);
    expect(parts.map((p) => p.config.start.kind)).toEqual(["url", "continue", "continue", "continue", "continue"]);
    expect(parts.map((p) => p.config.actions.map((a) => a.id))).toEqual([[], ["h1"], ["c1", "r1"], ["h2"], ["r2"]]);
    expect(parts.map((p) => webFace(p))).toEqual(["open", "human", null, "human", null]);
    // 선 — 조각끼리 차례로 · 뒤로 나가는 선은 그대로(마지막 조각 = web1)
    const chain = r.ids.slice(0, -1).map((id, i) => [id, r.ids[i + 1]]);
    for (const [a, b] of chain) expect(r.flow.edges.some((e) => e.from.node === a && e.to.node === b)).toBe(true);
    expect(r.flow.edges.find((e) => e.id === "e1")).toEqual({ id: "e1", from: { node: "web1", port: "out" }, to: { node: "save" } });
    // ★앞 조각에서 읽은 plans가 뒤로 이어진다 — $input · $node 모두 문제 없음
    expect(checkFlow(r.flow)).toEqual([]);
    expect(outputsOf(r.flow, "web1").sort()).toEqual(["amount", "orders"]);
    // 위치 — 오른쪽으로 늘어놓고 뒤 노드는 민다
    expect(parts.map((p) => p.position.x)).toEqual([100, 340, 580, 820, 1060]);
    expect(r.flow.nodes.find((n) => n.id === "save")!.position.x).toBe(400 + 4 * 240);
    // 원래 초안은 그대로
    expect(web(f, "web1").config.actions).toHaveLength(5);
  });

  it("★여기서 나누기 — 들어오던 선은 첫 조각으로 · 나눌 곳이 없으면 그대로", () => {
    const f = flow();
    const cont = (n: Flow["nodes"][number]): Flow["nodes"][number] => (n.id === "web1" ? { ...(n as WebNode), config: { ...(n as WebNode).config, start: { kind: "continue" } } } : n);
    const g: Flow = { ...f, nodes: [{ id: "web0", type: "web", name: "앞", position: { x: -200, y: 0 }, config: { start: { kind: "url", url: "https://a" }, actions: [click("x")] } }, ...f.nodes.map(cont)], edges: [{ id: "e0", from: { node: "web0", port: "out" }, to: { node: "web1" } }, ...f.edges] };
    const r = splitWebNode(g, "web1", [2]);
    expect(r.ids).toEqual(["web2", "web1"]);
    expect(r.flow.edges.find((e) => e.id === "e0")!.to.node).toBe("web2");
    expect(web(r.flow, "web2").config.actions.map((a) => a.id)).toEqual(["h1", "c1"]);
    expect(web(r.flow, "web1").config.actions.map((a) => a.id)).toEqual(["r1", "h2", "r2"]);
    expect(checkFlow(r.flow)).toEqual([]);
    // 앞 페이지에서 이어서 시작하는 노드는 맨 앞(0)에서 못 자른다 · 끝(동작 수)도 못 자른다
    expect(splitWebNode(g, "web1", [0, 5]).ids).toEqual(["web1"]);
    expect(stageCuts(web(g, "web1"))).toEqual([1, 3, 4]);
  });

  it("사람 기다리기가 없으면 단계로 나눌 곳이 없다 · 막힘 갈래는 막을 행을 가진 조각에서", () => {
    const f = normalize({ id: "f", name: "f", nodes: [{ id: "w", type: "web", name: "웹", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://a" }, actions: [click("a")] } }], edges: [] });
    expect(canSplitStages(f.nodes[0]!)).toBe(false);
    const pick: WebAction = { ...base, id: "p", kind: "pickRow", pick: { label: "목록", rows: t("rows"), keyColumn: "td", keyLabel: "상태", value: "x", click: "", refuse: { column: "td", values: ["구매확정"], reason: "막힘" }, by: "key" } as never };
    const g = normalize({ id: "g", name: "g", nodes: [
      { id: "w", type: "web", name: "웹", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://a" }, actions: [pick, human("h"), click("z")] } },
      { id: "b", type: "fileWrite", name: "막힌 건", position: { x: 300, y: 100 }, config: { data: "{{ $input.reason }}", target: { name: "막힘", format: "csv" } } },
    ], edges: [{ id: "eb", from: { node: "w", port: "blocked" }, to: { node: "b" } }] });
    const r = splitStages(g, "w");
    expect(r.ids).toHaveLength(3);
    expect(r.flow.edges.find((e) => e.id === "eb")!.from.node).toBe(r.ids[0]);   // 행 고르기가 든 첫 조각
  });

  it("★노드 고르기의 «사람 기다리기» — 사람 기다리기 하나만 든 웹페이지 노드(앞 페이지에서 이어서) · 타일 설명", () => {
    const f = flow();
    const n = newNode("human", f, { x: 0, y: 0 }) as WebNode;
    expect(n).toMatchObject({ type: "web", name: "사람 기다리기", config: { start: { kind: "continue" } } });
    expect(n.config.actions.map((a) => a.kind)).toEqual(["human"]);
    expect(webFace(n)).toBe("human");
    expect(subtitleOf(n)).toBe("🙋 로그인해 주세요");
    const split = splitStages(f, "web1").flow;
    const open = split.nodes.find((x) => x.name === "페이지 접속")!;
    expect(subtitleOf(open)).toBe("접속 · portal.example");
    // «다음 할 일» — 페이지 접속은 주소만 있으면 끝(녹화할 동작을 묻지 않는다)
    const g = guideItems(split, [], [], null, { openNode: () => {}, run: () => {}, publish: () => {} } as never).find((x) => x.id === `rec-${open.id}`)!;
    expect(g).toMatchObject({ text: "「페이지 접속」 — 시작 주소 넣기", done: true });
  });
});
