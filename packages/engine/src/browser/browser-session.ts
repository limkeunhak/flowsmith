/**
 * **한 실행의 브라우저** — 띄우거나(launch) 사람의 크롬에 붙는다(attach) (PLAN 결정 2 · 2026-10-15).
 *
 * attach:
 *   - 사람이 보안 프로그램 · OTP로 로그인해 둔 크롬에 CDP로 붙는다
 *   - 「사람이 연 탭에서」 시작하는 노드는 주소에 그 글자가 든 탭을 **골라 쓴다** — 주소를 옮기지 않는다
 *   - 「주소로 가서」 시작하는 노드는 **우리 탭을 하나 새로 연다**(같은 프로필이라 로그인이 이어진다)
 *   ★★사람의 탭 · 브라우저는 **절대 닫지 않는다.** 끝나면 우리가 연 탭만 닫고 연결을 놓는다
 *    («우리가 연 것은 우리가 닫는다»)
 *   ☆대화상자 처리기를 달지 않는다 — 같은 크롬에 붙은 다른 도구가 따로 다룬다.
 *    둘이 동시에 달면 서로 먼저 닫아 버린다
 *
 * app(데스크톱 앱 · PLAN §44):
 *   - 실행기가 준 `openApp`이 앱 안 브라우저 뷰 하나를 연다 — 그 뷰가 이 실행의 «하나뿐인 페이지»다
 *   ★컨텍스트는 앱 전체가 함께 쓰는 것이다(편집 화면도 들어 있다) — 닫지 않고, 컨텍스트에 아무것도 달지 않는다. 끝나면 뷰만 닫는다
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { BrowserMode } from "@flowsmith/core";

export class BrowserSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserSessionError";
  }
}

export const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

export interface SessionOptions {
  browser?: Browser;
  page?: Page;
  headless?: boolean;
  cdpUrl?: string;
  /** 지갑 브라우저(wallet)를 연다 — 실행기가 준다(키 · MetaMask 폴더를 안다). 없으면 그 모드는 멈춘다 */
  openWallet?: () => Promise<{ context: BrowserContext; close: () => Promise<void> }>;
  /** 앱 안 브라우저(app)의 뷰를 연다 — 데스크톱 앱의 워커가 준다. 없으면 그 모드는 멈춘다 */
  openApp?: () => Promise<AppView>;
}

/** 앱 안 브라우저 뷰 하나 — 닫으면 뷰째 없어진다 */
export interface AppView {
  page: Page;
  close: () => Promise<void>;
}

export class BrowserSession {
  readonly mode: BrowserMode;
  #browser: Browser | null = null;
  #ownBrowser = false;
  #context: BrowserContext | null = null;
  #ownContext = false;
  /** 지금 노드들이 쓰는 페이지 — 「앞 페이지에서 이어서」가 이것을 쓴다 */
  #current: Page | null = null;
  /** 우리가 연 탭 — 끝나면 닫는다 */
  readonly #opened: Page[] = [];
  /** 동작이 연 팝업 — 끝나면 닫는다(attach에서도 — 사람이 연 창이 아니다) */
  readonly #popups: Page[] = [];
  /** launch의 하나뿐인 페이지 · 받은 페이지(녹화기) — 팝업에 머물다 끝나도 «주소로 가서»는 여기서 */
  #main: Page | null = null;
  readonly #opts: SessionOptions;
  /** 지갑 브라우저를 닫는다(프로필 잠금도 푼다) · 앱 안 브라우저 뷰를 닫는다 */
  #walletClose: (() => Promise<void>) | null = null;
  /** 우리가 컨텍스트를 만들었을 때(launch) — 테스트 지갑을 단다(run.ts). 받은 페이지 · 사람의 크롬에는 부르지 않는다 */
  onContext: ((ctx: BrowserContext) => Promise<void>) | null = null;

  constructor(mode: BrowserMode, opts: SessionOptions) {
    this.mode = mode;
    this.#opts = opts;
    if (opts.page) {
      this.#current = this.#main = opts.page;
      this.#context = opts.page.context();
    }
  }

