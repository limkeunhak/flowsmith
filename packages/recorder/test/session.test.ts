/**
 * 녹화 세션 — 진짜 브라우저 · 시험 사이트. 사람의 손은 Playwright로 흉내 낸다(세션 페이지에 직접).
 * ★마지막 시험이 이 패키지의 주장이다: 녹화한 동작으로 만든 플로우가 엔진에서 그대로 돈다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow, type Flow, type WebAction } from "@flowsmith/core";
import { inspectTarget, probeTargets, runFlow } from "@flowsmith/engine";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { readLabel, RecorderSession, type Recorded, type ServerMessage } from "../src/index.ts";

let site: TestSite;
let browser: Browser;
const SECRETS = { shop: { username: "kim", password: "p@ss" } };

beforeAll(async () => {
  site = await startTestSite(0);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

const example = (): any => {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
  j.vars.baseUrl = site.url;
  return j;
};

async function open(draft: any, nodeId: string, opts: { replay?: boolean; replayExisting?: boolean; params?: Record<string, string> } = {}) {
  const msgs: ServerMessage[] = [];
  let frames = 0;
  const s = await RecorderSession.open(browser, {
    t: "open", flowId: draft.id, nodeId, draft, params: opts.params ?? {},
    replay: opts.replay ?? true, replayExisting: opts.replayExisting ?? false, viewport: { width: 1280, height: 800 },
  }, SECRETS, { send: (m) => msgs.push(m), frame: () => { frames++; } });
  const recorded = () => msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : []));
  const notices = () => msgs.flatMap((m) => (m.t === "notice" ? [m.text] : []));
  return { s, msgs, recorded, notices, frames: () => frames };
}

/**
 * 노드의 동작을 녹화한 것으로 바꾼 플로우 — 사람이 「녹화 끝」을 누른 것과 같다.
 * 그 노드 뒤쪽(예시의 조건 · 커스텀)은 녹화된 출력 이름과 맞지 않으므로 뺀다.
 */
function withActions(draft: any, nodeId: string, actions: WebAction[]): Flow {
  const j = structuredClone(draft);
  const keep = j.nodes.slice(0, j.nodes.findIndex((n: any) => n.id === nodeId) + 1);
  keep.find((n: any) => n.id === nodeId).config.actions = actions.map((a, i) => ({ ...a, id: `a${i + 1}` }));
  j.nodes = keep;
  j.edges = j.edges.filter((e: any) => keep.some((n: any) => n.id === e.to.node));
  return parseFlow(j);
}

