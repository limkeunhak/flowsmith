/**
 * **AI가 사이트를 본다**(PLAN §42-8) — AI 도우미가 사이트 주소를 열어 화면 요약(누를 것 · 칸 · 글자 · 표 · 위치 후보)을 받는다.
 * 요약의 요소를 AI가 동작에 쓰면(from) 녹화와 같은 위치가 들어간다(apps/studio/src/ai/refs.ts).
 *
 *   서버의 Chromium · **사람의 쿠키 없는 새 컨텍스트** · 사람마다 하나 · 10분 쓰지 않으면 닫는다 · http(s)만
 *   ★관리자가 켜야 한다(AI 설정 siteView — 페이지의 글자가 AI 회사로 간다). 켜지 않았으면 열지 않는다
 *
 * 3단계(PLAN §42-9) — **AI가 직접 누르며 다음 화면으로**(act) · **만든 것을 점검 실행으로 돌려 본다**(tryFlow):
 *   누르기 · 넣기 · 고르기 · 키 — 녹화와 같은 Primitives로(금지 버튼은 누르지 않는다).
 *   ★되돌릴 수 없어 보이는 단추(저장 · 제출 · 결제 · 삭제 …)는 누르지 않는다 — 녹화기와 같은 낱말로 거른다.
 *   ★시크릿 값은 AI가 모른다 — 넣을 값이 {{ $secrets.이름 }}이면 서버가 그 워크플로우의 시크릿으로 바꿔 넣는다(라우트가 준다).
 *   점검 실행 — 되돌릴 수 없는 동작 앞에서 멈추고, 요소를 녹화 때와 견준다(엔진 probe). 그 결과를 AI가 보고 고친다.
 */
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { evaluate, parseFlow, type SecretValue, type Target } from "@flowsmith/core";
import { Primitives, runFlow, toFailure, type RunResult } from "@flowsmith/engine";
import { pageSnapshot, type PageSnapshot } from "@flowsmith/recorder";
import { StoreError } from "../storage/types.ts";

/** 되돌릴 수 없어 보이는 단추 — 녹화기(inject.js RISKY)와 같은 낱말 */
const RISKY = /저장|제출|등록|신청|결제|삭제|송금|이체|구매|주문하기|발행|확정|전송|submit|delete|remove|pay|buy|purchase|confirm|save|send/i;
const ACT_TIMEOUT_MS = 10_000;

export interface ActRequest { kind: "click" | "fill" | "select" | "press"; target?: Target; value?: string; key?: string }

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

  /**
   * 열린 화면에서 한 가지 — 누르기 · 넣기 · 고르기 · 키. 그 뒤 화면을 다시 요약해 돌려준다.
   * secrets — 그 워크플로우의 시크릿(넣을 값의 {{ $secrets.x }}를 바꿔 넣는다 · 결과 · 요약에는 값이 남지 않는다)
   */
  async act(owner: string | null, id: string, a: ActRequest, secrets: Record<string, SecretValue> = {}): Promise<BrowseView> {
    const s = this.#mine(owner, id);
    const p = new Primitives(s.page, []);
    const t = a.target;
    if (a.kind !== "press" && (!t || !t.locators?.length)) throw new StoreError(400, "어느 요소인지 없습니다(target)");
    if (a.kind === "click") {
      const words = [t!.label, t!.fingerprint?.text ?? "", t!.fingerprint?.attrs?.["value"] ?? ""].join(" ");
      if (RISKY.test(words)) throw new StoreError(409, `되돌릴 수 없어 보이는 단추(«${t!.label}»)라 누르지 않았습니다 — 동작으로는 넣되 사람이 확인하게 두세요`);
    }
    const value = a.value === undefined ? "" : this.#fillValue(a.value, secrets);
    try {
      if (a.kind === "click") await p.click(t!, ACT_TIMEOUT_MS);
      else if (a.kind === "fill") await p.fill(t!, value, ACT_TIMEOUT_MS);
      else if (a.kind === "select") await p.select(t!, value, ACT_TIMEOUT_MS);
      else await p.press(t ?? null, a.key || "Enter", ACT_TIMEOUT_MS);
    } catch (e) {
      throw new StoreError(400, `하지 못했습니다 — ${toFailure(e).message.split("\n")[0]}`);
    }
    await s.page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    return this.#view(s);
  }

  /** 넣을 값 — {{ $secrets.x }} · {{ $secrets.x.password }}만 바꾼다(실행 입력 등 다른 표현식은 AI가 시험 값을 직접 넣는다) */
  #fillValue(raw: string, secrets: Record<string, SecretValue>): string {
    if (!raw.includes("{{")) return raw;
    if (/\{\{(?!\s*\$secrets\.)/.test(raw)) throw new StoreError(400, "넣을 값에는 시크릿({{ $secrets.이름 }})만 표현식으로 씁니다 — 실행 입력은 시험 값을 그대로 넣으세요");
    let v: unknown;
    try { v = evaluate(raw, { secrets, params: {}, vars: {}, input: {}, nodes: {} }).value; }
    catch (e) { throw new StoreError(400, `시크릿을 풀지 못했습니다 — ${(e as Error).message}`); }
    if (v === undefined || v === null || v === "") throw new StoreError(400, "시크릿 값이 없습니다 — 새 워크플로우면 저장하고 시크릿 값을 넣은 뒤에 하세요(아니면 «사람 기다리기»로)");
    return String(v);
  }

  /**
   * 만든 워크플로우를 **점검 실행**으로 — 되돌릴 수 없는 동작 앞에서 멈추고 요소를 녹화 때와 견준다. 1분까지.
   * ★서버의 새 브라우저(쿠키 없음) · 시크릿은 그 워크플로우의 것
   */
  async tryFlow(draft: unknown, params: Record<string, string>, secrets: Record<string, SecretValue>): Promise<RunResult> {
    const flow = parseFlow(draft);
    return runFlow(flow, { probe: true, params, secrets, browser: await this.#getBrowser(), timeoutMs: 60_000 });
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
