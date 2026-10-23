/**
 * 초안 고치기(model/edit.ts) — 녹화 넣기 · 다시 지정 · 선 치우기 · 요소 이름.
 */
import { describe, expect, it } from "vitest";
import type { Flow, Target, WebAction } from "@flowsmith/core";
import { addRecorded, applyTarget, pruneEdges, targetLabel } from "../src/model/edit.ts";

const target = (label: string): Target => ({ label, locators: [{ kind: "css", value: "#x" }], fingerprint: null, frames: [], verifiedAt: null });
const click = (id: string, label: string): WebAction => ({ id, kind: "click", target: target(label), popup: false, risk: "safe", timeoutMs: null, optional: false });
const flow = (): Flow => ({
  schemaVersion: 1, id: "f", name: "f", description: "", params: [], vars: {}, secrets: [],
  settings: { forbiddenLabels: [], defaultTimeoutMs: 15000, monitorIntervalMin: null, probeParams: {}, browser: "launch", schedules: [], notify: [], retries: 0, runTimeoutMin: null },
  nodes: [
    { id: "w", type: "web", name: "웹", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://x" }, actions: [click("a1", "조회")] } },
    { id: "c", type: "condition", name: "조건", position: { x: 1, y: 0 }, config: { cases: [{ id: "yes", label: "맞으면", match: "all", rules: [{ left: "a", op: "eq", right: "b" }], then: { kind: "next" } }], else: { then: { kind: "next" } } } },
    { id: "n", type: "custom", name: "다음", position: { x: 2, y: 0 }, config: { code: "return {};", outputs: [], usesPage: false, timeoutMs: null } },
  ],
  edges: [{ id: "e1", from: { node: "c", port: "yes" }, to: { node: "n" } }, { id: "e2", from: { node: "c", port: "없어진갈래" }, to: { node: "n" } }],
} as unknown as Flow);

describe("초안 고치기", () => {
  it("★녹화를 붙이면 id를 그 노드 안에서 겹치지 않게 다시 짓는다 · 원래 초안은 그대로", () => {
    const f = flow();
    const next = addRecorded(f, "w", [click("tmp", "저장"), click("tmp", "닫기")]);
    const ids = (next.nodes[0]!.type === "web" ? next.nodes[0]!.config.actions : []).map((a) => a.id);
    expect(ids).toEqual(["a1", "a2", "a3"]);
    expect(f.nodes[0]!.type === "web" && f.nodes[0]!.config.actions).toHaveLength(1);
  });

  it("★다시 지정은 그 동작의 위치만 바꾼다", () => {
    const next = applyTarget(flow(), "w", "a1", target("새 조회"));
    const a = next.nodes[0]!.type === "web" ? next.nodes[0]!.config.actions[0]! : null;
    expect(a && targetLabel(a)).toBe("새 조회");
    expect(a?.risk).toBe("safe");
  });

  it("없어진 포트에서 나가던 선은 치운다", () => {
    expect(pruneEdges(flow()).edges.map((e) => e.id)).toEqual(["e1"]);
  });
});

describe("사람 기다리기 — 지금 주소를 끝 표시로", () => {
  it("쿼리는 빼고 · #/… 경로(해시 라우터)는 남긴다", async () => {
    const { urlDone } = await import("../src/model/index.ts");
    const hashed = urlDone("https://shop.example.co.kr/home/#/WS/IS/COMN_0002M?pid=1090041");
    expect(hashed).toEqual({ kind: "url", pattern: "^https://shop\\.example\\.co\\.kr/home/#/WS/IS/COMN_0002M" });
    const re = new RegExp(hashed.kind === "url" ? hashed.pattern : "");
    expect(re.test("https://shop.example.co.kr/home/#/WS/IS/COMN_0002M?pid=1")).toBe(true);
    expect(re.test("https://shop.example.co.kr/home/#/WS/IS/COMN_4012M/?pid=1090041")).toBe(false);   // 다른 화면 — 전에는 맞았다
    expect(urlDone("https://x.example.com/main?a=1#top")).toEqual({ kind: "url", pattern: "^https://x\\.example\\.com/main" });
  });
});