describe("녹화 세션", () => {
  it("★앞 노드(로그인)를 재생해 시작 지점까지 간 뒤, 넣기 · 누르기 · 읽기를 녹화한다 — 그리고 그대로 돈다", async () => {
    const draft = example();
    draft.nodes[1].config.actions = [];   // 「주문 조회」를 처음부터 녹화한다
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/orders" };
    const { s, msgs, recorded, frames } = await open(draft, "search");
    try {
      expect(msgs.some((m) => m.t === "phase" && m.phase === "ready")).toBe(true);
      expect(s.page.url()).toContain("/orders");          // 로그인을 지나 주문 조회 화면에 와 있다
      await expect.poll(frames).toBeGreaterThan(0);        // 화면이 흘러나온다

      // 사람: 주문번호를 치고 「조회」를 누른다
      await s.page.getByPlaceholder("주문번호").fill("A-1001");
      await s.page.getByRole("button", { name: "조회" }).click();
      await s.settle();
      await s.page.waitForURL(/no=A-1001/);              // ★서버가 대신 눌렀다

      // 사람: 읽기 모드로 상태와 품목 표의 칸을 고른다
      await s.setMode("read");
      await s.page.locator("#order-status").click();
      await s.page.locator("#items td.name").first().click();
      await s.settle();

      const items = recorded();
      expect(items.map((i) => i.action.kind)).toEqual(["fill", "click", "read", "read"]);
      const [fill, click, status, cell] = items as [Recorded, Recorded, Recorded, Recorded];
      expect(fill.action.kind === "fill" && fill.action.value).toBe("A-1001");
      expect(fill.action.kind === "fill" && fill.action.target.locators[0]).toEqual({ kind: "placeholder", value: "주문번호" });
      expect(click.action.kind === "click" && click.action.target.locators[0]).toEqual({ kind: "role", value: "button", name: "조회" });
      expect(click.action.risk).toBe("safe");
      expect(click.warnings).toEqual([]);
      // 읽기의 이름은 내용(「배송중」)이 아니라 둘레 글자(「상태」)에서 짓는다
      expect(status.action.kind === "read" && status.action.target.label).toBe("상태");
      expect(status.action.kind === "read" && status.action.output).toBe("상태");
      expect(status.needs).toBe("output");
      // 표의 칸은 행 글자가 아니라 열 머리글로 부른다
      expect(cell.action.kind === "read" && cell.action.output).toBe("품목");
      expect(cell.table?.rows).toBe(2);
      expect(cell.table?.action.table.columns.map((c) => c.name)).toEqual(["품목", "수량", "금액"]);

      // ★녹화한 것(표는 표 전체로 바꿔서)으로 플로우를 만들어 엔진으로 돌린다
      const flow = withActions(draft, "search", [fill.action, click.action, status.action, cell.table!.action]);
      const run = await runFlow(flow, { params: { orderNo: "A-1001" }, secrets: SECRETS, browser });
      expect(run.status, JSON.stringify(run.nodes.map((n) => n.failure))).toBe("success");
      expect(run.output).toMatchObject({ 상태: "배송중", 표: [{ 품목: "연필", 수량: "10", 금액: "5,000원" }, { 품목: "공책", 수량: "3", 금액: "7,500원" }] });
    } finally {
      await s.close();
    }
  });

  it("★★비밀번호는 값을 받지도 않고 «시크릿을 고르세요»로 남는다", async () => {
    const draft = example();
    draft.nodes[0].config.actions = [];
    const { s, msgs, recorded } = await open(draft, "login");
    try {
      await s.page.locator("#uid").fill("kim");
      await s.page.locator("#pw").fill("p@ss");
      await s.page.getByRole("button", { name: "로그인" }).click();
      await s.settle();
      await s.page.waitForURL(/\/home/);
      const items = recorded();
      expect(items.map((i) => [i.action.kind, i.needs])).toEqual([["fill", null], ["fill", "secret"], ["click", null]]);
      expect(items[2]!.action.risk).toBe("safe");   // 로그인은 POST여도 «되돌릴 수 없음»이 아니다
      expect(items[1]!.action.kind === "fill" && items[1]!.action.value).toBe("");
      expect(JSON.stringify(msgs)).not.toContain("p@ss");
    } finally {
      await s.close();
    }
  });

  it("엔터로 제출하면 넣기와 엔터 키가 함께 남는다", async () => {
    const draft = example();
    draft.nodes[1].config.actions = [];
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/orders" };
    const { s, recorded } = await open(draft, "search");
    try {
      await s.page.getByPlaceholder("주문번호").fill("A-1001");
      await s.page.getByPlaceholder("주문번호").press("Enter");
      await s.settle();
      await s.page.waitForURL(/no=A-1001/);
      expect(recorded().map((i) => i.action.kind)).toEqual(["fill", "press"]);
    } finally {
      await s.close();
    }
  });

  it("★금지 버튼은 녹화 중에도 누르지 않는다", async () => {
    const before = site.stats.cancelPosts;
    const draft = example();
    draft.nodes[1].config.actions = [];
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/orders?no=A-1001" };
    const { s, recorded, notices } = await open(draft, "search");
    try {
      await s.page.getByRole("button", { name: "주문 취소" }).click();
      await s.settle();
      expect(recorded()).toEqual([]);
      expect(notices().join("\n")).toMatch(/금지 버튼/);
      expect(site.stats.cancelPosts).toBe(before);
    } finally {
      await s.close();
    }
  });

  it("고르기 — 보기 목록을 화면에 넘기고, 고른 것을 녹화한다", async () => {
    const draft = example();
    draft.nodes[1].config.actions = [];
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/orders" };
    const { s, msgs, recorded } = await open(draft, "search");
    try {
      await s.page.locator("#period").click();
      await s.settle();
      const open_ = msgs.find((m) => m.t === "select-open");
      expect(open_ && open_.t === "select-open" && open_.options.map((o) => o.label)).toEqual(["1개월", "3개월", "1년"]);
      await s.input({ t: "select-choose", token: (open_ as any).token, value: "3m" });
      await s.settle();
      const sel = recorded()[0]!;
      expect(sel.action.kind === "select" && sel.action.value).toBe("3개월");
      expect(sel.action.kind === "select" && sel.action.target.locators[0]).toEqual({ kind: "role", value: "combobox", name: "기간" });
      expect(await s.page.locator("#period").inputValue()).toBe("3m");
    } finally {
      await s.close();
    }
  });

  it("iframe 안의 요소는 프레임 경로와 함께 녹화된다", async () => {
    const draft = example();
    draft.nodes[1].config.actions = [];
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/frame" };
    const { s, recorded } = await open(draft, "search");
    try {
      const inner = s.page.frameLocator("#inner");
      await inner.locator("#memo").fill("안녕");
      await inner.locator("#echo").click();
      await s.settle();
      const [fill, click] = recorded();
      expect(fill!.action.kind === "fill" && fill!.action.target.frames).toEqual(["#inner"]);
      expect(click!.action.kind === "click" && click!.action.target.frames).toEqual(["#inner"]);
      await expect.poll(() => inner.locator("#out").innerText()).toBe("안녕");
    } finally {
      await s.close();
    }
  });

  it("둘러보기 모드에서는 아무것도 녹화하지 않는다", async () => {
    const draft = example();
    draft.nodes[1].config.actions = [];
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/orders" };
    const { s, recorded } = await open(draft, "search");
    try {
      await s.setMode("browse");
      await s.page.getByPlaceholder("주문번호").fill("A-1001");
      await s.page.getByRole("button", { name: "조회" }).click();
      await s.page.waitForURL(/no=A-1001/);
      await s.settle();
      expect(recorded()).toEqual([]);
    } finally {
      await s.close();
    }
  });
});

