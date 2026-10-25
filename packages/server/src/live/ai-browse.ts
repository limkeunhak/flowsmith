/**
 * **AI가 사이트를 본다**(PLAN §42-8) — AI 도우미가 사이트 주소를 열어 화면 요약(누를 것 · 칸 · 글자 · 표 · 위치 후보)을 받는다.
 * 요약의 요소를 AI가 동작에 쓰면(from) 녹화와 같은 위치가 들어간다(apps/studio/src/ai/refs.ts).
 *
 *   서버의 Chromium · **사람의 쿠키 없는 새 컨텍스트** — 로그인이 필요 없는 화면만 보인다(로그인 뒤 화면은 다음 단계: 직접 누르기)
 *   사람마다 하나 · 10분 쓰지 않으면 닫는다 · http(s)만
 *   ★관리자가 켜야 한다(AI 설정 siteView — 페이지의 글자가 AI 회사로 간다). 켜지 않았으면 열지 않는다
 */
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { pageSnapshot, type PageSnapshot } from "@flowsmith/recorder";
import { StoreError } from "../storage/types.ts";

const IDLE_MS = 10 * 60_000;

interface Session { id: string; owner: string | null; ctx: BrowserContext; page: Page; timer: NodeJS.Timeout }
export interface BrowseView { id: string; snapshot: PageSnapshot; /** 사람에게 보일 화면(JPEG · base64) */ shot: string }

export class AiBrowse {
  readonly #headless: boolean;
  #browser: Promise<Browser> | null = null;
  readonly #sessions = new Map<string, Session>();

  constructor(opts: { headless?: boolean } = {}) { this.#headless = opts.headless ?? true; }

  #getBrowser(): Promise<Browser> {
    if (!this.#browser) {
      this.#browser = chromium.launch({ headless: this.#headless }).then((b) => {
        b.on("disconnected", () => { this.#browser = null; });
        return b;
      }, (e) => { this.#browser = null; throw e; });
    }
    return this.#browser;
  }

  #touch(s: Session): void {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => void this.#drop(s.id), IDLE_MS);
    s.timer.unref();
  }

  #mine(owner: string | null, id: string): Session {
    const s = this.#sessions.get(id);
    if (!s || s.owner !== owner) throw new StoreError(404, "열린 화면이 없습니다 — 다시 여세요(10분 쓰지 않으면 닫힙니다)");
    this.#touch(s);
    return s;
  }

  async #view(s: Session): Promise<BrowseView> {
    await s.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const snapshot = await pageSnapshot(s.page);
    const shot = (await s.page.screenshot({ type: "jpeg", quality: 50, timeout: 10_000 }).catch(() => null))?.toString("base64") ?? "";
    return { id: s.id, snapshot, shot };
  }

  /** 주소를 연다 — 그 사람의 앞 화면은 닫는다 */
  async open(owner: string | null, url: string): Promise<BrowseView> {
    let u: URL;
    try { u = new URL(url); } catch { throw new StoreError(400, `주소를 읽을 수 없습니다 — ${url}`); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new StoreError(400, "http · https 주소만 엽니다");
    for (const s of [...this.#sessions.values()]) if (s.owner === owner) await this.#drop(s.id);
    const ctx = await (await this.#getBrowser()).newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
    const page = await ctx.newPage();
    const s: Session = { id: randomUUID(), owner, ctx, page, timer: setTimeout(() => undefined, 0) };
    this.#sessions.set(s.id, s);
    this.#touch(s);
    try {
      await page.goto(u.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (e) {
      await this.#drop(s.id);
      throw new StoreError(400, `열지 못했습니다 — ${(e as Error).message.split("\n")[0]}`);
    }
    return this.#view(s);
  }

  /** 지금 화면을 다시 본다 */
  async look(owner: string | null, id: string): Promise<BrowseView> {
    return this.#view(this.#mine(owner, id));
  }

  async close(owner: string | null, id: string): Promise<void> {
    this.#mine(owner, id);
    await this.#drop(id);
  }

  async #drop(id: string): Promise<void> {
    const s = this.#sessions.get(id);
    if (!s) return;
    this.#sessions.delete(id);
    clearTimeout(s.timer);
    await s.ctx.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.#sessions.keys()]) await this.#drop(id);
    const b = this.#browser;
    this.#browser = null;
    if (b) await (await b).close().catch(() => undefined);
  }
}
