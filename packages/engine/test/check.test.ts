/**
 * 검사 노드(2026-10-19) — 항목을 다 보고(하나가 틀려도) · 틀리면 «불통과»(problem check) · 그때만 페이지를 한 장 찍는다.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow, verdictOf } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";

let site: Server;
let url: string;
let browser: Browser;
const PAGE = `<!doctype html><meta charset="utf-8"><h1 id="t">주문 결과</h1><b id="price">651,170원</b>
  <table id="q"><tbody><tr><td>가나상회</td><td>494,700원</td></tr><tr><td>다라마트</td><td>514,490원</td></tr></tbody></table>`;
const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });

const flowWith = (items: unknown[]) => parseFlow({
  schemaVersion: 1, id: "t", name: "t", settings: { defaultTimeoutMs: 3000 },
  nodes: [
    { id: "w", type: "web", name: "읽기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [
      { id: "a1", kind: "read", output: "price", target: target("금액", "#price") },
      { id: "a2", kind: "read", output: "title", target: target("제목", "#t") },
      { id: "a3", kind: "readTable", output: "orders", table: { label: "주문", rows: target("주문 행", "#q > tbody > tr"), columns: [{ name: "shop", selector: "td:nth-child(1)", strategy: "text" }, { name: "amount", selector: "td:nth-child(2)", strategy: "text" }], maxRows: 50 } },
    ] } },
    { id: "k", type: "check", name: "검사", position: { x: 300, y: 0 }, config: { items } },
  ],
  edges: [{ id: "e1", from: { node: "w", port: "out" }, to: { node: "k" } }],
});

beforeAll(async () => {
  site = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
});

describe("검사 노드", () => {
  it("★다 맞으면 통과 — 받은 값 + checksPassed · 스크린샷 없음", async () => {
    const r = await runFlow(flowWith([
      { id: "k1", label: "금액", actual: "{{ $input.price }}", op: "gte", expected: "600000" },
      { id: "k2", label: "제목", actual: "{{ $input.title }}", op: "contains", expected: "주문" },
      { id: "k3", label: "주문 수", actual: "{{ $input.orders }}", op: "countEq", expected: "2" },
      { id: "k4", label: "가나상회", actual: "{{ $input.orders }}", op: "anyEq", expected: "가나상회" },
    ]), { browser });
    expect(r.status).toBe("success");
    expect(r.output).toMatchObject({ price: "651,170원", checksPassed: 4, checksFailed: 0 });
    expect(r.nodes[1]!.checks!.every((c) => c.pass)).toBe(true);
    expect(r.shot).toBeUndefined();
    expect(verdictOf(r.status, null)).toBe("pass");
  }, 30_000);

  it("★하나가 틀려도 나머지를 다 보고 «불통과» — 기대 · 실제 · 그때의 화면 한 장", async () => {
    const r = await runFlow(flowWith([
      { id: "k1", label: "금액", actual: "{{ $input.price }}", op: "lt", expected: "500000" },
      { id: "k2", label: "제목", actual: "{{ $input.title }}", op: "contains", expected: "주문" },
      { id: "k3", label: "주문 수", actual: "{{ $input.orders }}", op: "countGte", expected: "3" },
      { id: "k4", label: "숫자 아님", actual: "{{ $input.title }}", op: "gt", expected: "1" },
    ]), { browser });
    expect(r.status).toBe("failure");
    const k = r.nodes[1]!;
    expect(k.failure!.problem).toBe("check");
    expect(k.failure!.message).toMatch(/^검사 4개 중 3개 불통과 — 금액: 기대 «500000 보다 작다», 실제 «651,170원»/);
    expect(k.checks!.map((c) => c.pass)).toEqual([false, true, false, false]);
    expect(k.checks![3]!.error).toMatch(/숫자로 읽을 수 없습니다/);
    expect(r.shot?.nodeId).toBe("k");
    expect(Buffer.from(r.shot!.data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));   // JPEG
    expect(verdictOf(r.status, k.failure!.problem)).toBe("fail");
    // 찍지 말라면 찍지 않는다
    const quiet = await runFlow(flowWith([{ id: "k1", label: "x", actual: "{{ $input.price }}", op: "empty", expected: null }]), { browser, shotOnCheckFail: false });
    expect(quiet.status).toBe("failure");
    expect(quiet.shot).toBeUndefined();
  }, 30_000);

  it("판정 — 사이트 · 요소 실패는 «오류»(불통과와 다르다)", () => {
    expect(verdictOf("failure", "missing")).toBe("error");
    expect(verdictOf("cancelled", null)).toBe("error");
    expect(verdictOf("blocked", null)).toBe("pass");
  });
});