describe("레코더와 점검의 지문", () => {
  it("★레코더가 뜬 지문을 엔진 점검이 «그대로»로 본다 — 두 곳의 지문 규칙이 같다", async () => {
    const draft = example();
    draft.nodes[1].config.actions = [];
    draft.nodes[1].config.start = { kind: "url", url: "{{ $vars.baseUrl }}/orders?no=A-1001" };
    const { s, recorded } = await open(draft, "search");
    try {
      await s.page.getByPlaceholder("주문번호").fill("A-1002");
      await s.page.locator("#period").click();            // select — 보기만 열고 닫는다
      await s.setMode("read");
      await s.page.locator("#order-status").click();
      await s.page.locator("#order-amount").click();
      await s.page.locator("#items td.qty").first().click();
      await s.setMode("record");
      await s.page.getByRole("checkbox").click();          // 체크 — 서버가 대신 켠다
      await s.settle();
      // 읽기의 이름은 «부모의 자기 글자»에서 — 「상태: <b>배송중</b>」 → 「상태」
      expect(recorded().filter((i) => i.action.kind === "read").map((i) => i.action.kind === "read" && i.action.output)).toEqual(["상태", "금액", "수량"]);
      for (const it of recorded()) {
        for (const t of probeTargets(it.action)) {
          if (it.action.kind === "check") continue;   // 켜고 나면 상태가 다르다 — 지문은 같아야 하지만 여기선 넘긴다
          const f = await inspectTarget(s.page, t, 2000);
          expect([it.action.kind, f.status, f.differences]).toEqual([it.action.kind, "ok", []]);
        }
      }
    } finally {
      await s.close();
    }
  });
});

describe("이름 짓기", () => {
  it("읽을 요소는 둘레 글자에서 제 내용을 빼고 부른다", () => {
    expect(readLabel({ label: "배송중", fingerprint: { tag: "b", attrs: {}, text: "배송중", nearText: "상태: 배송중" } })).toBe("상태");
    expect(readLabel({ label: "'아이디' 칸", fingerprint: { tag: "input", attrs: {}, text: "", nearText: "아이디" } })).toBe("아이디");
    expect(readLabel({ label: "합계", fingerprint: null })).toBe("합계");
  });
  it("★둘레 글자가 없고 이름이 곧 내용이면(뉴스 제목) 내용으로 부르지 않는다", () => {
    expect(readLabel({ label: "'[뉴스9 날씨] 내일, 다시 기온 올라…큰 일교차 주의' 링크", fingerprint: { tag: "a", attrs: {}, text: "[뉴스9 날씨] 내일, 다시 기온 올라…큰 일교차 주의", nearText: "" } })).toBe("값");
  });
});
