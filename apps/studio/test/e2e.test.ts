/**
 * 편집 화면 e2e — 빌드한 화면을 서버가 내주고, 진짜 브라우저로 누른다.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { generateKey, InProcessWorker, SecretBox, startApp, type App } from "@flowsmith/server";

const root = fileURLToPath(new URL("..", import.meta.url));
let site: TestSite;
let app: App;
let browser: Browser;
let page: Page;
let dir: string;

const pills = () => page.locator(".topbar").innerText();
const tile = (name: string) => page.locator(".relay-node", { hasText: name });
/** 라이브 페이지가 준비될 때까지 — ★화면(canvas)이 먼저 나타나야 한다. 그 전에는 «준비 중» 덮개도 없어서 «덮개가 사라지기»가 바로 끝난다 */
const liveReady = async () => {
  await page.locator(".recorder .live-stage canvas").waitFor({ timeout: 30_000 });
  await page.locator(".recorder .live-modal").waitFor({ state: "detached", timeout: 60_000 });
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  site = await startTestSite(0);
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist") });
  const j = JSON.parse(readFileSync(join(root, "../../examples/login-and-read.json"), "utf8"));
  j.vars.baseUrl = site.url;
  j.settings.defaultTimeoutMs = 3000;   // 요소가 없을 때 15초씩 기다리면 점검 · 실패 시험이 부하에 따라 흔들린다
  await fetch(`${app.url}/api/flows`, { method: "POST", body: JSON.stringify({ draft: j }) });
  await fetch(`${app.url}/api/flows/login-and-read/secrets/shop`, { method: "PUT", body: JSON.stringify({ value: { username: "kim", password: "p@ss" } }) });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("편집 화면", () => {
  it("목록에서 워크플로우를 열면 캔버스에 노드 넷이 그려진다", async () => {
    await page.goto(app.url);
    await page.getByText("로그인하고 주문 상태 읽기").click();
    await expect.poll(() => page.locator(".relay-node").count()).toBe(4);
    await expect.poll(() => page.locator(".react-flow__edge").count()).toBe(3);
    await expect.poll(pills).toContain("문제 없음");
    // 서랍은 닫혀 있다 — 캔버스가 전체 폭을 쓴다
    expect(await page.locator(".drawer").count()).toBe(0);
  });

  it("노드를 누르면 서랍이 열리고 동작이 사람 말로 보인다", async () => {
    await tile("주문 조회").click();
    await page.locator(".drawer").waitFor();
    const lines = await page.locator(".action .summary .text").allInnerTexts();
    expect(lines).toContain("'조회' 버튼을 누릅니다");
    expect(lines).toContain("주문 상태를 읽어 「status」(으)로 내보냅니다");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".drawer").count()).toBe(0);
  });

  it("★고치는 즉시 문제가 보이고, 노드에 경고가 붙는다", async () => {
    await tile("주문 조회").click();
    const summary = page.locator(".action .summary", { hasText: "주문번호" });
    // ★동작 문장 · 값 칸 어디에도 표현식이 보이지 않는다 — 사람 말 칩
    expect(await summary.innerText()).toContain("«실행 입력 › 주문번호»를 넣습니다");
    await summary.click();
    const form = page.locator(".action .form");
    expect(await form.locator(".tpl-chip").last().innerText()).toContain("실행 입력 › 주문번호");
    // 고급 보기로 표현식을 직접 고친다
    await form.locator(".tpl-raw").last().click();
    const value = form.locator("input.mono").last();
    await value.fill("{{ $params.없는입력 }}");
    await expect.poll(pills).toContain("문제 1");
    await expect.poll(pills).toContain("저장 안 됨");
    expect(await tile("주문 조회").locator(".tile-issue").count()).toBe(1);
    await form.locator(".tpl-raw").last().click();                   // 칩으로 — 닿지 않는 값은 빨간 칩
    expect(await form.locator(".tpl-chip.bad").count()).toBe(1);
    // 칩 빼기(×) → ＋로 다시 고르기
    await form.locator(".tpl-chip.bad button").click();
    expect(await form.locator(".tpl-chip").count()).toBe(0);
    await form.getByTitle("넣을 수 있는 값").last().click();
    await form.getByRole("button", { name: "실행 입력 › 주문번호" }).click();
    expect(await form.locator(".tpl-chip").last().innerText()).toContain("실행 입력 › 주문번호");
    await expect.poll(pills).toContain("문제 없음");
  });

  it("★출력 점의 ＋로 다음 노드를 골라 바로 잇고, Ctrl+S로 저장한다", async () => {
    await page.keyboard.press("Escape");
    await tile("금액 숫자로").locator(".port-add button").click();
    await page.locator(".picker-item", { hasText: "커스텀" }).click();
    await expect.poll(() => page.locator(".relay-node").count()).toBe(5);
    await expect.poll(() => page.locator(".react-flow__edge").count()).toBe(4);
    await page.keyboard.press("Control+s");
    await expect.poll(pills).toContain("저장됨");
    const saved = await (await fetch(`${app.url}/api/flows/login-and-read`)).json() as { draft: { nodes: unknown[]; edges: unknown[] } };
    expect(saved.draft.nodes).toHaveLength(5);
    expect(saved.draft.edges).toHaveLength(4);
    // 되돌린다 — 새 노드(서랍에 열려 있다)를 지우고 저장
    await page.locator(".drawer").getByTitle("노드 지우기").click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => page.locator(".relay-node").count()).toBe(4);
  });

  it("★HTTP 요청 노드 · 알림 — 노드를 고르면 설정이 열리고, 알림은 «언제 · 어디로»를 고른다", async () => {
    await page.keyboard.press("Escape");
    await tile("금액 숫자로").locator(".port-add button").click();
    await page.locator(".picker-item", { hasText: "HTTP 요청" }).click();
    await expect.poll(() => page.locator(".relay-node").count()).toBe(5);
    await expect.poll(() => tile("HTTP 요청").innerText()).toContain("GET (주소 없음)");
    await expect.poll(pills).toMatch(/문제 \d/);                       // 주소가 비었다
    const drawer = page.locator(".drawer");
    await drawer.getByPlaceholder("https://api.example.com/v1/items").fill("https://api.example.com/v1/items");
    await drawer.getByRole("button", { name: "Accept: JSON" }).click();
    await expect.poll(pills).toContain("문제 없음");
    await expect.poll(() => tile("HTTP 요청").innerText()).toContain("GET api.example.com");
    await drawer.locator("select").first().selectOption("POST");
    expect(await drawer.innerText()).toContain("다시 하지 않습니다");
    await drawer.getByTitle("노드 지우기").click();
    await expect.poll(() => page.locator(".relay-node").count()).toBe(4);

    await page.locator(".notify-btn").click();
    await page.getByRole("button", { name: "＋ 알림 더하기" }).click();
    const rule = page.locator(".drawer .subcard").first();
    for (const w of ["실패", "다시 성공(회복)", "사이트가 바뀜"]) expect(await rule.getByLabel(w, { exact: true }).isChecked()).toBe(true);
    await rule.locator("input.mono").fill("https://hooks.slack.com/services/T/B/x");
    expect(await rule.innerText()).toContain("그 자체가 열쇠");
    await expect.poll(() => page.locator(".notify-btn .trig-count").innerText()).toBe("1");
    expect(await rule.getByRole("button", { name: "시험 보내기" }).isDisabled()).toBe(true);   // 저장 전
    await rule.getByTitle("알림 지우기").click();
    await page.keyboard.press("Control+s");
    await expect.poll(pills).toContain("저장됨");
    await page.keyboard.press("Escape");
  }, 40_000);

  it("★실행 버튼으로 돌리면 노드에 상태 표시가 붙고 로그에 결과가 나온다", async () => {
    await page.locator(".run-btn").click();
    await page.locator(".launcher-pop input").first().fill("A-1001");
    await page.locator(".run-btn").click();
    await page.locator(".logpanel-head .dot.ok").waitFor({ timeout: 20_000 });
    await expect.poll(() => page.locator(".relay-node.st-succeeded").count()).toBe(4);
    const result = await page.locator(".runlog-detail pre.json").first().innerText();
    expect(JSON.parse(result)).toEqual({ amountNumber: 12500, status: "배송중" });
    expect(await page.content()).not.toContain("p@ss");
  });

  it("★값 다듬기 — 코드 없이 단계를 고르고, 마지막 실행의 값으로 바로 미리 본다", async () => {
    await tile("금액 숫자로").locator(".port-add button").click();
    await page.locator(".picker-item", { has: page.locator(".picker-title", { hasText: /^값 다듬기$/ }) }).click();
    const drawer = page.locator(".drawer");
    await drawer.getByRole("button", { name: /앞 단계의 「.+」 쓰기/ }).click();
    expect(await drawer.locator(".tpl-chip").first().innerText()).toContain("금액 숫자로 ›");
    // 앞 단계가 방금 돌았다 — 그 값으로 미리 본다
    await expect.poll(() => drawer.innerText()).toContain("1행 → 1행");
    await drawer.getByRole("button", { name: "거르기 — 맞는 행만" }).click();
    const step = drawer.locator(".tf-step-body");
    await step.locator("input[list]").first().fill("값");
    await step.locator("select").first().selectOption({ label: "≥" });
    await step.locator(".tpl-text").last().fill("20000");
    await expect.poll(() => drawer.innerText()).toContain("1행 → 0행");
    await step.locator(".tpl-text").last().fill("10000");
    await expect.poll(() => drawer.innerText()).toContain("1행 → 1행");
    expect(await drawer.locator(".tf-step-head").first().innerText()).toContain("「값」 ≥ 「10000」인 행만");
    expect(await tile("값 다듬기").innerText()).toContain("거르기");
    // ★노드 창의 «이 단계까지 실행» — 처음부터 이 노드까지 돌려, 출력 칸에 표로 보이고 엑셀로 받는다
    await page.locator(".ndv").getByRole("button", { name: /이 단계까지 실행/ }).click();
    const out = page.locator(".ndv-pane").last();
    const table = out.locator(".data-table");
    await table.waitFor({ timeout: 20_000 });
    expect(await table.innerText()).toContain("12500");
    expect(await page.locator(".ndv-pane").first().innerText()).toContain("12500");     // 입력 칸 — 앞 단계가 준 값
    const [download] = await Promise.all([page.waitForEvent("download"), out.getByRole("button", { name: /엑셀로 받기/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^값 다듬기 1-\d{8}-\d{4}\.xlsx$/);
    await out.locator(".seg-tabs").getByRole("button", { name: "JSON" }).click();
    expect(await out.locator("pre.json").last().innerText()).toContain('"count": 1');
    // 뒤 노드는 돌리지 않았다
    await expect.poll(() => page.locator(".logpanel-head").innerText()).toContain("「값 다듬기 1」까지 돌렸습니다");
    await drawer.getByTitle("노드 지우기").click();
    await expect.poll(() => page.locator(".relay-node").count()).toBe(4);
  }, 40_000);

  it("★★녹화 — 라이브 화면을 눌러 읽기 동작을 기록하고 「녹화 끝」으로 노드에 넣는다", async () => {
    await tile("주문 조회").click();
    const before = await page.locator(".action").count();
    await page.getByRole("button", { name: /녹화로 동작 더하기/ }).click();
    await page.getByRole("button", { name: "● 녹화 시작" }).click();
    // 앞 단계(로그인)와 이 노드의 동작을 재생한 뒤 준비가 된다
    await liveReady();
    const canvas = page.locator(".live-stage canvas");
    const vw = Number(await canvas.getAttribute("width"));
    const vh = Number(await canvas.getAttribute("height"));
    const box = (await canvas.boundingBox())!;

    // 같은 크기의 참조 페이지에서 «금액» 칸의 좌표를 잰다
    const ref = await browser.newPage({ viewport: { width: vw, height: vh } });
    await ref.goto(`${site.url}/login`);
    await ref.fill("#uid", "kim"); await ref.fill("#pw", "p@ss"); await ref.click("button");
    await ref.goto(`${site.url}/orders?no=A-1001&period=1m`);
    const target = (await ref.locator("#order-amount").boundingBox())!;
    await ref.close();

    await page.locator(".rec-modes").getByRole("button", { name: "읽기" }).click();
    const s = box.width / vw;
    await page.mouse.click(box.x + (target.x + target.width / 2) * s, box.y + (target.y + target.height / 2) * s);
    await page.locator(".rec-item").first().waitFor({ timeout: 15_000 });
    expect(await page.locator(".rec-item").first().innerText()).toContain("금액을 읽어");
    await page.getByRole("button", { name: /녹화 끝/ }).click();

    await page.locator(".drawer").waitFor();
    await expect.poll(() => page.locator(".action").count()).toBe(before + 1);
    expect(await page.locator(".action .summary .text").last().innerText()).toBe("금액을 읽어 「금액」으로 내보냅니다");
    await expect.poll(pills).toContain("저장 안 됨");
  }, 60_000);

  it("실패하면 무엇이 · 어디서 · 왜를 보여 주고, 실행 기록에 남는다", async () => {
    await page.keyboard.press("Escape");                            // 녹화 뒤 열려 있는 노드 창을 닫는다
    await page.locator(".run-more").click();
    await page.locator(".launcher-pop input").first().fill("없는주문");
    await page.locator(".run-btn").click();
    await page.locator(".failure").waitFor({ timeout: 30_000 });
    const text = await page.locator(".failure").innerText();
    expect(text).toContain("요소를 못 찾음");
    expect(text).toContain("주문 상태");
    expect(text).toContain("CSS #order-status");
    // ★무엇을 해 주세요 · 고치는 단추
    expect(await page.locator(".failure .fix-hint").innerText()).toMatch(/화면에 없습니다.*\[다시 지정\]/);
    expect(await page.locator(".failure").getByRole("button", { name: "다시 지정" }).count()).toBe(1);
    await expect.poll(() => page.locator(".relay-node.st-failed").count()).toBe(1);

    await page.getByRole("button", { name: "실행 기록" }).click();
    await expect.poll(() => page.locator(".exec-item").count()).toBe(3);   // 앞의 성공 둘(실행 버튼 · 값 다듬기) + 이 실패
    // ★실행 기록(알림의 링크로 오는 곳)에서도 — «노드 열기»는 편집기로 와서 그 노드를 연다
    await page.locator(".exec-item").first().click();
    await page.locator(".exec-detail .failure").getByRole("button", { name: "노드 열기" }).click();
    await page.locator(".drawer").waitFor();
    expect(await page.locator(".drawer .title-input").inputValue()).toBe("주문 조회");
    await page.keyboard.press("Escape");
  }, 40_000);

  it("★트리거 — 일정은 사람 말 · 다음 시각으로 보이고, 웹훅 토큰은 한 번만 보이며 그 토큰으로 돌린 실행이 기록에 «웹훅»으로 남는다", async () => {
    await page.getByRole("button", { name: "편집기" }).click();
    await page.locator(".trig-btn:not(.notify-btn)").click();
    await page.getByRole("button", { name: "＋ 일정 더하기" }).click();
    const sub = page.locator(".drawer .subcard").first();
    expect(await sub.innerText()).toContain("평일 9시");
    expect(await sub.innerText()).toMatch(/다음: .+ · .+ · .+/);
    await sub.locator("input.mono").fill("0 25 * * *");
    expect(await sub.innerText()).toMatch(/시 칸 "25"/);
    await sub.getByRole("button", { name: "매일 18시" }).click();
    expect(await sub.innerText()).toContain("매일 18시");
    await expect.poll(() => page.locator(".trig-count").innerText()).toBe("1");

    await page.getByRole("button", { name: "웹훅 켜기" }).click();
    const token = (await page.locator(".drawer code.token").first().innerText()).trim();
    expect(token).toMatch(/^fsk_/);
    // 바깥에서 부른다 — 게시된 버전이 있어야 한다
    await page.keyboard.press("Control+s");
    await fetch(`${app.url}/api/flows/login-and-read/versions`, { method: "POST", body: "{}" });
    await fetch(`${app.url}/api/flows/login-and-read/deploy`, { method: "POST", body: JSON.stringify({ version: 1 }) });
    const hook = await (await fetch(`${app.url}/api/hooks/login-and-read?wait=1`, { method: "POST", headers: { "x-flowsmith-token": token }, body: JSON.stringify({ orderNo: "A-1001" }) })).json() as { status: string };
    expect(hook.status).toBe("success");
    await page.getByRole("button", { name: "실행 기록" }).click();
    await expect.poll(() => page.locator(".exec-item").first().innerText()).toContain("웹훅");
    // 알림의 링크 — #/flows/:id/runs/:runId 는 그 실행을 고른 «실행 기록»으로 연다
    const runs = await (await fetch(`${app.url}/api/flows/login-and-read/runs`)).json() as { id: string }[];
    const older = runs[runs.length - 1]!.id;
    await page.goto(`${app.url}/#/flows/login-and-read/runs/${older}`);
    await expect.poll(() => page.locator(".exec-item.on").count()).toBe(1);
    expect(await page.locator(".exec-item").last().getAttribute("class")).toContain(" on");
    await page.goto(`${app.url}/#/flows/login-and-read`);
    // 다시 열면 토큰은 안 보인다
    await page.getByRole("button", { name: "편집기" }).click();
    // 탭을 오가도 편집 화면은 그대로라 서랍이 열려 있을 수 있다 — 닫혀 있으면 연다(실행 기록에 다녀오며 서랍 안은 새로 그려졌다)
    if ((await page.locator(".drawer").count()) === 0) await page.locator(".trig-btn:not(.notify-btn)").click();
    expect(await page.locator(".drawer").innerText()).not.toContain(token);
  }, 60_000);

  it("★★변경 감시 — 사이트가 바뀌면 배너 · 노드 배지가 뜨고, [다시 지정]으로 새 요소를 고른다", async () => {
    await page.getByRole("button", { name: "편집기" }).click();   // 앞 시험이 «실행 기록»에 두고 갔다
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+s");
    await expect.poll(pills).toContain("저장됨");
    site.setLayout(2);
    try {
      await page.locator(".monitor-btn").click();
      await page.locator(".drawer").getByRole("button", { name: /지금 점검/ }).click();
      // 앞 시험(없는 주문)이 건 확인 점검이 줄을 서 있을 수 있다 — 점검은 한 번에 하나씩 돈다
      await page.locator(".drift-banner").waitFor({ timeout: 70_000 });
      expect(await page.locator(".drift-banner").innerText()).toContain("사이트가 바뀐 것 같습니다");
      await expect.poll(() => tile("주문 조회").locator(".tile-drift.broken").count()).toBe(1);
      const card = page.locator(".drawer .finding", { hasText: "'조회' 버튼" });
      expect(await card.innerText()).toContain("없음");

      const wsLog: string[] = [];
      page.on("websocket", (ws) => ws.on("framereceived", (f) => { if (typeof f.payload === "string" && !f.payload.includes("\"progress\"")) wsLog.push(f.payload.slice(0, 160)); }));
      // 다시 지정 — 그 동작 앞까지 재생한 레코더에서 «검색» 단추를 고른다
      await card.getByRole("button", { name: "다시 지정" }).click();
      await liveReady();
      expect(await page.locator(".rec-panel h2").innerText()).toContain("다시 지정");
      const canvas = page.locator(".live-stage canvas");
      const vw = Number(await canvas.getAttribute("width"));
      const vh = Number(await canvas.getAttribute("height"));
      const box = (await canvas.boundingBox())!;
      const ref = await browser.newPage({ viewport: { width: vw, height: vh } });
      await ref.goto(`${site.url}/login`);
      await ref.fill("#uid", "kim"); await ref.fill("#pw", "p@ss"); await ref.click("button");
      await ref.goto(`${site.url}/orders`);
      const btn = (await ref.getByRole("button", { name: "검색" }).boundingBox())!;
      await ref.close();
      const s = box.width / vw;
      await page.mouse.click(box.x + (btn.x + btn.width / 2) * s, box.y + (btn.y + btn.height / 2) * s);

      await page.locator(".drawer .action").first().waitFor({ timeout: 40_000 })
        .catch(async (e) => { throw new Error(`다시 지정이 안 됐습니다: ${wsLog.join(" | ")}`, { cause: e }); });
      const lines = await page.locator(".action .summary .text").allInnerTexts();
      expect(lines).toContain("'검색' 버튼을 누릅니다");
      await expect.poll(pills).toContain("저장 안 됨");
    } finally {
      site.setLayout(1);
    }
  }, 150_000);
});

describe("첫 화면 — 템플릿", () => {
  it("★«무엇을 자동화할까요?»에서 고르고 몇 가지만 답하면 뼈대가 짜이고, «다음 할 일»이 녹화부터 이끈다", async () => {
    // 앞 시험이 만든 워크플로우가 있다 — 그때 템플릿은 템플릿 화면에만. 앞 시험이 고침을 남겼으면 «떠날까요?»에 떠난다고 답한다
    const leave = (d: import("playwright").Dialog) => void d.accept();
    page.on("dialog", leave);
    await page.goto(`${app.url}/#/templates`);
    await page.locator(".tpl-card").first().waitFor();
    page.off("dialog", leave);
    await page.locator(".tpl-card", { hasText: "사이트에서 값 읽어 엑셀로 쌓기" }).click();
    const form = page.locator(".tpl-form");
    await form.getByPlaceholder("https://…").fill("example.com");
    expect(await form.innerText()).toContain("http:// 또는 https://로 시작하는 주소");
    expect(await form.getByRole("button", { name: "만들기" }).isDisabled()).toBe(true);
    await form.getByPlaceholder("https://…").fill(`${site.url}/orders`);
    await form.locator("select").first().selectOption({ label: "매시 정각" });
    await form.getByRole("button", { name: "만들기" }).click();
    // 편집 화면 — 노드 둘 · 다음 할 일
    await expect.poll(() => page.locator(".relay-node").count()).toBe(2);
    const guide = page.locator(".guide");
    await guide.waitFor();
    expect(await guide.innerText()).toContain("「값 읽기」 — 녹화로 동작 만들기");
    expect(await guide.innerText()).toContain("게시하면 매시 정각에 돕니다");
    await guide.locator(".guide-item.next").getByRole("button", { name: "열기" }).click();
    await page.locator(".drawer").getByRole("button", { name: /녹화로 동작 더하기/ }).waitFor();
    // 접으면 다음 하나만
    await page.keyboard.press("Escape");                            // 노드 창을 닫고
    await guide.getByTitle("접기").click();
    expect(await guide.locator(".guide-item").count()).toBe(1);
    // 첫 화면 목록에 생겼다 — id는 자동
    const flows = await (await fetch(`${app.url}/api/flows`)).json() as { id: string; name: string }[];
    expect(flows.find((f) => f.name === "사이트에서 값 읽어 엑셀로 쌓기")?.id).toMatch(/^watch-[a-z0-9]{4}$/);
  }, 40_000);
});
