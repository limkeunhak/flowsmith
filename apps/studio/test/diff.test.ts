/**
 * 버전 비교(model/diff.ts) — 두 버전이 무엇이 다른지 사람 말로. 위치만 바뀐 것은 세지 않는다.
 */
import { describe, expect, it } from "vitest";
import type { Flow } from "@flowsmith/core";
import { diffFlows, normalize } from "../src/model/index.ts";

const target = (label: string) => ({ label, locators: [{ kind: "css", value: `#${label}` }], fingerprint: null, frames: [], verifiedAt: null });
const click = (id: string, label: string) => ({ id, kind: "click", target: target(label), popup: false, risk: "safe", timeoutMs: null, optional: false });
const base = (): Flow => normalize({
  schemaVersion: 1, id: "f", name: "주문 조회",
  params: [{ name: "order", label: "주문번호", type: "text", required: true }],
  nodes: [
    { id: "w", type: "web", name: "조회", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://shop.example" }, actions: [click("a1", "조회"), click("a2", "닫기")] } },
    { id: "c", type: "custom", name: "정리", position: { x: 300, y: 0 }, config: { code: "return {};", outputs: [] } },
  ],
  edges: [{ id: "e1", from: { node: "w", port: "out" }, to: { node: "c" } }],
});

describe("diffFlows", () => {
  it("같으면 빈 목록 — 캔버스 위치만 옮긴 것은 세지 않는다", () => {
    const b = base();
    b.nodes[0]!.position = { x: 500, y: 500 };
    expect(diffFlows(base(), b)).toEqual([]);
  });

  it("★동작 더함 · 뺌 · 바뀜 · 노드 · 선 · 입력 · 설정을 사람 말로", () => {
    const a = base();
    const b = base();
    const w = b.nodes[0]!;
    if (w.type !== "web") throw new Error("web");
    w.config.actions = [click("a1", "검색") as never, click("a3", "저장") as never];
    b.nodes = b.nodes.filter((n) => n.id !== "c");
    b.nodes.push({ id: "ok", type: "approval", name: "결재", position: { x: 0, y: 0 }, config: { message: "제출?", minRole: "editor", timeoutMin: 60 } });
    b.edges = [];
    b.params = [];
    b.settings = { ...b.settings, retries: 2, after: [{ id: "t1", flowId: "x", on: ["success"], params: {}, enabled: true }] };
    const texts = diffFlows(a, b).map((c) => `${c.kind}|${c.where}|${c.text}`);
    expect(texts).toEqual(expect.arrayContaining([
      expect.stringMatching(/^changed\|노드 «조회»\|동작 1: .*조회.* → .*검색/),
      expect.stringMatching(/^added\|노드 «조회»\|동작 2 .*저장.*더했습니다/),
      expect.stringMatching(/^removed\|노드 «조회»\|동작 2 .*닫기.*뺐습니다/),
      "added|노드 «결재»|노드를 더했습니다",
      "removed|노드 «정리»|노드를 뺐습니다",
      "removed|선|«조회» → «정리» 끊었습니다",
      "removed|실행 입력|«주문번호»를 뺐습니다",
      "changed|설정|다시 해 보기이(가) 바뀌었습니다",
      "changed|설정|다른 워크플로우가 끝나면이(가) 바뀌었습니다",
    ]));
  });

  it("노드 설정은 칸 이름으로 · 동작 차례만 바뀐 것도", () => {
    const a = base();
    const b = base();
    const c = b.nodes[1]!;
    if (c.type !== "custom") throw new Error("custom");
    c.config.code = "return { x: 1 };";
    const w = b.nodes[0]!;
    if (w.type !== "web") throw new Error("web");
    w.config.actions = [...w.config.actions].reverse();
    const texts = diffFlows(a, b).map((x) => x.text);
    expect(texts).toContain("설정이 바뀌었습니다 — 코드");
    expect(texts).toContain("동작의 차례가 바뀌었습니다");
  });
});
