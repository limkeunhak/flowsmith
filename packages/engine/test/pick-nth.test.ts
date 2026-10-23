/**
 * 행 고르기 — 몇 번째로(2026-10-19): 목록의 n번째 레코드를 연다 · 음수는 끝에서 · 없는 자리면 멈춤 · 고르면 안 되는 행은 그대로 막는다.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";

let site: Server;
let url: string;
let browser: Browser;
// 행을 누르면 상세(#detail)에 그 행의 번호가 뜬다
const PAGE = `<!doctype html><meta charset="utf-8"><table id="list"><tbody>
  ${[["A-1", "접수"], ["A-2", "처리중"], ["A-3", "주문확정"], ["A-4", "완료"]].map(([no, st]) => `<tr onclick="document.getElementById('detail').textContent='${no}'"><td>${no}</td><td>${st}</td></tr>`).join("")}
</tbody></table><p id="detail"></p>`;
const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const flow = (value: string, refuse: unknown = null) => parseFlow({
  schemaVersion: 1, id: "n", name: "n", settings: { defaultTimeoutMs: 3000 },
  params: [{ name: "n", label: "몇 번째", type: "text", required: false, default: "2" }],   // 글자 — 엔진이 «숫자로 못 읽음»을 보게(숫자 종류면 돌기 전에 막힌다)
  nodes: [{ id: "w", type: "web", name: "목록", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [
    { id: "p", kind: "pickRow", pick: { label: "목록", rows: target("목록 행", "#list > tbody > tr"), by: "index", keyColumn: "", keyLabel: "", value, click: "", refuse } },
    { id: "r", kind: "read", output: "opened", target: target("상세", "#detail") },
  ] } }],
  edges: [],
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

describe("행 고르기 — 몇 번째로", () => {
  it("★n번째 · 마지막(-1) · 실행 입력으로 받은 n", async () => {
    expect((await runFlow(flow("1"), { browser })).output).toEqual({ opened: "A-1" });
    expect((await runFlow(flow("-1"), { browser })).output).toEqual({ opened: "A-4" });
    const r = await runFlow(flow("{{ $params.n }}"), { browser, params: { n: "2" } });
    expect(r.output).toEqual({ opened: "A-2" });
    expect(r.nodes[0]!.steps.find((s) => s.id === "p")!.note).toBe("목록에서 2번째 행을 골랐습니다");
  }, 30_000);

  it("★그 자리에 행이 없으면 멈춘다(다른 행을 누르지 않는다) · 숫자가 아니면 멈춘다", async () => {
    const r = await runFlow(flow("9"), { browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure).toMatchObject({ problem: "missing", message: "목록: 9번째 행이 없습니다(행 4개)" });
    const back = await runFlow(flow("-5"), { browser });
    expect(back.nodes[0]!.failure!.message).toBe("목록: 끝에서 5번째 행이 없습니다(행 4개)");
    const bad = await runFlow(flow("{{ $params.n }}"), { browser, params: { n: "셋" } });
    expect(bad.nodes[0]!.failure!.message).toMatch(/몇 번째인지 «셋»를 읽을 수 없습니다/);
  }, 30_000);

  it("★고르면 안 되는 행은 몇 번째로 골라도 막는다", async () => {
    const r = await runFlow(flow("3", { column: "td:nth-child(2)", values: ["주문확정"], reason: "확정된 건은 고치면 안 됩니다" }), { browser });
    expect(r.nodes[0]!.failure).toMatchObject({ problem: "refused" });
    expect(r.nodes[0]!.failure!.message).toMatch(/^목록: 3번째 행 — 확정된 건은 고치면 안 됩니다\(「주문확정」\)/);
  }, 30_000);

  it("검문소 — 몇 번째는 0이 아닌 정수(표현식은 돌 때 본다)", () => {
    expect(() => flow("0")).toThrow(/몇 번째\(value\)는/);
    expect(() => flow("두번째")).toThrow(/몇 번째\(value\)는/);
    expect(() => flow("{{ $params.n }}")).not.toThrow();
  });
});
