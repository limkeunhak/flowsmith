import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow, type Flow } from "@flowsmith/core";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { checkRunInputs, RunInputError, runFlow, type RunEvent } from "../src/index.ts";

let site: TestSite;
let browser: Browser;
const SECRETS = { shop: { username: "kim", password: "p@ss" } };

beforeAll(async () => {
  site = await startTestSite(0);
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

const example = (): any => JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
const load = (j: any): Flow => { j.vars.baseUrl = site.url; return parseFlow(j); };
const tgt = (label: string, kind: string, value: string, extra: Record<string, unknown> = {}) =>
  ({ label, locators: [{ kind, value, ...extra }], fingerprint: null, frames: [], verifiedAt: null });

/** 로그인 노드 하나 + 뒤에 붙일 웹페이지 노드 하나 */
function loginThen(actions: unknown[], extra: Record<string, unknown> = {}): any {
  const j = example();
  j.nodes = [j.nodes[0], { id: "page", type: "web", name: "페이지", position: { x: 0, y: 0 }, config: { start: { kind: "continue" }, actions } }];
  j.edges = [{ id: "e1", from: { node: "login", port: "out" }, to: { node: "page" } }];
  j.params = [];
  Object.assign(j, extra);
  return j;
}

describe("실행기 — 시험 사이트에서", () => {
  it("예시 워크플로우가 끝까지 돈다 — 로그인 → 조회 → 조건 → 커스텀", async () => {
    const events: RunEvent[] = [];
    const r = await runFlow(load(example()), { params: { orderNo: "A-1001" }, secrets: SECRETS, browser, onEvent: (e) => events.push(e) });
    expect(r.status, JSON.stringify(r.nodes.map((n) => n.failure), null, 2)).toBe("success");
    expect(r.output).toEqual({ amountNumber: 12500, status: "배송중" });
    expect(r.nodes.map((n) => [n.id, n.status])).toEqual([["login", "succeeded"], ["search", "succeeded"], ["check", "succeeded"], ["shape", "succeeded"]]);
    expect(r.nodes[0]!.output).toEqual({ userName: "김철수" });
    expect(r.nodes[2]!.branch).toBe("else");
    expect(events.filter((e) => e.kind === "step").length).toBe(r.nodes[0]!.steps.length + r.nodes[1]!.steps.length);
  });

  it("★앞 페이지에서 이어서 — 앞 노드가 읽은 값도 함께 넘긴다 · 동작 없는 «페이지 접속» 노드(노드 나누기 2026-10-22)", async () => {
    const wait = { id: "w", kind: "wait", risk: "safe", timeoutMs: null, optional: false, wait: { kind: "fixed", ms: 10 } };
    const r = await runFlow(load(loginThen([wait])), { secrets: SECRETS, browser });
    expect(r.status, JSON.stringify(r.nodes.map((n) => n.failure))).toBe("success");
    expect(r.nodes[1]!.output).toEqual({ userName: "김철수" });   // 로그인 노드가 읽은 것이 이어진다
    // 접속만 하는 노드 → 이어서 하는 노드
    const j = loginThen([wait]);
    j.nodes = [{ id: "open", type: "web", name: "페이지 접속", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "{{ $vars.baseUrl }}/login" }, actions: [] } }, j.nodes[1]];
    j.edges = [{ id: "e1", from: { node: "open", port: "out" }, to: { node: "page" } }];
    const r2 = await runFlow(load(j), { secrets: SECRETS, browser });
    expect(r2.status, JSON.stringify(r2.nodes.map((n) => n.failure))).toBe("success");
    expect(r2.nodes.map((n) => [n.id, n.status])).toEqual([["open", "succeeded"], ["page", "succeeded"]]);
    expect(r2.nodes[1]!.steps[0]!.note).toMatch(/앞 페이지에서 이어서 — .*\/login/);
    // 앞 페이지에서 이어서 하는데 동작이 없으면 — 뜻이 없다(검문소가 막는다)
    const k = loginThen([]);
    expect(() => load(k)).toThrow(/동작이 하나도 없습니다/);
  });

  it("★★시크릿 값은 결과 · 단계 기록 · 이벤트 어디에도 그대로 나가지 않는다", async () => {
    const events: RunEvent[] = [];
    const r = await runFlow(load(example()), { params: { orderNo: "A-1001" }, secrets: SECRETS, browser, onEvent: (e) => events.push(e) });
    const all = JSON.stringify(r) + JSON.stringify(events);
    expect(all).not.toContain("p@ss");
    expect(all).not.toMatch(/"kim"|\bkim\b/);
    expect(r.nodes[0]!.steps[1]!.note).toContain("***");
  });

  it("★취소 주문은 조건 노드의 «종료» 갈래로 끝난다 — 뒤 노드는 안 돈다", async () => {
    const j = example();
    // 시험 사이트는 «취소 포함»을 켜야 취소 주문을 보여 준다
    j.nodes[1].config.actions.splice(2, 0, { id: "b15", kind: "check", checked: true, target: tgt("'취소 포함' 칸", "label", "취소 포함") });
    const r = await runFlow(load(j), { params: { orderNo: "A-1002" }, secrets: SECRETS, browser });
    expect(r.status).toBe("failure");
    expect(r.message).toBe("취소된 주문입니다");
    expect(r.nodes.find((n) => n.id === "check")!.branch).toBe("cancelled");
    expect(r.nodes.find((n) => n.id === "shape")!.status).toBe("cancelled");
  });

  it("★요소가 없으면 멈추고, 후보는 붙이기만 한다", async () => {
    const j = example();
    j.nodes[1].config.actions[3].target.locators.push({ kind: "text", value: "배송중" });
    j.settings.defaultTimeoutMs = 3000;
    // A-1002는 «취소 포함» 없이 조회하면 «찾을 수 없습니다» — 상태 칸이 없다
    const r = await runFlow(load(j), { params: { orderNo: "A-1002" }, secrets: SECRETS, browser });
    expect(r.status).toBe("failure");
    const f = r.nodes.find((n) => n.id === "search")!.failure!;
    expect(f.problem).toBe("missing");
    expect(f.action).toEqual({ index: 4, id: "b3", kind: "read" });
    expect(f.label).toBe("주문 상태");
    expect(f.url).toContain("/orders?no=A-1002");
    expect(f.candidates).toEqual([{ locator: { kind: "text", value: "배송중" }, count: 0 }]);
    expect(r.nodes.find((n) => n.id === "check")!.status).toBe("cancelled");
  }, 30_000);

  it("★요소가 여러 개면 아무거나 집지 않고 멈춘다", async () => {
    const j = loginThen([
      { id: "g", kind: "goto", url: "{{ $vars.baseUrl }}/orders?no=A-1001" },
      { id: "r", kind: "read", output: "x", target: tgt("아무 칸", "css", "td") },
    ]);
    j.settings.defaultTimeoutMs = 3000;
    const r = await runFlow(load(j), { secrets: SECRETS, browser });
    const f = r.nodes[1]!.failure!;
    expect(f.problem).toBe("many");
    expect(f.message).toMatch(/6개/);
  });

  it("★★녹화 이름을 속여도 금지 버튼은 요소 글자로 잡힌다 — 그리고 정말 안 눌렸다", async () => {
    const before = site.stats.cancelPosts;
    const j = loginThen([
      { id: "g", kind: "goto", url: "{{ $vars.baseUrl }}/orders?no=A-1001" },
      { id: "c", kind: "click", target: tgt("'확인' 버튼", "css", "form[action='/orders/cancel'] button") },
    ]);
    const r = await runFlow(load(j), { secrets: SECRETS, browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[1]!.failure!.problem).toBe("forbidden");
    expect(r.nodes[1]!.failure!.message).toMatch(/주문 취소/);
    expect(site.stats.cancelPosts).toBe(before);
  });

  it("고르기 · 표 · iframe", async () => {
    const j = loginThen([
      { id: "g", kind: "goto", url: "{{ $vars.baseUrl }}/orders" },
      { id: "f", kind: "fill", value: "A-1001", target: tgt("'주문번호' 칸", "placeholder", "주문번호") },
      { id: "s", kind: "select", value: "3개월", target: tgt("'기간'", "label", "기간") },
      { id: "c", kind: "click", target: tgt("'조회' 버튼", "role", "button", { name: "조회" }) },
      { id: "p", kind: "read", output: "period", strategy: "text", target: tgt("조회 기간", "css", "#order-period") },
      { id: "t", kind: "readTable", output: "items", table: {
        label: "품목 표", rows: tgt("품목 행", "css", "#items tr.item"), maxRows: 10,
        columns: [{ name: "품목", selector: "td.name" }, { name: "수량", selector: "td.qty" }, { name: "없는칸", selector: "td.nope" }],
      } },
      { id: "g2", kind: "goto", url: "{{ $vars.baseUrl }}/frame" },
      { id: "m", kind: "fill", value: "안녕 123", target: { ...tgt("'메모' 칸", "css", "#memo"), frames: ["#inner"] } },
      { id: "b", kind: "click", target: { ...tgt("'보이기' 버튼", "css", "#echo"), frames: ["#inner"] } },
      { id: "o", kind: "read", output: "echo", strategy: "text", target: { ...tgt("보인 값", "css", "#out"), frames: ["#inner"] } },
    ]);
    const r = await runFlow(load(j), { secrets: SECRETS, browser });
    expect(r.status, JSON.stringify(r.nodes[1]!.failure)).toBe("success");
    expect(r.output).toEqual({
      userName: "김철수",   // 앞 페이지에서 이어서 — 로그인 노드가 읽은 것도 넘긴다
      period: "3m",
      items: [{ 품목: "연필", 수량: "10", 없는칸: null }, { 품목: "공책", 수량: "3", 없는칸: null }],
      echo: "안녕 123",
    });
  });

  it("비밀번호가 틀리면 다음 화면 요소를 못 찾아 멈춘다 — 메시지에 비밀번호가 없다", async () => {
    const j = loginThen([]);
    j.nodes = [j.nodes[0]];
    j.edges = [];
    j.settings.defaultTimeoutMs = 2000;
    const r = await runFlow(load(j), { secrets: { shop: { username: "kim", password: "wrong-pw" } }, browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.problem).toBe("missing");
    expect(JSON.stringify(r)).not.toContain("wrong-pw");
  });

  it("실행 입력이나 시크릿이 없으면 브라우저를 띄우기 전에 멈춘다", async () => {
    await expect(runFlow(load(example()), { params: {}, secrets: SECRETS, browser })).rejects.toThrow(RunInputError);
    await expect(runFlow(load(example()), { params: { orderNo: "A-1001" }, secrets: {}, browser })).rejects.toThrow(/시크릿 'shop'/);
    await expect(runFlow(load(example()), { params: { orderNo: "A-1001" }, secrets: { shop: "x" }, browser })).rejects.toThrow(/username과 password/);
  });
});

describe("커스텀 노드", () => {
  const customFlow = (code: string, outputs: string[], usesPage = false, timeoutMs: number | null = null): any => {
    const j = loginThen([]);
    j.nodes = [j.nodes[0], { id: "c", type: "custom", name: "커스텀", position: { x: 0, y: 0 }, config: { code, outputs, usesPage, timeoutMs } }];
    j.edges = [{ id: "e1", from: { node: "login", port: "out" }, to: { node: "c" } }];
    return j;
  };

  it("★날 Playwright page를 쓴다 — 입력도 받는다", async () => {
    const r = await runFlow(load(customFlow(`
      await page.goto(ctx.vars.baseUrl + "/orders?no=A-1001");
      const amount = await page.locator("#order-amount").innerText();
      console.log("금액", amount);
      return { title: await page.title(), amount, who: input.userName };
    `, ["title", "amount", "who"], true)), { secrets: SECRETS, browser });
    expect(r.status, JSON.stringify(r.nodes[1]!.failure)).toBe("success");
    expect(r.output).toEqual({ title: "주문 조회", amount: "12,500원", who: "김철수" });
    expect(r.nodes[1]!.logs).toContain("금액 12,500원");
  });

  it("outputs에 적은 이름만 내보내고, 빠뜨리면 실패한다", async () => {
    const ok = await runFlow(load(customFlow(`return { a: 1, b: 2 };`, ["a"])), { secrets: SECRETS, browser });
    expect(ok.output).toEqual({ a: 1 });
    const bad = await runFlow(load(customFlow(`return { a: 1 };`, ["a", "z"])), { secrets: SECRETS, browser });
    expect(bad.nodes[1]!.failure!.message).toMatch(/"z"를 돌려주지 않았습니다/);
  });

  it("던지면 그 메시지로, 늦으면 시간 초과로 실패한다", async () => {
    const thrown = await runFlow(load(customFlow(`throw new Error("일부러");`, [])), { secrets: SECRETS, browser });
    expect(thrown.nodes[1]!.failure!.message).toBe("Error: 일부러");
    const slow = await runFlow(load(customFlow(`await new Promise((r) => setTimeout(r, 5000)); return {};`, [], false, 300)), { secrets: SECRETS, browser });
    expect(slow.nodes[1]!.failure!.message).toMatch(/300ms 안에/);
    const loop = await runFlow(load(customFlow(`while (true) {}`, [], false, 300)), { secrets: SECRETS, browser });
    expect(loop.nodes[1]!.failure!.message).toMatch(/동기 코드/);
  });

  it("시크릿은 커스텀 노드에 없다 — 그래도 출력에 섞이면 가린다", async () => {
    const r = await runFlow(load(customFlow(`return { has: typeof ctx.secrets, leak: "pw=" + "p@" + "ss" };`, ["has", "leak"])), { secrets: SECRETS, browser });
    expect(r.output).toEqual({ has: "undefined", leak: "pw=***" });
  });
});

describe("실행 입력의 종류 — 돌리기 전에 본다", () => {
  const typed = (params: unknown[]) => parseFlow({
    schemaVersion: 1, id: "typed", name: "입력", params,
    nodes: [{ id: "t", type: "custom", name: "t", position: { x: 0, y: 0 }, config: { code: "return {};", outputs: [] } }], edges: [],
  });
  it("종류가 안 맞으면 브라우저를 띄우기 전에 멈춘다 · 비면 기본값으로", () => {
    const f = typed([{ name: "n", label: "수량", type: "number" }, { name: "d", label: "기준일", type: "date", required: false, default: "2026-10-18" }]);
    expect(checkRunInputs(f, { n: "열", d: "2026-10-18" }, {})).toEqual(["실행 입력 '수량'(n): 숫자가 아닙니다(\"열\")"]);
    expect(checkRunInputs(f, { n: "3", d: "2026-13-01" }, {}).join()).toMatch(/기준일.*날짜/);
    expect(checkRunInputs(f, { n: "3" }, {})).toEqual([]);
  });
});
