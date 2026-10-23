/**
 * 되풀이 목록 읽기 — 표가 아닌 목록(네이버 뉴스 검색 결과 같은 것).
 * 시험 사이트 /news가 네이버의 까다로운 점을 흉내 낸다: 해시 클래스 · 한 건 안의 같은 모양 링크 둘(제목 · 요약) ·
 * 강조 글자(<mark>) · 화면 읽기용 숨은 글자(「새 창 열림」) · 사진이 없는 건.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow, type WebAction } from "@flowsmith/core";
import { runFlow } from "@flowsmith/engine";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { RecorderSession, type ServerMessage } from "../src/index.ts";

let site: TestSite;
let browser: Browser;

beforeAll(async () => {
  site = await startTestSite(0);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

const draft = (): any => ({
  schemaVersion: 1, id: "news", name: "뉴스", description: "", params: [], vars: {}, secrets: [], edges: [],
  settings: { forbiddenLabels: [], defaultTimeoutMs: 15000, monitorIntervalMin: null, probeParams: {}, browser: "launch", schedules: [] },
  nodes: [{ id: "n", type: "web", name: "뉴스", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${site.url}/news` }, actions: [] } }],
});

describe("되풀이 목록 읽기", () => {
  it("★제목 하나를 누르면 «목록 전체로»를 제안한다 — 이름 · 위치는 내용이 아니라 구조로, 그대로 돈다", async () => {
    const d = draft();
    const msgs: ServerMessage[] = [];
    const s = await RecorderSession.open(browser, {
      t: "open", flowId: d.id, nodeId: "n", draft: d, params: {}, replay: false, replayExisting: false, viewport: { width: 1280, height: 800 },
    }, {}, { send: (m) => msgs.push(m), frame: () => undefined });
    try {
      await s.setMode("read");
      await s.page.locator("mark").first().click();   // 제목 안의 강조 글자를 눌러도 제목 링크 전체를 고른다
      await s.settle();
      const [it] = msgs.flatMap((m) => (m.t === "recorded" ? [m.item] : []));
      expect(it!.action.kind).toBe("read");
      const read = it!.action as Extract<WebAction, { kind: "read" }>;
      // ★이름이 내용(제목)이 아니다 · 내용으로 찾는 위치(글자 · 이름 붙은 링크)를 쓰지 않는다
      expect(read.output).toBe("값");
      expect(read.target.locators.every((l) => l.kind === "css")).toBe(true);
      // 화면 읽기용 숨은 글자는 빼고 읽는다
      expect(it!.current).toBe("[뉴스9 날씨] 내일, 다시 기온 올라…큰 일교차 주의");

      // 목록 — 한 건 안의 «제목 · 요약» 되풀이가 아니라 뉴스 3건
      expect(it!.table).toMatchObject({ rows: 3, list: true });
      const t = it!.table!.action;
      expect(t.table.columns.map((c) => [c.name, c.strategy])).toEqual([["제목", "auto"], ["링크", "link"]]);
      // ★해시 클래스(빌드마다 바뀐다)를 쓰지 않는다
      const sels = [t.table.rows.locators[0]!.value, ...t.table.columns.map((c) => c.selector)];
      for (const sel of sels) expect(sel).not.toMatch(/G9AjKl_FKMqXujGm|t_Om6lnKIHMRgeAj|iOv6ot9ABhc36Aum/);

      const j = draft();
      j.nodes[0].config.actions = [{ ...t, id: "a1", output: "news" }];
      const r = await runFlow(parseFlow(j), { browser });
      expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
      expect(r.output).toEqual({ news: [
        { 제목: "[뉴스9 날씨] 내일, 다시 기온 올라…큰 일교차 주의", 링크: `${site.url}/n/1` },
        { 제목: "[날씨] 주말까지 '포근'…일요일 요란한 가을비", 링크: "https://news.example/2" },
        { 제목: "[날씨/XR] '단풍' 작년보다 빨라…일요일 전국 비", 링크: `${site.url}/n/3` },
      ] });
    } finally {
      await s.close();
    }
  });
});