  get page(): Page | null { return this.#current; }

  /** 지금 페이지가 바뀌면 알린다 — 실행 화면 보기가 따라간다 */
  onCurrent: ((page: Page) => void) | null = null;

  #use(page: Page): Page {
    if (page !== this.#current) { this.#current = page; this.onCurrent?.(page); }
    return page;
  }
  get context(): BrowserContext | null { return this.#context; }
  get cdpUrl(): string { return this.#opts.cdpUrl ?? DEFAULT_CDP_URL; }

  async #ensureContext(): Promise<BrowserContext> {
    if (this.#context) return this.#context;
    if (this.mode === "attach") {
      try {
        this.#browser = await chromium.connectOverCDP(this.cdpUrl, { timeout: 8_000 });
      } catch (e) {
        throw new BrowserSessionError(
          `사람의 크롬에 붙지 못했습니다 — ${this.cdpUrl}. 크롬을 --remote-debugging-port로 띄웠는지, ` +
          `WSL이면 Windows에서 CDP 브리지를 띄우고 FLOWSMITH_CDP_URL을 호스트 주소로 줬는지 확인하세요 (${(e as Error).message.split("\n")[0]})`,
        );
      }
      const ctx = this.#browser.contexts()[0];
      if (!ctx) throw new BrowserSessionError("붙은 크롬에 열린 창이 없습니다 — 사이트에 로그인한 창을 열어 두세요");
      this.#context = ctx;
      return ctx;
    }
    if (this.mode === "wallet") {
      if (!this.#opts.openWallet) throw new BrowserSessionError("이 워커는 지갑 브라우저(MetaMask)를 열 수 없습니다 — 화면이 있는 워커(데스크톱 · --headed)에서 돌리세요");
      const w = await this.#opts.openWallet();
      this.#context = w.context;
      this.#walletClose = w.close;
      return w.context;
    }
    if (this.mode === "app") {
      if (!this.#opts.openApp) throw new BrowserSessionError("이 워커는 앱 안 브라우저를 열 수 없습니다 — 데스크톱 앱에서 돌리세요(브라우저 설정을 «띄우기»로 바꾸면 어디서나 돕니다)");
      const v = await this.#opts.openApp();
      this.#main = v.page;
      this.#walletClose = v.close;
      this.#context = v.page.context();
      return this.#context;
    }
    const browser =this.#opts.browser ?? (this.#ownBrowser = true, await chromium.launch({ headless: this.#opts.headless ?? true }));
    this.#browser = browser;
    this.#context = await browser.newContext({ locale: "ko-KR" });
    this.#ownContext = true;
    await this.onContext?.(this.#context);
    return this.#context;
  }

  /** 「주소로 가서」 — launch면 하나뿐인 페이지, attach면 우리 탭(처음 한 번 연다) */
  async pageForUrl(): Promise<Page> {
    if (this.#main && !this.#main.isClosed()) return this.#use(this.#main);
    const ctx = await this.#ensureContext();
    // 앱 안 브라우저 — 뷰가 곧 페이지다(컨텍스트에 새 탭을 열면 앱 밖의 빈 창이 된다)
    if (this.mode === "app") {
      if (this.#main && !this.#main.isClosed()) return this.#use(this.#main);
      throw new BrowserSessionError("앱 안 브라우저 창이 닫혔습니다");
    }
    if (this.mode === "attach") {
      const mine = this.#opened.find((p) => !p.isClosed());
      if (mine) return this.#use(mine);
    }
    const p = await ctx.newPage();
    if (this.mode === "attach") this.#opened.push(p);
    else this.#main = p;
    return this.#use(p);
  }

  /** 「사람이 연 탭에서」 — 주소에 `match`가 든 탭. 여럿이면 마지막(가장 최근에 연) 것 */
  async tab(match: string): Promise<Page> {
    if (this.mode !== "attach") throw new BrowserSessionError("«사람이 연 탭에서»는 사람의 브라우저에 붙었을 때만 씁니다");
    // 받은 페이지(녹화기의 탭)가 맞으면 그것 — 녹화하는 탭을 두고 다른 탭으로 가지 않는다
    const given = this.#opts.page;
    if (given && !given.isClosed() && given.url().includes(match)) return this.#use(given);
    const ctx = await this.#ensureContext();
    const hits = ctx.pages().filter((p) => !p.isClosed() && !this.#opened.includes(p) && p.url().includes(match));
    const page = hits.at(-1);
    if (!page) {
      const urls = ctx.pages().map((p) => p.url()).filter((u) => u && u !== "about:blank").slice(0, 5);
      throw new BrowserSessionError(`주소에 '${match}'가 든 탭이 없습니다 — 사이트에 로그인한 탭을 열어 두세요 (열린 탭: ${urls.join(" · ") || "없음"})`);
    }
    return this.#use(page);
  }

  /** 커스텀 노드 등 — 지금 페이지가 없으면 하나 마련한다 */
  async anyPage(): Promise<Page> {
    return this.#current ?? this.pageForUrl();
  }

  /** 노드가 창을 옮겼다(팝업으로 · 팝업에서 돌아옴) — 다음 노드의 «이어서»가 여기서 */
  follow(page: Page, opened: boolean): void {
    if (opened && !this.#popups.includes(page)) this.#popups.push(page);
    this.#use(page);
  }

  /**
   * 멈추기 — 하던 브라우저 일을 바로 깨운다. launch: 우리 컨텍스트를 닫는다(돌던 동작이 곧바로 실패한다).
   * attach: 우리가 연 탭 · 팝업만 닫는다 — ★사람의 탭은 그대로(그 위의 동작은 제 시간 제한까지 간다)
   */
  async interrupt(): Promise<void> {
    for (const p of [...this.#opened, ...this.#popups]) await p.close().catch(() => undefined);
    if (this.#ownContext) await this.#context?.close().catch(() => undefined);
    await this.#walletClose?.();
  }

  async close(): Promise<void> {
    for (const p of this.#popups) await p.close().catch(() => undefined);
    for (const p of this.#opened) await p.close().catch(() => undefined);
    if (this.#ownContext) await this.#context?.close().catch(() => undefined);
    // 지갑 브라우저 — 크롬을 닫고 프로필 잠금을 푼다(프로필은 남는다)
    await this.#walletClose?.();
    if (this.#ownBrowser) await this.#browser?.close().catch(() => undefined);
    // ★attach: 연결만 놓는다. connectOverCDP의 close()는 우리가 만든 컨텍스트만 치우고 끊는다 —
    //  사람의 기본 컨텍스트 · 탭은 그대로 남는다(시험으로 확인)
    else if (this.mode === "attach" && !this.#opts.page) await this.#browser?.close().catch(() => undefined);
  }
}
