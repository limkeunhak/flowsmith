/**
 * 사람의 브라우저에 붙기(attach) · 확장 노드.
 * «사람의 크롬»은 원격 디버깅 포트를 연 Chromium으로 흉내 낸다 — 시험 사이트에 사람이 로그인해 둔다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { parseFlow } from "@flowsmith/core";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { ExtensionRegistry, PII_MASK, runFlow, type Extension, type RunEvent } from "../src/index.ts";

const PORT = 9300 + Math.floor(Math.random() * 400);
const CDP = `http://127.0.0.1:${PORT}`;
let site: TestSite;
let human: BrowserContext;
let humanTab: Page;
let profile: string;

beforeAll(async () => {
  site = await startTestSite(0);
  // 사람의 크롬 — 진짜 크롬처럼 **기본 프로필**에서 뜨고 디버깅 포트를 연다. 사람이 로그인해 둔 탭이 하나 있다
  profile = mkdtempSync(join(tmpdir(), "human-chrome-"));
  human = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`] });
  humanTab = human.pages()[0] ?? await human.newPage();
  await humanTab.goto(`${site.url}/login`);
  await humanTab.fill("#uid", "kim");
  await humanTab.fill("#pw", "p@ss");
  await humanTab.click("button");
  await humanTab.waitForURL(/\/home/);
});
afterAll(async () => {
  await human?.close();
  await site?.close();
  rmSync(profile, { recursive: true, force: true });
});

const tgt = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });

describe("사람의 브라우저에 붙기", () => {
  it("★사람이 로그인한 탭을 골라 쓰고, 끝나면 사람의 탭 · 브라우저는 그대로 두고 우리 탭만 닫는다", async () => {
    const host = new URL(site.url).host;
    const flow = parseFlow({
      schemaVersion: 1, id: "f", name: "f",
      settings: { browser: "attach" },
      nodes: [
        { id: "a", type: "web", name: "사람의 탭", position: { x: 0, y: 0 }, config: {
          start: { kind: "tab", match: host },
          actions: [{ id: "r", kind: "read", output: "who", strategy: "text", target: { ...tgt("사용자", "[data-testid=user-name]") } }],
        } },
        { id: "b", type: "web", name: "우리 탭", position: { x: 0, y: 0 }, config: {
          start: { kind: "url", url: `${site.url}/orders?no=A-1001` },
          actions: [{ id: "s", kind: "read", output: "status", strategy: "text", target: tgt("상태", "#order-status") }],
        } },
      ],
      edges: [{ id: "e", from: { node: "a", port: "out" }, to: { node: "b" } }],
    });
    const tabsBefore = humanTab.context().pages().length;
    const r = await runFlow(flow, { cdpUrl: CDP });
    expect(r.status, JSON.stringify(r.nodes.map((n) => n.failure))).toBe("success");
    // 로그인은 사람이 했다 — 우리 탭도 같은 프로필이라 로그인이 이어진다
    expect(r.output).toEqual({ status: "배송중" });
    expect(r.nodes[0]!.output).toEqual({ who: "김철수" });
    expect(r.nodes[0]!.steps[0]!.note).toContain("사람이 연 탭에서");
    // ★사람의 탭과 브라우저는 그대로다
    expect(human.browser()?.isConnected() ?? true).toBe(true);
    expect(humanTab.isClosed()).toBe(false);
    expect(humanTab.url()).toContain("/home");
    await expect.poll(() => humanTab.context().pages().length).toBe(tabsBefore);
  });

  it("맞는 탭이 없으면 열린 탭을 알려 주며 멈춘다", async () => {
    const flow = parseFlow({
      schemaVersion: 1, id: "f", name: "f", settings: { browser: "attach" },
      nodes: [{ id: "a", type: "web", name: "a", position: { x: 0, y: 0 }, config: { start: { kind: "tab", match: "portal.example.com" }, actions: [{ id: "w", kind: "wait", wait: { kind: "fixed", ms: 1 } }] } }],
      edges: [],
    });
    const r = await runFlow(flow, { cdpUrl: CDP });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/portal\.example\.com.*열린 탭: .*\/home/);
    expect(humanTab.isClosed()).toBe(false);
  });

  it("붙을 수 없으면 무엇을 확인할지 알려 준다", async () => {
    const flow = parseFlow({
      schemaVersion: 1, id: "f", name: "f", settings: { browser: "attach" },
      nodes: [{ id: "a", type: "web", name: "a", position: { x: 0, y: 0 }, config: { start: { kind: "tab", match: "x" }, actions: [{ id: "w", kind: "wait", wait: { kind: "fixed", ms: 1 } }] } }],
      edges: [],
    });
    const r = await runFlow(flow, { cdpUrl: "http://127.0.0.1:9" });
    expect(r.nodes[0]!.failure!.message).toMatch(/사람의 크롬에 붙지 못했습니다.*remote-debugging-port/);
  });
});

describe("확장 노드", () => {
  const echo: Extension = {
    id: "test.echo", title: "메아리", description: "", browser: "none", risk: "safe",
    options: [{ name: "orderNo", label: "주문번호", required: true, default: "{{ $params.orderNo }}" }, { name: "tag", label: "꼬리", required: false }],
    outputs: ["values", "count"],
    pii: ["values"],
    run: async (ctx) => { ctx.log(`받음 ${ctx.options["orderNo"]}`); return { values: { orderNo: ctx.options["orderNo"], 이름: "홍길동" }, count: 2, extra: "버린다" }; },
  };
  const consume: Extension = {
    id: "test.consume", title: "받기", description: "", browser: "none", risk: "unsafe", options: [], outputs: ["got"],
    run: async (ctx) => ({ got: (ctx.input["values"] as Record<string, string>)["이름"] }),
  };
  const reg = new ExtensionRegistry().register(echo, consume);
  const flowOf = (ext = "test.echo") => parseFlow({
    schemaVersion: 1, id: "f", name: "f", params: [{ name: "orderNo", label: "주문번호", required: true }],
    nodes: [
      { id: "a", type: "extension", name: "읽기", position: { x: 0, y: 0 }, config: { extension: ext, options: {}, outputs: ["values", "count"] } },
      { id: "b", type: "extension", name: "넣기", position: { x: 0, y: 0 }, config: { extension: "test.consume", options: {}, outputs: ["got"] } },
    ],
    edges: [{ id: "e", from: { node: "a", port: "out" }, to: { node: "b" } }],
  });

  it("★값은 다음 노드로 그대로 가고, 개인정보로 표시된 출력은 기록 · 이벤트 · 결과에서 가린다", async () => {
    const events: RunEvent[] = [];
    const r = await runFlow(flowOf(), { params: { orderNo: "A-1001" }, extensions: reg, onEvent: (e) => events.push(e) });
    expect(r.status, JSON.stringify(r.nodes.map((n) => n.failure))).toBe("success");
    expect(r.output).toEqual({ got: "홍길동" });                       // 진짜 값이 다음 노드로 갔다
    expect(r.nodes[0]!.output).toEqual({ values: PII_MASK, count: 2 });  // 적힌 이름만 · 개인정보는 가림
    expect(r.nodes[1]!.input).toEqual({ values: PII_MASK, count: 2 });
    expect(r.nodes[0]!.logs).toEqual(["받음 A-1001"]);
    // 만든 쪽의 값은 기록 · 이벤트 어디에도 그대로 남지 않는다(받는 쪽이 개인정보 표시 없이 내놓은 got은 그 확장의 책임)
    const recorded = JSON.stringify([r.nodes[0]!.output, r.nodes[1]!.input]) + JSON.stringify(events.filter((e) => e.kind === "node:start" || (e.kind === "node:end" && e.node.id === "a")));
    expect(recorded).not.toContain("홍길동");
  });

  it("없는 확장 · 비어 있는 필수 값은 그 노드에서 멈춘다", async () => {
    const missing = await runFlow(flowOf("test.nope"), { params: { orderNo: "1" }, extensions: reg });
    expect(missing.nodes[0]!.failure!.message).toMatch(/확장 'test\.nope'가 설치돼 있지 않습니다/);
    const blank = flowOf();
    (blank.nodes[0] as any).config.options = { orderNo: "" };   // 기본값을 비워 버렸다
    const empty = await runFlow(blank, { params: { orderNo: "1" }, extensions: reg });
    expect(empty.nodes[0]!.failure!.message).toMatch(/'주문번호'\(orderNo\)이 비었습니다/);
  });
});
