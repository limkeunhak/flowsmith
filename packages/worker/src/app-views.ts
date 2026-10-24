/**
 * **앱 안 브라우저 뷰**(PLAN §44 · DESKTOP.md §4) — 데스크톱 앱이 WebContentsView를 열고, 워커는 CDP로 붙어 그 뷰를 Page로 받는다.
 *
 *   워커 → 앱   { t: "view:open", id, purpose, title }   실행이면 따로 창 · 녹화면 편집 화면의 라이브 패널 자리
 *   앱 → 워커   { t: "view:opened", id } | { t: "view:failed", id, message }
 *   워커 → 앱   { t: "view:close", id } | { t: "view:focus", id }   (focus — 사람을 기다리기 시작했다: 실행 창을 앞으로)
 *
 * 뷰는 처음에 표시 주소(`…#fs-view=<id>`)를 연다 — 워커는 그 주소로 **자기가 연 뷰만** 고른다(편집 화면은 건드리지 않는다 — §4의 약속).
 * ★CDP 연결 하나를 모든 뷰가 함께 쓴다 — 실행 · 녹화가 끝나도 연결은 놓지 않는다(연결을 닫는 것은 이 객체의 close뿐).
 */
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";

export type ViewPurpose = "run" | "record";
export type ViewRequest =
  | { t: "view:open"; id: string; purpose: ViewPurpose; title: string }
  | { t: "view:close"; id: string }
  | { t: "view:focus"; id: string };
export type ViewReply = { t: "view:opened"; id: string } | { t: "view:failed"; id: string; message: string };

/** 앱과 말을 주고받는 길 — 데스크톱 앱이면 utilityProcess의 parentPort */
export interface ViewHost {
  post(m: ViewRequest): void;
  onMessage(fn: (m: unknown) => void): void;
}

/** 뷰가 처음 여는 주소 — 앱도 같은 것을 쓴다(apps/desktop) */
export const viewMarkUrl = (id: string): string => `data:text/html;charset=utf-8,%3Ctitle%3EFlowsmith%3C%2Ftitle%3E#fs-view=${id}`;
const OPEN_TIMEOUT_MS = 15_000;

export interface OpenedView {
  id: string;
  page: Page;
  close(): Promise<void>;
}

export class AppViews {
  readonly cdpUrl: string;
  readonly #host: ViewHost;
  #browser: Promise<Browser> | null = null;
  readonly #waiting = new Map<string, { ok: () => void; fail: (e: Error) => void }>();

  constructor(cdpUrl: string, host: ViewHost) {
    this.cdpUrl = cdpUrl;
    this.#host = host;
    host.onMessage((raw) => {
      const m = raw as Partial<ViewReply> | null;
      if (!m || typeof m.id !== "string") return;
      const w = this.#waiting.get(m.id);
      if (!w) return;
      if (m.t === "view:opened") w.ok();
      else if (m.t === "view:failed") w.fail(new Error(`앱 안 브라우저를 열지 못했습니다 — ${m.message ?? "까닭 모름"}`));
    });
  }

  #connect(): Promise<Browser> {
    if (!this.#browser) {
      this.#browser = chromium.connectOverCDP(this.cdpUrl, { timeout: 8_000 }).then((b) => {
        b.on("disconnected", () => { this.#browser = null; });
        return b;
      }, (e) => { this.#browser = null; throw new Error(`앱 안 브라우저에 붙지 못했습니다 — ${(e as Error).message.split("\n")[0]}`); });
    }
    return this.#browser;
  }

  /** 뷰 하나를 열어 그 Page를 준다 — 실행(purpose run)이면 앱이 따로 창을 띄우고, 녹화면 편집 화면이 자리를 정한다 */
  async open(purpose: ViewPurpose, title: string): Promise<OpenedView> {
    const browser = await this.#connect();
    const id = randomUUID();
    const replied = new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => { this.#waiting.delete(id); fail(new Error("앱 안 브라우저를 열지 못했습니다 — 앱이 답하지 않습니다")); }, OPEN_TIMEOUT_MS);
      this.#waiting.set(id, { ok: () => { clearTimeout(timer); this.#waiting.delete(id); ok(); }, fail: (e) => { clearTimeout(timer); this.#waiting.delete(id); fail(e); } });
    });
    this.#host.post({ t: "view:open", id, purpose, title });
    try {
      await replied;
      const page = await this.#find(browser, id);
      return { id, page, close: () => this.#close(id, page) };
    } catch (e) {
      this.#host.post({ t: "view:close", id });
      throw e;
    }
  }

  /** 표시 주소로 우리 뷰를 찾는다 — 앱이 «열었다»고 답한 뒤에도 CDP에 보이기까지 조금 걸린다 */
  async #find(browser: Browser, id: string): Promise<Page> {
    const mark = `#fs-view=${id}`;
    const end = Date.now() + OPEN_TIMEOUT_MS;
    while (Date.now() < end) {
      const hit = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith(mark));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("앱 안 브라우저를 열었지만 찾지 못했습니다");
  }

  /** 실행 창을 앞으로 — 사람 기다리기가 시작될 때(사람이 그 창에서 한다) */
  focus(id: string): void { this.#host.post({ t: "view:focus", id }); }

  async #close(id: string, page: Page): Promise<void> {
    if (page.isClosed()) { this.#host.post({ t: "view:close", id }); return; }
    const gone = page.waitForEvent("close", { timeout: 5_000 }).catch(() => undefined);
    this.#host.post({ t: "view:close", id });
    await gone;
  }

  async close(): Promise<void> {
    const b = this.#browser;
    this.#browser = null;
    // ★연결만 놓는다 — connectOverCDP의 close()는 앱의 창을 닫지 않는다
    if (b) await (await b).close().catch(() => undefined);
  }
}
