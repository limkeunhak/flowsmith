/**
 * **Primitives** — 웹페이지 노드의 동작이 브라우저에 닿는 유일한 자리.
 *
 * 사이트마다 다른 «어떻게 해야 눌리고 읽히나»를 여기 한 번씩만 둔다.
 * ★커스텀 노드는 여기를 거치지 않는다 — 날 Playwright `page`를 받는다(PLAN 결정 4).
 */
import type { Locator as PwLocator, Page } from "playwright";
import type { ReadStrategy, RowPick, TableTarget, Target, Wait } from "@flowsmith/core";
import { describeLocator, locateAll, locateOne } from "./locate.ts";
import { PROBLEMS, StepError } from "../errors.ts";

/** 좌표 클릭을 시도해 보는 시간. 넘기면 이벤트로 누른다 */
const CLICK_TRY_MS = 3_000;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
/** 구분 기호를 뗀 글자 — 사이트가 `1234`를 `1,234`로 고쳐 보여 줘도 같은 값이다 */
const bare = (s: string): string => s.replace(/[^\p{L}\p{N}]/gu, "");

export class Primitives {
  readonly page: Page;
  readonly #forbidden: readonly RegExp[];

  constructor(page: Page, forbiddenLabels: readonly string[]) {
    this.page = page;
    this.#forbidden = forbiddenLabels.map((s) => new RegExp(s, "u"));
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  }

  /**
   * 누른다. ★**가드가 언제나 먼저다.**
   *
   * 가드는 요소의 글자만 보면 안 된다 — 이미지 버튼은 글자가 비어 있고 정체가 alt · title · aria-label ·
   * value · id · onclick에 남는다. 그래서 그것들을 다 이어 붙여 본다.
   *
   * 누르는 법은 «좌표로 먼저, 안 되면 이벤트로». 겹친 위젯이나 iframe이
   * 좌표 클릭을 가로채는 사이트가 많다. ★`force` 클릭은 쓰지 않는다 — 가려진 **다른** 요소가 맞을 수 있다.
   */
  async click(t: Target, timeoutMs: number): Promise<{ how: "좌표" | "이벤트" }> {
    const el = await locateOne(this.page, t, timeoutMs);
    await this.assertClickable(el, t.label, t.locators[0]!);
    return this.press_(el, timeoutMs);
  }

  /** 좌표로 먼저, 안 되면 이벤트로. ★누른 단추가 창을 닫으면(팝업의 닫기) 성공이다 */
  async press_(el: PwLocator, timeoutMs: number): Promise<{ how: "좌표" | "이벤트" }> {
    const ok = await el.click({ timeout: Math.min(CLICK_TRY_MS, timeoutMs) }).then(() => true, () => this.page.isClosed());
    if (ok) return { how: "좌표" };
    await el.dispatchEvent("click", {}, { timeout: timeoutMs }).catch((e: unknown) => { if (!this.page.isClosed()) throw e; });
    return { how: "이벤트" };
  }

  async assertClickable(el: PwLocator, label: string, locator: Target["locators"][number] | null): Promise<void> {
    if (this.#forbidden.length === 0) return;
    const text = norm(await el.evaluate((e: any) => [
      e.innerText, e.value, e.getAttribute?.("alt"), e.getAttribute?.("title"),
      e.getAttribute?.("aria-label"), e.id, e.getAttribute?.("onclick"),
    ].filter(Boolean).join(" ")));
    const hit = this.#forbidden.find((re) => re.test(text) || re.test(label));
    if (hit) {
      throw new StepError({
        problem: "forbidden",
        message: `${label}: ${PROBLEMS.forbidden} — 요소 글자 "${text.slice(0, 60)}"가 금지 규칙 /${hit.source}/에 걸립니다`,
        label, locator, candidates: [],
      });
    }
  }

  /**
   * 칸을 채운다 → 포커스를 뗀다 → **되읽는다.**
   *
   * ★blur: 구형 화면은 값 변경이 아니라 blur에서 움직인다. 안 하면 넣다 만 것이다.
   * ★되읽기: 넣었다고 들어간 게 아니다 — 실제로 한글 한 글자와 숫자 하나가 조용히 빠진 적이 있다.
   *  안 맞으면 네이티브 setter + 이벤트로 **한 번만** 다시 넣어 보고, 그래도 안 맞으면 멈춘다.
   */
  async fill(t: Target, value: string, timeoutMs: number): Promise<{ retried: boolean }> {
    const el = await locateOne(this.page, t, timeoutMs);
    await el.fill(value, { timeout: timeoutMs });
    await el.blur({ timeout: timeoutMs }).catch(() => undefined);
    if (value === "") return { retried: false };

    const read = () => el.inputValue({ timeout: Math.min(timeoutMs, 3_000) }).catch(() => null);
    const got = await read();
    if (got !== null && bare(got) === bare(value)) return { retried: false };

    await el.evaluate((e: any, v: string) => {
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), "value")?.set;
      if (set) set.call(e, v); else e.value = v;
      for (const type of ["input", "change", "keyup", "blur"]) e.dispatchEvent(new Event(type, { bubbles: true }));
    }, value).catch(() => undefined);
    const again = await read();
    if (again !== null && bare(again) === bare(value)) return { retried: true };

