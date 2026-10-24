/**
 * **실행 화면 중계**(2026-10-24, PLAN §44 · 4단계) — 이 PC(원격 워커)에서 도는 실행의 화면을 서버로 보낸다.
 *
 *   보는 사람이 생기면(서버의 screen on) 지금 페이지에 CDP 화면 전송을 건다 · 다 떠나면(off) 끈다 — 서버의 RunScreens와 같은 결.
 *   페이지가 바뀌면(다음 노드 · 팝업) 따라간다. 크기 · 주소는 meta로, 화면은 frame으로.
 *   사람의 손(screen-input)은 그대로 페이지에 — ★서버가 «사람 기다리기 동안 · 누를 수 있는 사람»만 거른 것이다. 친 글자는 남기지 않는다.
 *
 * ☆서버에서 도는 실행보다 한 단계 더 건너간다(워커 → 서버 → 화면) — 조금 늦고, 망이 느리면 프레임을 버린다(밀리면 지연만 는다).
 */
import type { Page } from "playwright";
import { startScreencast, type Screencast } from "@flowsmith/engine";
import type { ScreenInput, ScreenMeta } from "./job.ts";

export interface RelayOut {
  frame(jpeg: Buffer): void;
  meta(m: ScreenMeta): void;
}

export class ScreenRelay {
  readonly #out: RelayOut;
  #page: Page | null = null;
  #watching = false;
  #cast: Screencast | null = null;
  #casting: Page | null = null;
  #size = "";
  #stopped = false;
  readonly #watched = new WeakSet<Page>();
  /** 입력은 차례대로 — 누름 · 뗌이 뒤바뀌지 않게 */
  #inputs: Promise<void> = Promise.resolve();

  constructor(out: RelayOut) { this.#out = out; }

  /** 실행의 지금 페이지(엔진의 onPage) */
  setPage(page: Page): void {
    this.#page = page;
    if (this.#watching) void this.#start();
  }

  /** 보는 사람이 있다 · 없다 */
  watch(on: boolean): void {
    this.#watching = on;
    if (on) void this.#start();
    else void this.#halt();
  }

  input(m: ScreenInput): void {
    const page = this.#page;
    if (!page || page.isClosed()) return;
    this.#inputs = this.#inputs.then(() => apply(page, m)).catch(() => undefined);
  }

  async #start(): Promise<void> {
    const page = this.#page;
    if (!page || this.#stopped || this.#casting === page || page.isClosed()) return;
    await this.#halt();
    this.#casting = page;
    const announce = (url: string) => {
      this.#out.meta({ t: "page", url, title: "" });
      void page.title().then((title) => { if (this.#casting === page && title) this.#out.meta({ t: "page", url, title }); }, () => undefined);
    };
    announce(page.url());
    if (!this.#watched.has(page)) {
      this.#watched.add(page);
      page.on("framenavigated", (fr) => { if (this.#casting === page && fr === page.mainFrame()) announce(fr.url()); });
    }
    let frames = 0;
    try {
      const cast = await startScreencast(page, (jpeg, device) => {
        if (this.#casting !== page) return;
        frames++;
        const size = `${Math.round(device.width)}x${Math.round(device.height)}`;
        if (size !== this.#size) { this.#size = size; this.#out.meta({ t: "viewport", width: Math.round(device.width), height: Math.round(device.height) }); }
        this.#out.frame(jpeg);
      }, { quality: 60, maxWidth: 1600, maxHeight: 1200 });
      if (this.#casting !== page || !this.#watching) { await cast.stop(); return; }
      this.#cast = cast;
      // 가만히 있는 페이지는 화면을 안 보내기도 한다 — 첫 화면이 안 오면 한 장 찍어 보낸다
      setTimeout(() => {
        if (frames > 0 || this.#casting !== page || page.isClosed()) return;
        void page.screenshot({ type: "jpeg", quality: 60, timeout: 5000 }).then((jpeg) => {
          if (frames > 0 || this.#casting !== page) return;
          const v = page.viewportSize();
          if (v && !this.#size) { this.#size = `${v.width}x${v.height}`; this.#out.meta({ t: "viewport", ...v }); }
          this.#out.frame(jpeg);
        }, () => undefined);
      }, 1500).unref();
    } catch {
      if (this.#casting === page) this.#casting = null;
    }
  }

  async #halt(): Promise<void> {
    const c = this.#cast;
    this.#cast = null;
    this.#casting = null;
    this.#size = "";
    await c?.stop().catch(() => undefined);
  }

  /** 실행이 끝났다 */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#watching = false;
    await this.#halt();
  }
}

async function apply(page: Page, m: ScreenInput): Promise<void> {
  switch (m.t) {
    case "mouse":
      await page.mouse.move(m.x, m.y);
      if (m.type === "down") await page.mouse.down({ button: m.button, clickCount: m.clickCount });
      if (m.type === "up") await page.mouse.up({ button: m.button, clickCount: m.clickCount });
      break;
    case "wheel": await page.mouse.move(m.x, m.y); await page.mouse.wheel(m.dx, m.dy); break;
    case "key":
      if (m.type === "down") await page.keyboard.down(m.key).catch(() => undefined);
      else await page.keyboard.up(m.key).catch(() => undefined);
      break;
    case "text": await page.keyboard.insertText(m.text); break;
  }
}
