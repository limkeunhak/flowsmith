/**
 * 운영 — 다시 해 보기 · 멈추기 · 전체 시간 제한 (2026-10-16).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

/** 1.2초 뒤에야 단추가 생기는 페이지 · 같은 단추가 둘인 페이지 */
const LATE = "data:text/html;charset=utf-8," + encodeURIComponent(`<p>기다리세요</p><script>setTimeout(() => { const b = document.createElement("button"); b.id = "late"; b.textContent = "늦게 뜬 단추"; b.onclick = () => document.title = "눌림"; document.body.append(b); }, 1200);</script>`);
const TWINS = "data:text/html;charset=utf-8," + encodeURIComponent(`<button class="b">하나</button><button class="b">둘</button>`);
const css = (label: string, value: string) => ({ label, locators: [{ kind: "css", value }], fingerprint: null, frames: [], verifiedAt: null });
const flow = (actions: unknown[], settings: Record<string, unknown> = {}, url = LATE) => parseFlow({
  schemaVersion: 1, id: "ops", name: "운영",
  settings: { defaultTimeoutMs: 400, retryDelayMs: 300, ...settings },
  nodes: [{ id: "w", type: "web", name: "페이지", position: { x: 0, y: 0 }, config: { start: { kind: "url", url }, actions } }],
  edges: [],
});

describe("다시 해 보기", () => {
  it("★늦게 뜬 요소 — 다시 해 보면 된다 · 몇 번째에 됐는지 남긴다", async () => {
    const r = await runFlow(flow([{ id: "a1", kind: "click", target: css("늦게 뜬 단추", "#late") }], { retries: 5 }), { browser });
    expect(r.status, r.message).toBe("success");
    const notes = r.nodes[0]!.steps.map((s) => s.note);
    expect(notes.filter((n) => n.startsWith("다시 해 봅니다")).length).toBeGreaterThan(0);
    expect(notes.at(-1)).toMatch(/번째에 됨/);
  }, 30_000);

  it("다시 해 보기가 없으면(기본 0) 바로 실패 · 동작마다 따로 정할 수 있다", async () => {
    const none = await runFlow(flow([{ id: "a1", kind: "click", target: css("늦게 뜬 단추", "#late") }]), { browser });
    expect(none.status).toBe("failure");
    const own = await runFlow(flow([{ id: "a1", kind: "click", retries: 5, target: css("늦게 뜬 단추", "#late") }]), { browser });
    expect(own.status, own.message).toBe("success");
  }, 30_000);

  it("★되돌릴 수 없는 동작은 다시 하지 않는다 · 판단이 정해진 실패(여러 개)도 다시 하지 않는다", async () => {
    const unsafe = await runFlow(flow([{ id: "a1", kind: "click", risk: "unsafe", target: css("제출", "#late") }], { retries: 5 }), { browser });
    expect(unsafe.status).toBe("failure");
    expect(unsafe.nodes[0]!.steps.some((s) => s.note.startsWith("다시 해 봅니다"))).toBe(false);
    // «여러 개»는 세자마자 정해진다 — 시간 제한을 넉넉히(0.4초면 전체 시험 부하에서 세기 전에 «시간 넘김»이 되어 한 번 다시 해 본다)
    const many = await runFlow(flow([{ id: "a1", kind: "click", target: css("단추", "button.b") }], { retries: 5, defaultTimeoutMs: 5000 }, TWINS), { browser });
    expect(many.nodes[0]!.failure?.problem).toBe("many");
    expect(many.nodes[0]!.steps.some((s) => s.note.startsWith("다시 해 봅니다"))).toBe(false);
  }, 30_000);
});

describe("멈추기 · 전체 시간 제한", () => {
  const slow = (settings: Record<string, unknown> = {}) => flow([
    { id: "a1", kind: "wait", wait: { kind: "fixed", ms: 15_000 } },
    { id: "a2", kind: "goto", url: "about:blank" },
  ], settings);

  it("★멈추면 하던 동작을 깨우고 «멈춤»으로 끝난다 — 멈춘 노드와 뒤는 «안 돎»", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 700);
    const t0 = Date.now();
    const r = await runFlow(slow(), { browser, signal: ctrl.signal });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.status).toBe("cancelled");
    expect(r.message).toMatch(/실행을 멈췄습니다\(사람이 멈춤\)/);
    expect(r.nodes[0]).toMatchObject({ status: "cancelled", failure: null });
    expect(r.nodes[0]!.logs.at(-1)).toMatch(/멈췄습니다/);
  }, 30_000);

  it("이미 멈춘 신호면 시작도 하지 않는다", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await runFlow(slow(), { browser, signal: ctrl.signal });
    expect(r.status).toBe("cancelled");
    expect(r.nodes[0]!.status).toBe("cancelled");
    expect(r.nodes[0]!.steps).toEqual([]);
  }, 30_000);

  it("★전체 시간 제한을 넘으면 실패로 멈춘다 — 워크플로우 설정 · 실행할 때 준 값", async () => {
    const t0 = Date.now();
    const r = await runFlow(slow(), { browser, timeoutMs: 900 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.status).toBe("failure");
    expect(r.message).toMatch(/전체 시간 제한\(1초\)을 넘어 멈췄습니다/);
    expect(parseFlow({ schemaVersion: 1, id: "x", name: "x", nodes: [{ id: "c", type: "custom", name: "c", position: { x: 0, y: 0 }, config: { code: "return {}" } }], edges: [] }).settings)
      .toMatchObject({ retries: 0, retryDelayMs: 2000, runTimeoutMin: 60 });   // 기본값
  }, 30_000);
});