    throw new StepError({
      problem: "notFilled",
      // ★넣으려던 값은 메시지에 안 쓴다 — 시크릿일 수 있다. 가림은 위에서 하지만 애초에 안 싣는 게 낫다
      message: `${t.label}: ${PROBLEMS.notFilled} (처음 ${got === null ? "못 읽음" : `${got.length}글자`} · 다시 넣은 뒤 ${again === null ? "못 읽음" : `${again.length}글자`}, 넣으려던 것 ${value.length}글자)`,
      label: t.label, locator: t.locators[0]!, candidates: [],
    });
  }

  /** 고른다 — 보이는 이름으로 먼저, 없으면 값으로. 고른 뒤 정말 골라졌는지 본다 */
  async select(t: Target, value: string, timeoutMs: number): Promise<{ by: "이름" | "값" }> {
    const el = await locateOne(this.page, t, timeoutMs);
    const byLabel = await el.selectOption({ label: value }, { timeout: Math.min(timeoutMs, 3_000) }).then((v) => v.length > 0, () => false);
    if (!byLabel) {
      const byValue = await el.selectOption(value, { timeout: timeoutMs }).then((v) => v.length > 0, () => false);
      if (!byValue) {
        throw new StepError({ problem: "notFilled", message: `${t.label}: 보기 "${value}"가 없습니다(이름으로도 값으로도)`, label: t.label, locator: t.locators[0]!, candidates: [] });
      }
    }
    return { by: byLabel ? "이름" : "값" };
  }

  async check(t: Target, checked: boolean, timeoutMs: number): Promise<void> {
    const el = await locateOne(this.page, t, timeoutMs);
    await el.setChecked(checked, { timeout: timeoutMs });
    if ((await el.isChecked()) !== checked) {
      throw new StepError({ problem: "notFilled", message: `${t.label}: ${checked ? "켰는데" : "껐는데"} 그대로입니다`, label: t.label, locator: t.locators[0]!, candidates: [] });
    }
  }

  async press(t: Target | null, key: string, timeoutMs: number): Promise<void> {
    if (t === null) { await this.page.keyboard.press(key); return; }
    const el = await locateOne(this.page, t, timeoutMs);
    await el.press(key, { timeout: timeoutMs });
  }

  async read(t: Target, strategy: ReadStrategy, attribute: string | null, timeoutMs: number): Promise<string | boolean | null> {
    const el = await locateOne(this.page, t, timeoutMs);
    return readEl(el, strategy, attribute, timeoutMs);
  }

  /** 표 — 행은 여러 개가 정상이다. 칸이 없으면 null(빈 글자와 구분한다) */
  async readTable(tbl: TableTarget, timeoutMs: number): Promise<Record<string, string | boolean | null>[]> {
    const rows = locateAll(this.page, tbl.rows);
    // 행이 하나도 없는 표도 정상이다 — 다만 표가 그려질 시간은 준다
    await rows.first().waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
    const n = Math.min(await rows.count(), tbl.maxRows);
    const out: Record<string, string | boolean | null>[] = [];
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const rec: Record<string, string | boolean | null> = {};
      for (const c of tbl.columns) {
        const cell = row.locator(c.selector);
        const k = await cell.count();
        if (k > 1) throw new StepError({ problem: "many", message: `${tbl.label} ${i + 1}행 '${c.name}' 칸: ${PROBLEMS.many} (${k}개) — css=${c.selector}`, label: tbl.label, locator: null, candidates: [] });
        rec[c.name] = k === 0 ? null : await readEl(cell, c.strategy, null, timeoutMs);
      }
      out.push(rec);
    }
    return out;
  }

  async wait(w: Wait, timeoutMs: number): Promise<void> {
    switch (w.kind) {
      case "fixed": await this.page.waitForTimeout(w.ms); return;
      case "visible":
      case "hidden": {
        const loc = locateAll(this.page, w.target);
        const ok = await loc.first().waitFor({ state: w.kind, timeout: timeoutMs }).then(() => true, () => false);
        if (!ok) throw new StepError({ problem: "timeout", message: `${w.target.label}이 ${w.kind === "visible" ? "나타나지" : "사라지지"} 않았습니다 — ${describeLocator(w.target.locators[0]!)}`, label: w.target.label, locator: w.target.locators[0]!, candidates: [] });
        return;
      }
      case "url": await this.page.waitForURL(new RegExp(w.pattern, "u"), { timeout: timeoutMs }); return;
      case "networkIdle": await this.page.waitForLoadState("networkidle", { timeout: timeoutMs }); return;
      case "filled": {
        // 값이 찰 때까지 — 조회 뒤 결과 칸이 늦게 채워지는 화면
        const loc = locateAll(this.page, w.target).first();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const v = await readEl(loc, "auto", null, 500).catch(() => null);
          if (v !== null && String(v).trim() !== "") return;
          await this.page.waitForTimeout(200);
        }
        throw new StepError({ problem: "timeout", message: `${w.target.label}에 값이 차지 않았습니다 — ${describeLocator(w.target.locators[0]!)}`, label: w.target.label, locator: w.target.locators[0]!, candidates: [] });
      }
    }
  }
}

