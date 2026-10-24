/**
 * **녹화 세션** — 라이브 페이지 하나와 그 위의 녹화 (PLAN §5).
 *
 *   열기 → (앞 노드 재생) → 녹화/읽기/둘러보기 → 닫기
 *
 * ★★녹화가 곧 재생 시험이다. 페이지에 심은 스크립트가 누르기를 가로채면, 여기서
 *  1) 위치 후보를 Playwright로 다시 찾아 **정확히 하나이면서 바로 그 요소인지** 확인하고
 *  2) 엔진의 Primitives로 **대신 누른다**(금지 버튼 가드 포함).
 *  그래서 녹화된 동작은 «실행기가 그 위치로 실제로 눌러 본 것»이다.
 *
 * ☆표시 방식과 무관하다 — Playwright Page만 있으면 된다. 지금 화면은 CDP screencast로 보내지만(A),
 *  Electron(B)이면 webContents에 CDP로 붙어 같은 Page를 얻으면 된다.
 */
import { readFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Dialog, type Frame, type Page } from "playwright";
import {
  evaluate, FlowError, parseFlow,
  type Flow, type Locator, type Output, type SecretValue, type Target, type WebAction, type WebNode,
} from "@flowsmith/core";
import { approveUntil, build, ensureChain, Primitives, rootOf, RunInputError, runFlow, runWebNode, startScreencast, toFailure, type Screencast, installWallet } from "@flowsmith/engine";
import { keyColumnOf, readLabel, toName, withoutContentLocators } from "./suggest.ts";
import { replayDraft } from "./replay.ts";
import type { ClientMessage, OpenRequest, Recorded, RecordMode, ServerMessage } from "./protocol.ts";

const INJECT = readFileSync(new URL("./inject.js", import.meta.url), "utf8");
const PERFORM_TIMEOUT_MS = 10_000;
/** 누른 뒤 팝업이 뜨는지 기다리는 시간 — window.open은 누르기 처리 안에서 곧바로 일어난다 */
const POPUP_GRACE_MS = 400;
const BASE = { id: "", risk: "safe" as const, timeoutMs: null, optional: false };
const DEBUG = process.env["FLOWSMITH_DEBUG_LIVE"] === "1";
/** 페이지 폭이 이보다 좁으면 모바일 배치가 된다 — 넓게 띄우고 화면에서 줄여 보인다 */
const MIN_WIDTH = 1024;

/** 페이지 스크립트가 보낸 요소 설명 */
interface Raw {
  token: string;
  label: string;
  candidates: Locator[];
  fingerprint: Target["fingerprint"];
  tag: string;
  type: string;
}

/** 페이지 스크립트가 본 표의 행 — inject.js의 rowOf */
interface RawRow {
  rowsCss: string;
  label: string;
  count: number;
  index: number;
  click: string;
  columns: { name: string; selector: string; text: string }[];
}

type Emitted =
  | (Raw & { kind: "click"; risky: boolean; row: RawRow | null; floating: boolean })
  | (Raw & { kind: "check"; checked: boolean })
  | (Raw & { kind: "fill"; value: string | null; secret: boolean })
  | (Raw & { kind: "enter"; fill: { value: string | null; secret: boolean } | null })
  | (Raw & { kind: "select-open"; record: boolean; options: { value: string; label: string; selected: boolean }[]; rect: { x: number; y: number; width: number; height: number } })
  | (Raw & { kind: "pick"; table: { rowsCss: string; columns: { name: string; selector: string; strategy?: "link" }[]; count: number; label: string; list?: boolean } | null })
  | { kind: "blocked"; label: string };

export interface SessionIO {
  send(m: ServerMessage): void;
  frame(jpeg: Buffer): void;
}

const sameKey = (l: Locator) => `${l.kind}\0${l.value}\0${l.name ?? ""}`;
interface Attached {
  browser: Browser;
  /** 우리가 연 탭 — 끝나면 닫는다. 사람이 연 탭에서 녹화했으면 null */
  ownPage: Page | null;
}

/** 지갑 브라우저(PLAN §44) — 워커가 MetaMask를 실은 크롬을 열어 준다. 닫으면 프로필 잠금도 풀린다 */
export interface WalletSource {
  wallet: () => Promise<{ context: BrowserContext; close(): Promise<void> }>;
}

