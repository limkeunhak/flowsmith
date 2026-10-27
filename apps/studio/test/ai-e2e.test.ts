/**
 * AI 도우미 화면 e2e(2026-10-20, PLAN §42) — 모델은 가짜(서버의 fetch를 가로챈다).
 * 편집 화면: «✦ AI» → 말하기 → 제안(바뀐 것) → 적용 → 저장 · 첫 화면: «✦ AI로 만들기» → 새 워크플로우가 캔버스에 · 녹화로 채울 곳이 보인다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { generateKey, InProcessWorker, SecretBox, startApp, type App } from "@flowsmith/server";

const root = fileURLToPath(new URL("..", import.meta.url));
let app: App;
let browser: Browser;
let page: Page;
let dir: string;
const api = (method: string, path: string, body?: unknown) => fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.json() as Promise<any>);

/** 다음에 낼 제안 — 시험마다 바꾼다 */
let nextFlow: unknown = null;
/** 모델에 넘어간 키 — 내 키여야 한다 */
const usedKeys: string[] = [];
/** 모델에 간 설명서(system) — 대화로 고칠 때 직전 제안이 실렸나 본다 */
const systems: string[] = [];
/** 부른 모델 — AI 창의 고르기가 실렸나 본다 */
const usedModels: string[] = [];
const fakeModel = (async (url: string | URL, init?: RequestInit) => {
  const headers = init?.headers as Record<string, string>;
  // Gemini — generateContent 모양으로 답한다(서버가 바꿔 돌려준다)
  if (String(url).includes("generativelanguage.googleapis.com")) {
    usedKeys.push(`gemini:${headers["x-goog-api-key"]}`);
    usedModels.push(/models\/([^:]+):/.exec(String(url))![1]!);
    const g = JSON.parse(String(init?.body)) as { contents: { parts: Record<string, unknown>[] }[] };
    const afterTool = g.contents.at(-1)!.parts.some((p) => "functionResponse" in p);
    return Response.json(afterTool
      ? { candidates: [{ content: { role: "model", parts: [{ text: "Gemini가 만들었습니다." }] }, finishReason: "STOP" }], usageMetadata: {} }
      : { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "propose_flow", args: { flow: JSON.stringify(nextFlow), summary: "Gemini 제안" } }, thoughtSignature: "SIG" }] }, finishReason: "STOP" }], usageMetadata: {} });
  }
  const body = JSON.parse(String(init?.body)) as { model: string; system: string; messages: { role: string; content: unknown }[] };
  usedKeys.push(String(headers["x-api-key"]));
  usedModels.push(body.model);
  systems.push(body.system);
  const last = body.messages.at(-1)!;
  const afterTool = Array.isArray(last.content) && (last.content as { type: string }[]).some((b) => b.type === "tool_result");
  return Response.json(afterTool
    ? { content: [{ type: "text", text: "만들었습니다. 웹페이지의 로그인과 목록은 녹화로 채워 주세요." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }
    : { content: [{ type: "text", text: "제안을 만들게요." }, { type: "tool_use", id: "t1", name: "propose_flow", input: { flow: nextFlow, summary: "일정 · 검사 더하기" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } });
}) as typeof fetch;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-ai-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false, ai: { fetch: fakeModel } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("AI 어시스턴트(떠 있는 창)", () => {
  const dock = () => page.getByRole("dialog", { name: "AI 어시스턴트" });
  const chat = () => dock().getByRole("log", { name: "AI와 나눈 말" });
  const say = async (t: string) => { await dock().getByLabel("AI에게 말하기").fill(t); await dock().getByRole("button", { name: "전송", exact: true }).click(); };

  it("★오른쪽 아래 AI 단추 → 창 · 키가 없으면 «내 설정»으로 — 키는 이 브라우저에만(서버에는 없다)", async () => {
    await page.goto(`${app.url}/#/`);
    await page.getByRole("button", { name: "AI 어시스턴트 열기" }).click();
    await dock().waitFor();
    await dock().getByText(/AI 키가 없습니다/).waitFor();
    expect(await dock().getByLabel("AI에게 말하기").isDisabled()).toBe(true);
    // 단추는 오른쪽 아래 · 창은 그 바로 왼쪽 위
    const fab = (await page.getByRole("button", { name: "AI 어시스턴트 닫기" }).last().boundingBox())!;
    const box = (await dock().boundingBox())!;
    expect(fab.x + fab.width).toBeGreaterThan(1440 - 40);
    expect(box.y + box.height).toBeLessThan(fab.y);
    expect(box.x + box.width).toBeGreaterThan(fab.x);
    await dock().getByRole("link", { name: "내 설정" }).first().click();
    await page.waitForURL(/#\/me$/);
    await page.getByLabel("Claude (Anthropic) API 키").fill("sk-ant-api03-MYKEY-abcdefghijklmnopqrstuvwxyz0123456789");
    await page.locator(".my-settings").getByRole("button", { name: "저장" }).click();
    await page.getByText("sk-ant-api…6789").waitFor();
    expect((await api("GET", "/api/ai")).key).toBeNull();   // 서버에는 없다
    await page.goto(`${app.url}/#/`);
    await expect.poll(() => dock().getByLabel("AI에게 말하기").isDisabled()).toBe(false);   // 창은 열린 채 이어진다
  });

  it("★대화로 만들기 — AI가 하는 일이 보이고 · 작은 흐름도 · 이어서 고치면 직전 제안을 바탕으로 → «이대로 만들기»", async () => {
    nextFlow = {
      name: "주문 목록 저장",
      nodes: [
        { id: "w", type: "web", name: "주문 목록 읽기", config: { start: { kind: "url", url: "https://shop.example" }, actions: [{ kind: "readTable", label: "주문 목록", output: "orders", columns: ["주문번호"] }] } },
        { id: "f", type: "fileWrite", name: "저장", config: { data: "{{ $input.orders }}", target: { name: "주문", format: "csv" } } },
      ],
      edges: [{ from: "w", to: "f" }],
    };
    await say("쇼핑몰에서 주문 목록을 읽어 CSV로 저장");
    const card1 = chat().locator(".ai-proposal").first();
    await card1.waitFor();
    // AI가 한 일 — 묻기 → 초안(노드 2개) → 검사 통과
    const steps = chat().locator(".ai-steps").first();
    expect(await steps.innerText()).toMatch(/AI가 한 일 · \d단계/);
    await steps.getByRole("button").click();
    expect(await steps.innerText()).toMatch(/초안 — 노드 2개[\s\S]*검사 통과/);
    // 작은 흐름도 — 노드 두 개가 «새로» · 누르면 그 노드가 하는 일
    expect(await card1.locator(".ai-graph-node.added").count()).toBe(2);
    await card1.locator(".ai-graph-node", { hasText: "주문 목록 읽기" }).click();
    expect(await card1.locator(".ai-graph-detail").innerText()).toMatch(/주문 목록 → orders[\s\S]*녹화로/);
    // 이어서 고치기
    const first = nextFlow as { name: string; nodes: unknown[]; edges: unknown[] };
    nextFlow = { ...first, name: "주문 목록 저장(JSON)", nodes: first.nodes.map((n) => ((n as { id: string }).id === "f" ? { ...(n as object), config: { data: "{{ $input.orders }}", target: { name: "주문", format: "json" } } } : n)) };
    await say("CSV 말고 JSON으로 저장해 줘");
    await expect.poll(() => chat().locator(".ai-proposal").count()).toBe(2);
    await card1.getByText("다음 제안으로 바뀌었습니다").waitFor();
    const card2 = chat().locator(".ai-proposal").nth(1);
    expect(await card2.locator(".ai-graph-node.changed").count()).toBe(1);   // 저장 노드만 바뀜
    expect(await card2.locator(".ai-graph-node.added").count()).toBe(0);
    expect(systems.at(-2)).toMatch(/지금 고치는 워크플로우[\s\S]*주문 목록 저장/);
    await card2.getByRole("button", { name: "이대로 만들기" }).click();
    await page.waitForURL(/#\/flows\/ai-flow-1$/);
    await page.locator(".relay-node", { hasText: "주문 목록 읽기" }).waitFor();
    expect((await api("GET", "/api/flows/ai-flow-1")).draft).toMatchObject({ name: "주문 목록 저장(JSON)" });
    expect(new Set(usedKeys)).toEqual(new Set(["sk-ant-api03-MYKEY-abcdefghijklmnopqrstuvwxyz0123456789"]));
    expect(await page.locator(".issue-btn.bad").innerText()).toMatch(/문제/);
    // 편집 화면에서는 같은 창이 «고치기»로
    expect(await dock().innerText()).toMatch(/«주문 목록 저장\(JSON\)» 고치기/);
  });

  it("★«내 설정»에서 Gemini로 바꾸면 Gemini로 — 키는 AI마다 따로", async () => {
    await page.goto(`${app.url}/#/me`);
    await page.getByRole("radio", { name: /Gemini/ }).click();
    await page.getByText("넣은 키 없음").waitFor();
    await page.getByLabel("Gemini (Google) API 키").fill("AIzaSyTEST-abcdefghijklmnopqrstuvwxyz012345");
    await page.locator(".my-settings").getByRole("button", { name: "저장" }).click();
    await page.locator(".my-settings").getByLabel("모델", { exact: true }).selectOption("gemini-3.5-flash-lite");
    nextFlow = { name: "Gemini 워크플로우", nodes: [{ id: "h", type: "http", name: "주문 API", config: { method: "GET", url: "https://api.example/orders" } }], edges: [] };
    await page.goto(`${app.url}/#/`);
    await say("주문 API를 부르는 워크플로우");
    await dock().getByRole("button", { name: "이대로 만들기" }).click();
    await page.waitForURL(/#\/flows\/ai-flow-2$/);
    await page.locator(".relay-node", { hasText: "주문 API" }).waitFor();
    expect(usedKeys.at(-1)).toBe("gemini:AIzaSyTEST-abcdefghijklmnopqrstuvwxyz012345");
    await page.goto(`${app.url}/#/me`);
    await page.getByRole("radio", { name: /Claude/ }).click();
  });

  it("★편집 화면 — 제안이 캔버스에 먼저 그려진다(새로 · 바뀜 테두리) → 적용하면 초안 · 저장하면 남는다", async () => {
    const d = (await api("GET", "/api/flows/ai-flow-1")).draft;
    nextFlow = {
      ...d,
      nodes: [...d.nodes.map((n: { id: string; type: string; name: string; config: unknown }) => ({ id: n.id, type: n.type, name: n.name, config: n.type === "web" ? { start: { kind: "url", url: "https://shop.example" }, actions: [{ id: (n.config as { actions: { id: string }[] }).actions[0]!.id, kind: "readTable", label: "주문 목록", output: "orders" }] } : n.config })),
        { id: "k", type: "check", name: "목록 검사", config: { items: [{ id: "k1", label: "한 건 이상", actual: "{{ $input.orders }}", op: "countGte", expected: "1" }] } }],
      edges: [{ from: "w", to: "f" }, { from: "w", to: "k" }],
      settings: { schedules: [{ id: "s1", cron: "0 9 * * 1-5", params: {}, enabled: true }] },
    };
    await page.goto(`${app.url}/#/flows/ai-flow-1`);
    await page.locator(".relay-node", { hasText: "저장" }).waitFor();
    await dock().waitFor();
    await say("평일 9시에 돌고, 목록이 비면 불통과로 해 줘");
    const card = chat().locator(".ai-proposal").last();
    await card.waitFor();
    // ★캔버스 미리 보기 — 초안은 아직 그대로
    await page.locator(".ai-preview-bar").getByText(/AI 제안 미리 보기 — 새로 1/).waitFor();
    await page.locator(".relay-node.ai-added", { hasText: "목록 검사" }).waitFor();
    expect((await api("GET", "/api/flows/ai-flow-1")).draft.nodes.length).toBe(2);
    await card.getByRole("button", { name: "미리 보기 걷기" }).click();
    expect(await page.locator(".ai-preview-bar").count()).toBe(0);
    expect(await page.locator(".relay-node", { hasText: "목록 검사" }).count()).toBe(0);
    await card.getByRole("button", { name: "캔버스에서 보기" }).click();
    await page.locator(".ai-preview-bar").getByRole("button", { name: "적용" }).click();   // 캔버스 띠에서 적용
    await card.getByText("적용했습니다").waitFor();
    expect(await page.locator(".ai-preview-bar").count()).toBe(0);
    await page.locator(".relay-node", { hasText: "목록 검사" }).waitFor();
    await page.locator(".topbar").getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(async () => (await api("GET", "/api/flows/ai-flow-1")).draft.nodes.length).toBe(3);
    // 화면이 저장을 받아들일 때까지 — 그 전에 떠나면 «저장하지 않은 고침» 확인이 뜬다
    await page.locator(".topbar .save-state", { hasText: "저장됨" }).waitFor();
    expect((await api("GET", "/api/flows/ai-flow-1")).draft.settings.schedules[0].cron).toBe("0 9 * * 1-5");
  });

  it("★창 위쪽에서 AI · 모델 고르기 — 다음 말부터 그 모델로 · «내 설정»도 따라간다", async () => {
    await page.goto(`${app.url}/#/`);
    if (!(await dock().isVisible())) await page.getByRole("button", { name: "AI 어시스턴트 열기" }).click();
    const pick = dock().locator(".ai-picker");
    await pick.waitFor();
    expect(await pick.getByLabel("쓸 AI").inputValue()).toBe("anthropic");   // 앞 시험이 Claude로 되돌려 둠
    await pick.getByLabel("쓸 AI").selectOption("gemini");
    await pick.getByLabel("모델").selectOption("gemini-3.1-pro-preview");
    nextFlow = { name: "고른 모델", nodes: [{ id: "h", type: "http", name: "모델 API", config: { method: "GET", url: "https://api.example/m" } }], edges: [] };
    await say("API를 부르는 워크플로우");
    await chat().locator(".ai-proposal").first().waitFor();
    expect(usedModels.at(-1)).toBe("gemini-3.1-pro-preview");
    expect(usedKeys.at(-1)).toBe("gemini:AIzaSyTEST-abcdefghijklmnopqrstuvwxyz012345");
    // «내 설정»도 같은 것을 보인다
    await page.goto(`${app.url}/#/me`);
    expect(await page.getByRole("radio", { name: /Gemini/ }).getAttribute("aria-checked")).toBe("true");
    // 모델 목록이 오기 전에는 «모델 이름» 칸이 잠깐 보인다 — 정확한 이름으로 · 올 때까지 기다린다
    await expect.poll(() => page.locator(".my-settings").getByLabel("모델", { exact: true }).inputValue()).toBe("gemini-3.1-pro-preview");
    // 창에서 Claude로 되돌리면 «내 설정»이 바로 따라간다
    if (!(await dock().isVisible())) await page.getByRole("button", { name: "AI 어시스턴트 열기" }).click();
    await dock().locator(".ai-picker").getByLabel("쓸 AI").selectOption("anthropic");
    await expect.poll(() => page.getByRole("radio", { name: /Claude/ }).getAttribute("aria-checked")).toBe("true");
    expect(await dock().locator(".ai-picker").getByLabel("모델", { exact: true }).inputValue()).toBe("");   // Claude는 기본 모델
  });
});