/**
 * 보이는 글자 — innerText에서 **화면 읽기 프로그램용 숨은 글자**(「새 창 열림」 · 1px로 잘라 둔 .blind)를 뺀다.
 * ★페이지 안에서 돈다(evaluate) — 바깥 변수를 쓰지 않는다
 */
function visibleText(root: any): string {
  const hidden = (e: any): boolean => {
    const r = e.getBoundingClientRect();
    const s = (globalThis as any).getComputedStyle(e);
    return (r.width <= 1 && r.height <= 1) || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(s.clip) || s.clipPath === "inset(50%)";
  };
  if (!root.querySelectorAll) return root.innerText ?? "";
  const skip = Array.from(root.querySelectorAll("*")).filter((e: any) => e.children.length === 0 && (e.textContent ?? "").trim() !== "" && hidden(e));
  if (skip.length === 0) return root.innerText ?? "";
  // 숨은 것을 잠깐 비우고 innerText를 잰 뒤 되돌린다 — 줄바꿈 · 띄어쓰기는 브라우저 규칙 그대로
  const saved = skip.map((e: any) => e.textContent);
  skip.forEach((e: any) => { e.textContent = ""; });
  try { return root.innerText ?? ""; } finally { skip.forEach((e: any, i: number) => { e.textContent = saved[i]; }); }
}

async function readEl(el: PwLocator, strategy: ReadStrategy, attribute: string | null, timeoutMs: number): Promise<string | boolean | null> {
  switch (strategy) {
    case "value": return norm(await el.inputValue({ timeout: timeoutMs }));
    case "text": return norm((await el.textContent({ timeout: timeoutMs })) ?? "");
    case "innerText": return norm(await el.innerText({ timeout: timeoutMs }));
    case "checked": return await el.isChecked({ timeout: timeoutMs });
    case "attribute": return await el.getAttribute(attribute!, { timeout: timeoutMs });
    // 고르기의 «고른 보기»의 글자 — 값(코드)이 아니라 사람이 보는 말
    case "selected": return norm(await el.evaluate((e: any) => (e.selectedOptions && e.selectedOptions[0] ? e.selectedOptions[0].textContent : e.value) ?? "", undefined, { timeout: timeoutMs }));
    // 링크 주소 — 요소 자신이나 감싼 링크의 href를 **절대 주소로**(「?query=…」가 아니라 https://…)
    case "link": return await el.evaluate((e: any) => (e.closest?.("a[href]") ?? e.querySelector?.("a[href]"))?.href ?? null, undefined, { timeout: timeoutMs });
    case "auto": {
      // 입력 칸이면 값, 아니면 보이는 글자
      const v = await el.inputValue({ timeout: 500 }).catch(() => null);
      return norm(v ?? await el.evaluate(visibleText, undefined, { timeout: timeoutMs }));
    }
  }
}