export class RecorderSession {
  /** 지금 보이는 창 — 팝업이 열리면 그 창, 닫히면 연 창 */
  #page: Page;
  /** 팝업 아래에 깔린 창들 */
  readonly #stack: Page[] = [];
  /** 누르기 뒤에 팝업이 열렸나 — 누르기를 «팝업 열기»로 녹화한다 */
  #popupSeen: Page | null = null;
  readonly #context: BrowserContext;
  readonly #io: SessionIO;
  readonly #forbidden: string[];
  #prim: Primitives;
  /** 지금 창의 화면 전송 */
  #cast: Screencast | null = null;
  #mode: RecordMode = "browse";
  #viewport: { width: number; height: number };
  #queue: Promise<void> = Promise.resolve();
  #seq = 0;
  #selects = new Map<string, { frame: Frame; raw: Raw; record: boolean; options: { value: string; label: string }[] }>();
  #dialog: Dialog | null = null;
  #closed = false;
  /**
   * 사람의 크롬에 붙었나(B2). ★그 크롬은 사람의 것이다 — 컨텍스트를 닫지 않고 · 창 크기를 바꾸지 않고 ·
   *  레코더는 우리가 쓰는 탭에만 심는다(컨텍스트에 심으면 사람의 모든 탭에 들어간다). 우리가 연 탭만 닫는다
   */
  readonly #attached: Attached | null;
  /** 레코더를 심은 창들 — 끝날 때 끈다 */
  readonly #installed = new Set<Page>();
  /**
   * 지갑 브라우저면 그것을 닫는 법. ★MetaMask 창(승인 · 지갑 화면)도 이 컨텍스트의 페이지다 —
   *  그리로 옮겨 가지 않고(사이트가 연 팝업만 따라간다) 그 안의 누르기는 녹화하지 않는다(사람이 승인한 것이 사이트 동작으로 남지 않게)
   */
  readonly #walletClose: (() => Promise<void>) | null;

  private constructor(context: BrowserContext, page: Page, io: SessionIO, forbidden: string[], viewport: { width: number; height: number }, attached: Attached | null = null, walletClose: (() => Promise<void>) | null = null) {
    this.#walletClose = walletClose;
    this.#attached = attached;
    this.#context = context;
    this.#page = page;
    this.#io = io;
    this.#forbidden = forbidden;
    this.#prim = new Primitives(page, forbidden);
    this.#viewport = viewport;
  }

  get page(): Page { return this.#page; }
  get mode(): RecordMode { return this.#mode; }

  static viewportFor(panel: { width: number; height: number }): { width: number; height: number } {
    const w = Math.max(320, Math.round(panel.width));
    const h = Math.max(240, Math.round(panel.height));
    if (w >= MIN_WIDTH) return { width: w, height: h };
    return { width: MIN_WIDTH, height: Math.max(600, Math.round((MIN_WIDTH * h) / w)) };
  }

  /**
   * 세션을 연다. 재생이 실패해도 세션은 열린 채로 둔다 — 사람이 손으로 이어 갈 수 있게.
   * created — 페이지가 생기자마자(재생 **전에**) 세션을 알린다. 재생 중 «사람 기다리기»(로그인)에서 사람의 입력이 이 세션으로 가야 한다
   *  (준비가 끝난 뒤에야 세션을 받으면 그동안의 입력은 버려진다)
   */
  static async open(src: Browser | { cdpUrl: string } | WalletSource, req: OpenRequest, secrets: Record<string, SecretValue>, io: SessionIO, created?: (s: RecorderSession) => void): Promise<RecorderSession> {
    const attach = "cdpUrl" in src;
    io.send({ t: "phase", phase: "starting", message: attach ? "사람의 크롬에 붙는 중" : "wallet" in src ? "지갑 브라우저(MetaMask)를 여는 중 — 처음이면 지갑을 준비합니다(30초쯤)" : "브라우저를 띄우는 중" });
    const forbidden = (req.draft.settings?.forbiddenLabels ?? []).filter((x) => { try { new RegExp(x, "u"); return true; } catch { return false; } });
    let s: RecorderSession;
    if (attach) {
      const { context, page, viewport, attached } = await RecorderSession.#attachTo(src.cdpUrl, req);
      s = new RecorderSession(context, page, io, forbidden, viewport, attached);
    } else if ("wallet" in src) {
      // 지갑 브라우저 — 워커가 연 MetaMask 크롬에 우리 탭을 하나 연다(창이 보이는 PC · 사람은 MetaMask 창을 직접 볼 수 있다)
      const w = await src.wallet();
      try {
        const viewport = RecorderSession.viewportFor(req.viewport);
        const page = await w.context.newPage();
        await page.setViewportSize(viewport).catch(() => undefined);
        s = new RecorderSession(w.context, page, io, forbidden, viewport, null, w.close);
      } catch (e) { await w.close(); throw e; }
    } else {
      const viewport = RecorderSession.viewportFor(req.viewport);
      const context = await src.newContext({ viewport, locale: "ko-KR" });
      // 테스트 지갑 — 녹화 · 앞 단계 재생이 같은 지갑을 쓴다(실행과 같게)
      const wallet = req.draft.settings?.wallet;
      if (wallet) {
        const key = secrets[wallet.secret];
        if (typeof key === "string") {
          try { await installWallet(context, wallet, key, { log: (text) => io.send({ t: "progress", text }) }); }
          catch (e) { io.send({ t: "notice", level: "error", text: `테스트 지갑을 달지 못했습니다 — ${(e as Error).message}` }); }
        } else io.send({ t: "notice", level: "warn", text: `테스트 지갑: 시크릿 «${wallet.secret}»에 개인키가 없어 지갑 없이 녹화합니다` });
      }
      const page = await context.newPage();
      s = new RecorderSession(context, page, io, forbidden, viewport);
    }
    await s.#install();
    await s.#startScreencast();
    io.send({ t: "viewport", ...s.#viewport });
    created?.(s);
    await s.#prepare(req, secrets);
    if (!s.#closed) {
      // 준비됨 전에 지금 주소를 꼭 보낸다 — 이동 이벤트는 따로(늦게) 올 수 있다
      await s.#sendPage();
      await s.setMode(req.startMode ?? "record");
      io.send({ t: "phase", phase: "ready", message: "녹화 중 — 오른쪽 페이지에서 하고 싶은 일을 해 보세요" });
    }
    return s;
  }

  /** 사람의 크롬에 붙어 녹화할 탭을 고른다 — «사람이 연 탭에서»면 그 탭, 아니면 우리 탭을 하나 연다 */
  static async #attachTo(cdpUrl: string, req: OpenRequest): Promise<{ context: BrowserContext; page: Page; viewport: { width: number; height: number }; attached: Attached }> {
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(cdpUrl, { timeout: 8_000 });
    } catch (e) {
      throw new Error(`사람의 크롬에 붙지 못했습니다 — ${cdpUrl}. 크롬을 --remote-debugging-port로 띄웠는지 확인하세요 (${(e as Error).message.split("\n")[0]})`);
    }
    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error("붙은 크롬에 열린 창이 없습니다 — 사이트에 로그인한 창을 열어 두세요");
      const node = req.draft.nodes.find((n) => n.id === req.nodeId);
      const start = node?.type === "web" ? node.config.start : null;
      let page: Page;
      let ownPage: Page | null = null;
      if (start?.kind === "tab") {
        const match = start.match;
        const hit = context.pages().filter((p) => p.url().includes(match)).at(-1);
        if (!hit) throw new Error(`주소에 「${match}」가 든 탭이 없습니다 — 사이트에 로그인한 탭을 열어 두세요`);
        page = hit;
      } else {
        page = ownPage = await context.newPage();
      }
      return { context, page, viewport: await RecorderSession.#sizeOf(page), attached: { browser, ownPage } };
    } catch (e) {
      await browser.close().catch(() => undefined);   // 연결만 놓는다
      throw e;
    }
  }

  /** 사람의 탭은 크기를 바꾸지 않는다 — 있는 크기 그대로 보낸다 */
  static async #sizeOf(page: Page): Promise<{ width: number; height: number }> {
    const v = await page.evaluate(() => ({ width: (globalThis as any).innerWidth as number, height: (globalThis as any).innerHeight as number })).catch(() => null);
    return v && v.width > 0 && v.height > 0 ? v : { width: 1280, height: 800 };
  }

  /**
   * 페이지에 심는 녹화 스크립트. ★확장 페이지(MetaMask 창)에서는 돌지 않는다 — 녹화 스크립트는 누르기를 가로채 대신 누르는데,
   *  MetaMask 창의 누르기는 녹화하지 않으니 가로채면 그대로 사라진다(사람이 승인을 못 한다)
   */
  get #script(): string { return `if (!/^chrome-extension:/.test(location.href)) {\n${INJECT}\nrelayRecorder(${JSON.stringify({ forbidden: this.#forbidden })});\n}`; }

  #emit = (src: { frame: Frame }, payload: Emitted): void => {
    // ★MetaMask 화면(확장 페이지)에서 사람이 누른 것은 녹화하지 않는다 — 승인은 «MetaMask 승인» 동작이 맡는다
    if (src.frame.url().startsWith("chrome-extension://")) return;
    if (DEBUG) console.log(`[live] 페이지가 알림 ${payload.kind}`);
    this.#queue = this.#queue.then(() => this.#handle(src.frame, payload)).catch((e) => this.#notice("error", `녹화하다 문제가 생겼습니다 — ${toFailure(e).message}`));
  };

