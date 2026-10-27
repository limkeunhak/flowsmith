/**
 * 동작 사이 쉬기(2026-10-26) — 웹페이지 동작을 마칠 때마다 설정한 min~max 사이에서 쉰다 · 없으면 쉬지 않는다 · 검문소 · 멈추기는 쉬는 중에도 바로.
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
const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const flow = (actionPause?: unknown) => parseFlow({
  schemaVersion: 1, id: "p", name: "p", settings: { defaultTimeoutMs: 3000, ...(actionPause === undefined ? {} : { actionPause }) },
  nodes: [{ id: "w", type: "web", name: "쉬기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions: [
    { id: "a", kind: "click", target: target("단추", "#b") },
    { id: "b", kind: "click", target: target("단추", "#b") },
    { id: "c", kind: "read", output: "n", target: target("횟수", "#n") },
  ] } }],
  edges: [],
});

beforeAll(async () => {
  site = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><button id="b" onclick="n.textContent=+n.textContent+1">누르기</button><p id="n">0</p>`); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
});

describe("동작 사이 쉬기", () => {
  it("★동작마다 min~max 사이로 쉰다 — 동작 셋이면 적어도 3×min", async () => {
    const quick = Date.now();
    expect((await runFlow(flow(), { browser })).output).toEqual({ n: "2" });
    const base = Date.now() - quick;
    const t0 = Date.now();
    const r = await runFlow(flow({ minMs: 400, maxMs: 500 }), { browser });
    const took = Date.now() - t0;
    expect(r.output).toEqual({ n: "2" });
    expect(took).toBeGreaterThanOrEqual(1200);
    expect(took).toBeLessThan(base + 1500 + 4000);   // 쉬기는 최대 3×500 — 기계가 바쁠 때를 넉넉히
  }, 30_000);

  it("검문소 — 없으면 0(쉬지 않음) · 최대가 최소보다 작으면 안 된다 · 60초까지", () => {
    expect(flow().settings.actionPause).toEqual({ minMs: 0, maxMs: 0 });
    expect(() => flow({ minMs: 3000, maxMs: 2000 })).toThrow(/최대\(maxMs 2000\)가 최소\(minMs 3000\)보다 작습니다/);
    expect(flow({ minMs: 90_000, maxMs: 120_000 }).settings.actionPause).toEqual({ minMs: 60_000, maxMs: 60_000 });
  });

  it("멈추기를 누르면 쉬는 중에도 바로 멈춘다", async () => {
    const stop = new AbortController();
    const t0 = Date.now();
    setTimeout(() => stop.abort(), 400);
    const r = await runFlow(flow({ minMs: 20_000, maxMs: 20_000 }), { browser, signal: stop.signal });
    expect(r.status).not.toBe("success");
    expect(Date.now() - t0).toBeLessThan(5_000);
  }, 30_000);
});
