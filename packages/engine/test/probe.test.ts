/**
 * 점검 실행 — 시험 사이트를 «바뀐 척»(배치 2) 시켜 본다.
 * 녹화 때의 지문은 배치 1에서 점검이 뜬 지문을 그대로 쓴다(레코더가 뜨는 것과 같은 규칙이다).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow, type Flow } from "@flowsmith/core";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { runFlow } from "../src/index.ts";

let site: TestSite;
let browser: Browser;
const SECRETS = { shop: { username: "kim", password: "p@ss" } };
beforeAll(async () => { site = await startTestSite(0); browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); await site?.close(); });

const tgt = (label: string, kind: string, value: string, extra: Record<string, unknown> = {}) =>
  ({ label, locators: [{ kind, value, ...extra }], fingerprint: null, frames: [], verifiedAt: null });

function flow(): any {
  return {
    schemaVersion: 1, id: "f", name: "f",
    params: [{ name: "orderNo", label: "주문번호", required: true }],
    secrets: [{ name: "shop", kind: "login" }],
    settings: { defaultTimeoutMs: 2000, probeParams: { orderNo: "A-1001" } },
    nodes: [
      { id: "login", type: "web", name: "로그인", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${site.url}/login` }, actions: [
        { id: "u", kind: "fill", value: "{{ $secrets.shop.username }}", target: tgt("'아이디' 칸", "css", "#uid") },
        { id: "p", kind: "fill", value: "{{ $secrets.shop.password }}", target: tgt("'비밀번호' 칸", "css", "#pw") },
        { id: "b", kind: "click", target: tgt("'로그인' 버튼", "role", "button", { name: "로그인" }) },
      ] } },
      { id: "search", type: "web", name: "조회", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${site.url}/orders` }, actions: [
        { id: "n", kind: "fill", value: "{{ $params.orderNo }}", target: tgt("'주문번호' 칸", "placeholder", "주문번호") },
        { id: "go", kind: "click", target: tgt("'조회' 버튼", "css", "form[action='/orders'] button") },
        { id: "st", kind: "read", output: "status", strategy: "text", target: tgt("상태", "css", "#order-status") },
        { id: "cancel", kind: "click", risk: "unsafe", target: tgt("'주문 취소' 버튼", "role", "button", { name: "주문 취소" }) },
      ] } },
    ],
    edges: [{ id: "e", from: { node: "login", port: "out" }, to: { node: "search" } }],
  };
}

/** 점검이 뜬 지문을 «녹화 때 것»으로 심는다 */
function withBaseline(j: any, findings: { actionId: string; now: unknown }[]): Flow {
  for (const n of j.nodes) for (const a of n.config.actions) {
    const f = findings.find((x) => x.actionId === a.id);
    if (f?.now && a.target) a.target.fingerprint = f.now;
  }
  return parseFlow(j);
}

describe("점검 실행", () => {
  it("★되돌릴 수 없는 동작은 누르지 않고 «있는지만» 본 뒤 멈춘다", async () => {
    site.setLayout(1);
    const before = site.stats.cancelPosts;
    const r = await runFlow(parseFlow(flow()), { params: { orderNo: "A-1001" }, secrets: SECRETS, browser, probe: true });
    expect(r.status).toBe("success");
    expect(r.probe!.status).toBe("ok");
    expect(r.probe!.stop).toMatchObject({ nodeId: "search", actionId: "cancel", reason: expect.stringMatching(/되돌릴 수 없는 동작 앞/) });
    expect(r.probe!.findings.map((f) => [f.actionId, f.status])).toEqual([["u", "ok"], ["p", "ok"], ["b", "ok"], ["n", "ok"], ["go", "ok"], ["st", "ok"], ["cancel", "ok"]]);
    expect(site.stats.cancelPosts).toBe(before);
    // 비밀번호 칸의 지문에는 값이 없다
    expect(JSON.stringify(r.probe!.findings.find((f) => f.actionId === "p")!.now)).not.toContain("p@ss");
  });

  it("★사이트가 바뀌면 — 찾은 것은 «무엇이 달라졌나», 못 찾은 것은 «없음»으로 알리고 거기서 멈춘다", async () => {
    site.setLayout(1);
    const base = await runFlow(parseFlow(flow()), { params: { orderNo: "A-1001" }, secrets: SECRETS, browser, probe: true });
    const recorded = withBaseline(flow(), base.probe!.findings);

    // 같은 배치면 다 그대로다(지문 규칙이 매번 같은 값을 낸다)
    const same = await runFlow(recorded, { params: { orderNo: "A-1001" }, secrets: SECRETS, browser, probe: true });
    expect(same.probe!.status).toBe("ok");

    site.setLayout(2);
    try {
      const r = await runFlow(recorded, { params: { orderNo: "A-1001" }, secrets: SECRETS, browser, probe: true });
      expect(r.probe!.status).toBe("broken");
      const go = r.probe!.findings.find((f) => f.actionId === "go")!;
      expect(go.status).toBe("changed");
      expect(go.differences).toEqual(["글자: '조회' → '검색'"]);
      const st = r.probe!.findings.find((f) => f.actionId === "st")!;
      expect(st.status).toBe("missing");
      expect(r.probe!.stop).toMatchObject({ nodeId: "search", actionId: "st" });
      expect(r.probe!.findings.some((f) => f.actionId === "cancel")).toBe(false);   // 그 뒤로는 안 갔다
      expect(r.probe!.message).toMatch(/2개가 달라졌습니다/);
    } finally {
      site.setLayout(1);
    }
  });

  it("점검이 아닌 실행에는 보고서가 없다", async () => {
    const j = flow();
    j.nodes[1].config.actions.pop();
    const r = await runFlow(parseFlow(j), { params: { orderNo: "A-1001" }, secrets: SECRETS, browser });
    expect(r.probe).toBeUndefined();
    expect(r.output).toEqual({ status: "배송중" });
  });
});