  async #install(): Promise<void> {
    if (this.#attached) await this.#installOn(this.#page);
    else {
      await this.#context.exposeBinding("__relayEmit", this.#emit);
      await this.#context.exposeBinding("__relayGetMode", () => this.#mode);
      await this.#context.addInitScript({ content: this.#script });
    }

    this.#watch(this.#page);
    // 팝업 — 그 창으로 옮겨 가 보여 준다. 닫히면 연 창으로 돌아온다
    this.#context.on("page", (p) => {
      if (p === this.#page || this.#closed) return;
      if (!this.#attached && !this.#walletClose) { this.#adopt(p); return; }
      // ★사람의 크롬에서는 사람이 새 탭을 열 수도 있다 · 지갑 브라우저에서는 MetaMask가 제 창을 연다 — 우리 창이 연 것만 따라간다
      void p.opener().then((o) => { if (o && (o === this.#page || this.#stack.includes(o)) && !this.#closed) this.#adopt(p); }, () => undefined);
    });
  }

  /** 사람의 크롬에서는 탭마다 심는다 — 이미 열린 문서에도 바로 넣는다 */
  async #installOn(page: Page): Promise<void> {
    if (this.#installed.has(page)) return;
    this.#installed.add(page);
    await page.exposeBinding("__relayEmit", this.#emit).catch(() => undefined);
    await page.exposeBinding("__relayGetMode", () => this.#mode).catch(() => undefined);
    await page.addInitScript({ content: this.#script });
    await Promise.all(page.frames().map((f) => f.evaluate(this.#script).catch(() => undefined)));
  }

  #adopt(p: Page): void {
    this.#popupSeen = p;
    this.#stack.push(this.#page);
    this.#watch(p);
    void this.#switchTo(p, "새 창이 열려 그 창으로 옮겼습니다 — 창을 닫으면 연 창으로 돌아옵니다");
  }

  #watch(page: Page): void {
    page.on("framenavigated", (f) => { if (page === this.#page && f === page.mainFrame()) void this.#sendPage(); });
    page.on("dialog", (d) => {
      this.#dialog = d;
      this.#io.send({ t: "dialog", kind: d.type(), message: d.message(), defaultValue: d.defaultValue() });
    });
    page.on("close", () => {
      if (this.#closed) return;
      if (page !== this.#page) { const i = this.#stack.indexOf(page); if (i >= 0) this.#stack.splice(i, 1); return; }
      const back = this.#stack.pop();
      if (back) void this.#switchTo(back, "창이 닫혀 연 창으로 돌아왔습니다");
    });
  }

  /** 보이는 창을 바꾼다 — 화면 전송과 대신 누르기가 그 창을 향한다 */
  async #switchTo(page: Page, why: string): Promise<void> {
    const old = this.#cast;
    this.#cast = null;
    this.#page = page;
    this.#prim = new Primitives(page, this.#forbidden);
    await old?.stop();
    if (this.#closed) return;
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      if (this.#attached) {
        await this.#installOn(page);
        this.#viewport = await RecorderSession.#sizeOf(page);
        this.#io.send({ t: "viewport", ...this.#viewport });
      } else {
        await page.setViewportSize(this.#viewport).catch(() => undefined);
      }
      await this.#startScreencast();
      await Promise.all(page.frames().map((f) => f.evaluate((m) => (globalThis as any).__relaySetMode?.(m), this.#mode).catch(() => undefined)));
      await this.#sendPage();
      this.#notice("info", why);
    } catch (e) {
      this.#notice("error", `창을 옮기다 문제가 생겼습니다 — ${toFailure(e).message.split("\n")[0]}`);
    }
  }

  async #startScreencast(): Promise<void> {
    const size = { maxWidth: this.#viewport.width, maxHeight: this.#viewport.height };
    if (this.#cast?.page === this.#page) { await this.#cast.restart(size); return; }
    const page = this.#page;
    // 떠난 창의 늦은 화면은 버린다
    const cast = await startScreencast(page, (jpeg) => { if (!this.#closed && page === this.#page) this.#io.frame(jpeg); }, { quality: 70, ...size });
    if (page !== this.#page || this.#closed) { await cast.stop(); return; }   // 그새 창이 또 바뀌었다
    this.#cast = cast;
  }

  async #sendPage(): Promise<void> {
    if (this.#closed) return;
    const title = await this.page.title().catch(() => "");
    // 뒤로 갈 곳이 있는지는 history 길이로 어림한다
    const canBack = await this.page.evaluate(() => (globalThis as any).history?.length > 1).catch(() => false);
    this.#io.send({ t: "page", url: this.page.url(), title, canBack, depth: this.#stack.length });
  }

  #notice(level: "info" | "warn" | "error", text: string): void {
    if (!this.#closed) this.#io.send({ t: "notice", level, text });
  }

  // ─── 준비: 앞 단계 재생 ─────────────────────────────────────────────

  /** 초안을 검문소에 — 틀려 있으면 null과 첫 문제 몇 개 */
  #tryParse(draft: Flow, what: string): Flow | null {
    try { return parseFlow(draft); } catch (e) {
      if (!(e instanceof FlowError)) throw e;
      this.#notice("warn", `${what}에 문제가 ${e.problems.length}개 있어 재생하지 않습니다 — ${e.problems.slice(0, 2).join(" · ")}`);
      return null;
    }
  }

  async #prepare(req: OpenRequest, secrets: Record<string, SecretValue>): Promise<void> {
    const node = req.draft.nodes.find((n) => n.id === req.nodeId) as WebNode | undefined;
    if (!node || node.type !== "web") { this.#notice("error", "웹페이지 노드가 아닙니다"); return; }
    const timeout = req.draft.settings?.defaultTimeoutMs ?? 15_000;

    let input: Output = {};
    let outputs: Record<string, Output> = {};
    const hasAncestors = req.draft.edges.some((e) => e.to.node === req.nodeId);
    // 재생과 상관없는 입력 · 시크릿 때문에 막히지 않게 — 앞 노드가 정말 쓰는데 없으면 그 동작에서 «값이 없습니다»로 멈춘다
    const relax = (f: Flow): Flow => ({ ...f, params: f.params.map((p) => ({ ...p, required: false })), secrets: f.secrets.filter((x) => x.name in secrets) });
    const flow = req.replay && hasAncestors ? this.#tryParse(relax(replayDraft(req.draft, req.nodeId, false)), "앞 노드들") : null;
    if (flow) {
      this.#io.send({ t: "phase", phase: "replaying", message: "앞 단계를 재생하는 중" });
      try {
        const r = await runFlow(flow, {
          page: this.page, stopBefore: req.nodeId, params: req.params, secrets,
          onEvent: (e) => {
            if (e.kind === "node:start") this.#io.send({ t: "progress", text: `▶ ${flow!.nodes.find((n) => n.id === e.nodeId)?.name ?? e.nodeId}` });
            if (e.kind === "step") this.#io.send({ t: "progress", text: `   ${e.step.note}` });
            if (e.kind === "human") this.#io.send({ t: "human", prompt: e.state === "waiting" ? e.prompt : null, deadline: e.state === "waiting" ? e.deadline : null });
          },
        });
        if (r.status === "failure") this.#notice("error", `앞 단계 재생이 멈췄습니다 — ${r.message}. 직접 이어 가서 녹화할 수 있습니다`);
        else if (!r.stoppedAt) this.#notice("warn", "앞 단계가 이 노드까지 오지 않았습니다(다른 갈래로 갔거나 끝났습니다)");
        input = r.stoppedAt?.input ?? {};
        outputs = Object.fromEntries(r.nodes.filter((n) => n.status === "succeeded" && n.output).map((n) => [n.id, n.output!]));
        // 앞 단계에서 읽은 값 — 화면이 보여 주고 · 녹화한 입력을 이 값에 잇는다(★엔진이 시크릿은 이미 가렸다)
        this.#io.send({ t: "inputs", input });
      } catch (e) {
        this.#notice("error", e instanceof RunInputError ? `재생할 수 없습니다 — ${e.problems.join(" · ")}` : `재생하다 멈췄습니다 — ${toFailure(e).message}`);
      }
    }

    const scope = { input, nodes: outputs, params: req.params, vars: req.draft.vars ?? {}, secrets };
    // 지갑 브라우저 — 이 노드의 «MetaMask 승인»을 재생할 수 있게 · 시작 주소로 가면 실행과 같이 체인부터
    const w = req.draft.settings?.wallet;
    const walletEnv = this.#walletClose && w?.mode === "metamask" ? (() => {
      const wallet = { chains: w.chains ?? [], defaultChainId: w.defaultChainId ?? 1 };
      const log = (text: string) => this.#io.send({ t: "progress", text: `   ${text}` });
      return {
        prepare: (p: Page) => ensureChain({ context: this.#context, dapp: p, wallet, log }),
        approve: async (p: Page, done: () => Promise<boolean>, timeoutMs: number) => (await approveUntil({ context: this.#context, dapp: p, wallet, done, timeoutMs, log })).length,
      };
    })() : null;
    // 다시 지정이면 그 동작 앞까지만 재생한다
    const cut = req.stopBeforeAction ? node.config.actions.findIndex((a) => a.id === req.stopBeforeAction) : -1;
    const draft = cut >= 0 ? { ...req.draft, nodes: req.draft.nodes.map((n) => (n.id === req.nodeId && n.type === "web" ? { ...n, config: { ...n.config, actions: n.config.actions.slice(0, cut) } } : n)) } : req.draft;
    const ownActions = cut >= 0 ? cut : node.config.actions.length;
    const own = (req.replayExisting || cut >= 0) && ownActions > 0 ? this.#tryParse(replayDraft(draft, req.nodeId, true), "이 노드") : null;
    const ownNode = own?.nodes.find((n) => n.id === req.nodeId);
    if (ownNode?.type === "web") {
      this.#io.send({ t: "phase", phase: "replaying", message: `이 노드의 동작 ${ownNode.config.actions.length}개를 재생하는 중` });
      try {
        await runWebNode(ownNode, {
          prim: this.#prim, primFor: (p) => new Primitives(p, this.#forbidden), scope, defaultTimeoutMs: timeout,
          step: (s) => this.#io.send({ t: "progress", text: `   ${s.note}` }),
          ...(walletEnv ? { wallet: walletEnv } : {}),
          // 사람 기다리기 — 녹화하는 사람이 바로 이 화면에 있다(모드는 «둘러보기» — 넣은 것은 녹화되지 않는다)
          human: {
            waiting: (w) => this.#io.send({ t: "human", prompt: w.prompt, deadline: w.deadline }),
            finished: () => this.#io.send({ t: "human", prompt: null, deadline: null }),
          },
        });
      } catch (e) {
        this.#notice("error", `이 노드의 동작을 재생하다 멈췄습니다 — ${toFailure(e).message}`);
      }
      return;
    }
    if (node.config.start.kind === "url") {
      try {
        const url = String(evaluate(node.config.start.url, { ...scope, secrets: {} }).value ?? "");
        if (url) {
          await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
          if (walletEnv) await walletEnv.prepare(this.page).catch((e) => this.#notice("warn", `체인을 맞추지 못했습니다 — ${toFailure(e).message}. MetaMask 창에서 직접 하세요`));
        }
      } catch (e) {
        this.#notice("error", `시작 주소로 가지 못했습니다 — ${toFailure(e).message}`);
      }
    } else if (this.page.url() === "about:blank") {
      this.#notice("warn", "이 노드는 «앞 페이지에서 이어서» 시작하는데 이어 갈 페이지가 없습니다 — 위 주소 칸으로 직접 가세요");
    }
  }

  // ─── 모드 · 입력 ───────────────────────────────────────────────────

  async setMode(mode: RecordMode): Promise<void> {
    this.#mode = mode;
    await Promise.all(this.page.frames().map((f) => f.evaluate((m) => (globalThis as any).__relaySetMode?.(m), mode).catch(() => undefined)));
    this.#io.send({ t: "mode", mode });
  }

  async input(m: ClientMessage): Promise<void> {
    if (this.#closed) return;
    if (DEBUG && m.t !== "mouse") console.log(`[live] 입력 ${m.t}`, m.t === "mode" ? m.mode : "");
    if (DEBUG && m.t === "mouse" && m.type !== "move") console.log(`[live] 마우스 ${m.type} ${m.x},${m.y} 모드=${this.#mode}`);
    const p = this.page;
    try {
      switch (m.t) {
        case "mode": await this.setMode(m.mode); break;
        case "mouse":
          await p.mouse.move(m.x, m.y);
          if (m.type === "down") await p.mouse.down({ button: m.button, clickCount: m.clickCount });
          if (m.type === "up") await p.mouse.up({ button: m.button, clickCount: m.clickCount });
          break;
        case "wheel": await p.mouse.move(m.x, m.y); await p.mouse.wheel(m.dx, m.dy); break;
        case "key":
          // 모르는 키(IME 조합 중 Process 등)는 버린다
          if (m.type === "down") await p.keyboard.down(m.key).catch(() => undefined);
          else await p.keyboard.up(m.key).catch(() => undefined);
          break;
        case "text": await p.keyboard.insertText(m.text); break;
        case "nav": await this.#navigate(m.url); break;
        case "back": await p.goBack({ timeout: 15_000 }).catch(() => undefined); break;
        case "reload": await p.reload({ timeout: 15_000 }).catch(() => undefined); break;
        case "resize":
          if (this.#attached) { this.#io.send({ t: "viewport", ...this.#viewport }); break; }   // 사람의 탭 크기는 건드리지 않는다
          this.#viewport = RecorderSession.viewportFor(m);
          await p.setViewportSize(this.#viewport);
          await this.#startScreencast();
          this.#io.send({ t: "viewport", ...this.#viewport });
          break;
        case "select-choose": this.#queue = this.#queue.then(() => this.#chooseSelect(m.token, m.value)); break;
        case "dialog": {
          const d = this.#dialog;
          this.#dialog = null;
          if (d) await (m.accept ? d.accept(m.text) : d.dismiss()).catch(() => undefined);
          break;
        }
        case "close-window": this.#queue = this.#queue.then(() => this.#closeWindow()); break;
        case "open": break;
      }
    } catch (e) {
      this.#notice("error", toFailure(e).message.split("\n")[0]!);
    }
  }

  async #navigate(raw: string): Promise<void> {
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    if (this.#mode === "record") this.#record({ ...BASE, kind: "goto", url }, null, []);
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  }

  async #closeWindow(): Promise<void> {
    if (this.#stack.length === 0) { this.#notice("warn", "처음 창은 닫을 수 없습니다 — 팝업 창에서만 씁니다"); return; }
    if (this.#mode === "record") this.#record({ ...BASE, kind: "closeWindow" }, null, []);
    await this.page.close().catch(() => undefined);   // 돌아가기는 close 이벤트가 한다
  }

  // ─── 녹화 ───────────────────────────────────────────────────────────

  #record(action: WebAction, needs: Recorded["needs"], warnings: string[], table: Recorded["table"] = null, humanLabel?: string, extra: Pick<Recorded, "row" | "current" | "hints"> = {}): void {
    const id = `rec${++this.#seq}`;
    this.#io.send({ t: "recorded", item: { id, action: { ...action, id }, needs, table, warnings, ...(humanLabel ? { humanLabel } : {}), ...extra } });
  }

  /** 표의 행을 누른 것 — 「행 고르기」로 바꿀 때 쓸 것. 키 칸이 없으면(글자 있는 칸이 없다) 제안하지 않는다 */
  #rowSuggestion(r: RawRow, frames: string[]): Recorded["row"] {
    const key = keyColumnOf(r);
    if (r.count < 2) return undefined;
    // 키 칸이 없으면(글자가 다 같다 · 비었다) «몇 번째로»만 — 그래도 행 고르기로 남길 수 있다
    return {
      rows: r.count,
      columns: r.columns,
      nth: r.index + 1,
      pick: {
        label: r.label,
        rows: { label: `${r.label} 행`, locators: [{ kind: "css", value: r.rowsCss }], fingerprint: null, frames, verifiedAt: new Date().toISOString() },
        ...(key ? { by: "key" as const, keyColumn: key.selector, keyLabel: key.name, value: key.text } : { by: "index" as const, keyColumn: "", keyLabel: "", value: String(r.index + 1) }),
        click: r.click, refuse: null,
      },
    };
  }

  /** 프레임 경로 — 바깥부터 iframe을 가리키는 css. 각 단계가 정확히 하나여야 한다 */
  async #framePath(frame: Frame): Promise<string[]> {
    const path: string[] = [];
    let f = frame;
    for (let parent = f.parentFrame(); parent; parent = f.parentFrame()) {
      const el = await f.frameElement();
      let sel = await el.evaluate((e: any) => (e.id ? `#${(globalThis as any).CSS.escape(e.id)}` : e.getAttribute("name") ? `iframe[name="${e.getAttribute("name")}"]` : ""));
      if (!sel || (await parent.locator(sel).count()) !== 1) sel = await el.evaluate((e: any) => (globalThis as any).__relayCssPath?.(e) ?? "iframe");
      path.unshift(sel);
      f = parent;
    }
    return path;
  }

  /**
   * 후보 → Target. ★정확히 하나이면서 **바로 그 요소**인 후보만 남긴다 — 순서는 페이지가 정한 우선순위.
   * 남는 게 없으면 경고와 함께 구조 경로를 1순위로 둔다(실행에서 실패할 수 있다고 알린다).
   */
  async #resolve(frame: Frame, raw: Raw): Promise<{ target: Target; warnings: string[] }> {
    const frames = await this.#framePath(frame);
    const root = rootOf(this.page, frames);
    const ok: Locator[] = [];
    const seen = new Set<string>();
    for (const c of raw.candidates) {
      if (seen.has(sameKey(c))) continue;
      seen.add(sameKey(c));
      try {
        const loc = build(root, c);
        if ((await loc.count()) !== 1) continue;
        if (await loc.evaluate((el, t) => (globalThis as any).__relayEls?.[t] === el, raw.token)) ok.push(c);
      } catch { /* Playwright가 모르는 역할 등 — 후보에서 뺀다 */ }
    }
    const warnings: string[] = [];
    if (ok.length === 0) warnings.push("이 요소를 하나로 가리키는 위치를 찾지 못했습니다 — 실행할 때 실패할 수 있습니다");
    const fallback = raw.candidates.at(-1)!;
    return {
      target: {
        label: raw.label,
        locators: ok.length ? ok : [fallback, ...raw.candidates.slice(0, -1)],
        fingerprint: raw.fingerprint,
        frames,
        verifiedAt: ok.length ? new Date().toISOString() : null,
      },
      warnings,
    };
  }

  /** 서버가 대신 한다 — 가로채기 스크립트가 한 번 지나가게 해 두고 */
  async #perform(frame: Frame, raw: Raw, target: Target, op: () => Promise<unknown>, fallback: (h: import("playwright").ElementHandle) => Promise<unknown>, passes = 1): Promise<void> {
    await frame.evaluate((n) => { (globalThis as any).__relayPass = n; }, passes).catch(() => undefined);
    try {
      if (target.verifiedAt) await op();
      else {
        const h = (await frame.evaluateHandle((t) => (globalThis as any).__relayEls?.[t], raw.token)).asElement();
        if (!h) throw new Error("요소가 사라졌습니다");
        await fallback(h);
      }
    } catch (e) {
      this.#notice("error", `녹화는 했지만 페이지에서 해 보지 못했습니다 — ${toFailure(e).message.split("\n")[0]}`);
    } finally {
      await frame.evaluate(() => { (globalThis as any).__relayPass = 0; }).catch(() => undefined);
    }
  }

  async #handle(frame: Frame, p: Emitted): Promise<void> {
    if (this.#closed) return;
    const base = BASE;
    switch (p.kind) {
      case "blocked":
        this.#notice("warn", `${p.label} — 금지 버튼이라 누르지 않았고 녹화하지도 않았습니다`);
        return;
      case "click": {
        const { target, warnings } = await this.#resolve(frame, p);
        // ★먼저 해 보고 남긴다 — 팝업이 열렸는지 알아야 «팝업 열기»로 남길 수 있다
        const opener = this.#page;
        this.#popupSeen = null;
        await this.#perform(frame, p, target, () => this.#prim.click(target, PERFORM_TIMEOUT_MS), (h) => h.click({ timeout: PERFORM_TIMEOUT_MS }));
        for (let t = 0; !this.#popupSeen && !opener.isClosed() && t < POPUP_GRACE_MS; t += 50) await new Promise((r) => setTimeout(r, 50));
        const popup = this.#popupSeen !== null;
        const hints: string[] = [];
        if (popup) hints.push("새 창을 여는 단추입니다 — 실행할 때도 그 창으로 옮겨 갑니다");
        if (p.floating) hints.push("떠 있는 창(안내창) 안의 단추라 «있을 때만»으로 남겼습니다 — 늘 뜨는 창이면 끄세요");
        const row = p.row && !popup ? this.#rowSuggestion(p.row, target.frames) : null;
        this.#record({ ...base, risk: p.risky ? "unsafe" : "safe", optional: p.floating, kind: "click", target, popup }, null, warnings, null, undefined, { hints, ...(row ? { row } : {}) });
        return;
      }
      case "check": {
        const { target, warnings } = await this.#resolve(frame, p);
        this.#record({ ...base, kind: "check", target, checked: p.checked }, null, warnings);
        await this.#perform(frame, p, target, () => this.#prim.check(target, p.checked, PERFORM_TIMEOUT_MS), (h) => h.setChecked(p.checked));
        return;
      }
      case "fill": {
        const { target, warnings } = await this.#resolve(frame, p);
        // ★비밀번호는 값을 받지도 않았다 — 어느 시크릿에 넣을지 사람이 고른다
        this.#record({ ...base, kind: "fill", target, value: p.secret ? "" : p.value ?? "" }, p.secret ? "secret" : null, warnings);
        return;
      }
      case "enter": {
        const { target, warnings } = await this.#resolve(frame, p);
        if (p.fill) this.#record({ ...base, kind: "fill", target, value: p.fill.secret ? "" : p.fill.value ?? "" }, p.fill.secret ? "secret" : null, warnings);
        this.#record({ ...base, kind: "press", target, key: "Enter" }, null, p.fill ? [] : warnings);
        await this.#perform(frame, p, target, () => this.#prim.press(target, "Enter", PERFORM_TIMEOUT_MS), (h) => h.press("Enter"), 2);  // ★엔터는 브라우저가 기본 제출 단추에 «신뢰된» 클릭을 한 번 더 보낸다 — 그것도 지나가게
        return;
      }
      case "select-open": {
        this.#selects.set(p.token, { frame, raw: p, record: p.record, options: p.options });
        const box = await this.#frameOffset(frame);
        this.#io.send({ t: "select-open", token: p.token, record: p.record, options: p.options, rect: { ...p.rect, x: p.rect.x + box.x, y: p.rect.y + box.y } });
        return;
      }
      case "pick": {
        const resolved = await this.#resolve(frame, withoutContentLocators(p));
        const name = readLabel(p);
        const target = { ...resolved.target, label: name };
        const warnings = resolved.warnings;
        // 고르기는 «보이는 말»을 읽는다 — 값(코드)은 사람이 모른다
        const strategy = p.tag === "select" ? "selected" as const : "auto" as const;
        const read: WebAction = { ...base, kind: "read", target, output: toName(name, "값"), strategy, attribute: null, transform: null };
        const now = await this.#prim.read(target, strategy, null, 3_000).catch(() => null);
        const current = now === null || now === undefined ? null : typeof now === "string" ? now : JSON.stringify(now);
        let table: Recorded["table"] = null;
        if (p.table) {
          const frames = target.frames;
          const rows = await frame.locator(p.table.rowsCss).count().catch(() => 0);
          if (rows >= 2) {
            const used = new Set<string>();
            const columns = p.table.columns.map((c, i) => {
              let n = toName(c.name, `열${i + 1}`);
              while (used.has(n)) n = `${n}_${i + 1}`;
              used.add(n);
              return { name: n, selector: c.selector, strategy: (c.strategy ?? "auto") as "link" | "auto" };
            });
            table = {
              rows,
              ...(p.table.list ? { list: true } : {}),
              action: {
                ...base, kind: "readTable", output: toName(p.table.label, "표"),
                table: { label: p.table.label, rows: { label: `${p.table.label} 행`, locators: [{ kind: "css", value: p.table.rowsCss }], fingerprint: null, frames, verifiedAt: new Date().toISOString() }, columns, maxRows: 100 },
              },
            };
          }
        }
        this.#record(read, "output", warnings, table, p.label, { current });
        return;
      }
    }
  }

  async #frameOffset(frame: Frame): Promise<{ x: number; y: number }> {
    let x = 0, y = 0;
    for (let f: Frame | null = frame; f && f.parentFrame(); f = f.parentFrame()) {
      const b = await (await f.frameElement()).boundingBox().catch(() => null);
      if (b) { x += b.x; y += b.y; }
    }
    return { x, y };
  }

  async #chooseSelect(token: string, value: string | null): Promise<void> {
    const s = this.#selects.get(token);
    this.#selects.delete(token);
    if (!s || value === null) return;
    const label = s.options.find((o) => o.value === value)?.label ?? value;
    if (!s.record) {
      const h = (await s.frame.evaluateHandle((t) => (globalThis as any).__relayEls?.[t], token)).asElement();
      await h?.selectOption(value).catch(() => undefined);
      return;
    }
    const { target, warnings } = await this.#resolve(s.frame, s.raw);
    this.#record({ ...BASE, kind: "select", target, value: label }, null, warnings);
    await this.#perform(s.frame, s.raw, target, () => this.#prim.select(target, label, PERFORM_TIMEOUT_MS), (h) => h.selectOption(value));
  }

  /** 시험용 — 쌓인 녹화 처리가 끝날 때까지 */
  async settle(): Promise<void> {
    for (let i = 0; i < 3; i++) { await this.#queue; await new Promise((r) => setTimeout(r, 30)); }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#cast?.stop();
    // 지갑 브라우저 — 크롬을 닫고 프로필 잠금을 푼다(프로필은 남는다)
    if (this.#walletClose) { await this.#walletClose(); return; }
    if (!this.#attached) { await this.#context.close().catch(() => undefined); return; }
    // ★사람의 크롬 — 레코더를 끄고(남은 문서에서도 아무것도 가로채지 않게) 우리 탭만 닫고 연결을 놓는다
    for (const p of this.#installed) {
      await Promise.all(p.frames().map((f) => f.evaluate(() => (globalThis as any).__relaySetMode?.("off")).catch(() => undefined)));
    }
    await this.#attached.ownPage?.close().catch(() => undefined);
    await this.#attached.browser.close().catch(() => undefined);
  }
}