/**
 * 표에서 행을 고른다 — 기본은 행 번호가 아니라 **키 칸의 글자**로 찾는다(주문번호 · 회원번호).
 * by index면 **n번째** 행(1부터 · 음수는 끝에서 — -1은 마지막). 그 자리에 행이 없으면 멈춘다.
 * ★없으면 · 여러 개면 멈춘다. 고르면 안 되는 행(「주문확정」)이면 이유를 말하며 멈춘다.
 * ★누르기 전에 금지 단추 가드를 거친다.
 */
Primitives.prototype.pickRow = async function (this: Primitives, p: RowPick, value: string, timeoutMs: number) {
  const rows = locateAll(this.page, p.rows);
  await rows.first().waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
  const want = norm(value);
  const n = await rows.count();
  const hits: number[] = [];
  const byIndex = p.by === "index";
  const key = byIndex ? "몇 번째" : p.keyLabel || "키";
  if (byIndex) {
    const k = Number(value.trim().replace(/번째$/, ""));
    if (!Number.isInteger(k) || k === 0) throw new StepError({ problem: "other", message: `${p.label}: 몇 번째인지 «${value}»를 읽을 수 없습니다 — 1 · 2 · 3 … 또는 끝에서 -1 · -2 …`, label: p.label, locator: null, candidates: [] });
    const i = k > 0 ? k - 1 : n + k;
    if (i < 0 || i >= n) {
      throw new StepError({ problem: "missing", message: `${p.label}: ${k > 0 ? `${k}번째` : `끝에서 ${-k}번째`} 행이 없습니다(행 ${n}개)`, label: p.label, locator: p.rows.locators[0]!, candidates: [] });
    }
    hits.push(i);
  } else for (let i = 0; i < n; i++) {
    const cell = rows.nth(i).locator(p.keyColumn);
    if ((await cell.count()) !== 1) continue;
    if (norm(await cell.innerText({ timeout: timeoutMs }).catch(() => "")) === want) hits.push(i);
  }
  if (hits.length !== 1) {
    throw new StepError({
      problem: hits.length === 0 ? "missing" : "many",
      message: `${p.label}: ${key} "${value}"인 행이 ${hits.length === 0 ? `없습니다(행 ${n}개)` : `${hits.length}개입니다 — 어느 것인지 정할 수 없습니다`}`,
      label: p.label, locator: p.rows.locators[0]!, candidates: [],
    });
  }
  const index = hits[0]!;
  const row = rows.nth(index);
  if (p.refuse) {
    const got = norm(await row.locator(p.refuse.column).first().innerText({ timeout: timeoutMs }).catch(() => ""));
    if (p.refuse.values.some((v) => norm(v) === got)) {
      throw new StepError({ problem: "refused", message: `${p.label}: ${byIndex ? `${index + 1}번째 행` : `${key} "${value}"`} — ${p.refuse.reason}(「${got}」). ${PROBLEMS.refused}`, label: p.label, locator: null, candidates: [] });
    }
  }
  const el = p.click ? row.locator(p.click) : row;
  if ((await el.count()) !== 1) {
    throw new StepError({ problem: "missing", message: `${p.label}: ${index + 1}번째 행 안에서 누를 것(${p.click})을 하나로 찾지 못했습니다`, label: p.label, locator: null, candidates: [] });
  }
  await this.assertClickable(el, p.label, null);
  await this.press_(el, timeoutMs);
  return { index };
};

declare module "./primitives.ts" {
  interface Primitives {
    pickRow(p: RowPick, value: string, timeoutMs: number): Promise<{ index: number }>;
  }
}
