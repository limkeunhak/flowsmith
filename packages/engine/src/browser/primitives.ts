/**
 * **Primitives** — 웹페이지 노드의 동작이 브라우저에 닿는 유일한 자리.
 *
 * 사이트마다 다른 «어떻게 해야 눌리고 읽히나»를 여기 한 번씩만 둔다.
 * ★커스텀 노드는 여기를 거치지 않는다 — 날 Playwright `page`를 받는다(PLAN 결정 4).
 */
import type { Locator as PwLocator, Page } from "playwright";
import { STABLE_WAIT, type ReadStrategy, type RowPick, type TableTarget, type Target, type Wait } from "@flowsmith/core";
import { describeLocator, locateAll, locateOne, rootOf } from "./locate.ts";
import { PROBLEMS, StepError } from "../errors.ts";

/** 좌표 클릭을 시도해 보는 시간. 넘기면 이벤트로 누른다 */
const CLICK_TRY_MS = 3_000;
/** 값이 찼나 · 그대로인가 · 바뀌었나를 다시 보는 간격 */
const POLL_MS = 200;

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
    return this.press_(el, timeoutMs, t.label);
  }

  /**
   * 좌표로 먼저, 안 되면 이벤트로. ★누른 단추가 창을 닫으면(팝업의 닫기) 성공이다.
   * ★꺼진 단추(disabled)에 보낸 이벤트는 브라우저가 무시한다. 그대로 두면 아무 일도 없었는데 «이벤트로 누름»으로 남는다
   *  (NexusFlow HISTORY 187절: 계산 뒤 잠긴 화면에서 18칸이 조용히 빠졌다). 그래서 이벤트로 넘어가기 전에 켜져 있는지 본다.
   *  늦게 켜지는 단추일 수 있어 다시 해 볼 만한 실패(other)로 던진다
   */
  async press_(el: PwLocator, timeoutMs: number, label: string): Promise<{ how: "좌표" | "이벤트" }> {
    const ok = await el.click({ timeout: Math.min(CLICK_TRY_MS, timeoutMs) }).then(() => true, () => this.page.isClosed());
    if (ok) return { how: "좌표" };
    if (!(await el.isEnabled({ timeout: 1_000 }).catch(() => true))) {
      throw new StepError({ problem: "other", message: `${label}: 꺼져 있는 단추입니다 — 이벤트로 눌러도 화면이 무시하므로 누르지 않았습니다`, label, locator: null, candidates: [] });
    }
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

  /**
   * 고른다 — 보이는 이름으로 먼저, 없으면 값으로. 그다음 포커스를 떼고 **되읽는다.**
   * ★선택지를 다시 그리는 화면(앞 칸에 따라 보기가 바뀌는 것)은 고른 직후 기본값으로 되돌리기도 한다. `selectOption`이 고른 값을
   *  돌려줘도 화면에 남았다는 뜻은 아니다
   */
  async select(t: Target, value: string, timeoutMs: number): Promise<{ by: "이름" | "값" }> {
    const el = await locateOne(this.page, t, timeoutMs);
    const byLabel = await el.selectOption({ label: value }, { timeout: Math.min(timeoutMs, 3_000) }).then((v) => v.length > 0, () => false);
    if (!byLabel) {
      const byValue = await el.selectOption(value, { timeout: timeoutMs }).then((v) => v.length > 0, () => false);
      if (!byValue) {
        throw new StepError({ problem: "notFilled", message: `${t.label}: 보기 "${value}"가 없습니다(이름으로도 값으로도)`, label: t.label, locator: t.locators[0]!, candidates: [] });
      }
    }
    await el.blur({ timeout: timeoutMs }).catch(() => undefined);
    const now = await selectedOf(el, timeoutMs).catch(() => null);
    if (now !== null && !isChosen(now, value)) {
      throw new StepError({ problem: "notFilled", message: `${t.label}: ${PROBLEMS.notFilled} — 고른 뒤 화면의 보기는 «${now.label}»입니다`, label: t.label, locator: t.locators[0]!, candidates: [] });
    }
    return { by: byLabel ? "이름" : "값" };
  }

  /**
   * 넣은 칸이 지금도 그 값인가 — «넣은 칸 다시 확인»이 쓴다. 못 찾으면 locateOne이 멈춘다(지운 게 아니라 화면이 바뀐 것이다)
   */
  async holds(t: Target, kind: "fill" | "select" | "check", value: string | boolean, timeoutMs: number): Promise<boolean> {
    const el = await locateOne(this.page, t, timeoutMs);
    if (kind === "check") return (await el.isChecked({ timeout: timeoutMs })) === value;
    if (kind === "select") return isChosen(await selectedOf(el, timeoutMs), String(value));
    return bare(await el.inputValue({ timeout: timeoutMs })) === bare(String(value));
  }

  /** 지금 값 — 기다리지 않는다. 요소가 없으면 null(빈 글자와 구분한다). «바뀔 때까지»가 앞 동작 직전에 적어 둔다 */
  async peek(t: Target): Promise<string | null> {
    const loc = locateAll(this.page, t).first();
    if ((await loc.count().catch(() => 0)) === 0) return null;
    const v = await readEl(loc, "auto", null, 1_000).catch(() => null);
    return v === null ? null : String(v);
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

  /**
   * 표 — 행은 여러 개가 정상이다. 칸이 없으면 null(빈 글자와 구분한다).
   * note는 실행 기록에 덧붙일 말이다(빈 표로 본 까닭 · 스크롤로 몇 번 이어 읽었나).
   * ★행이 이미 있으면 곧바로 읽는다. 앞 조회의 결과가 남아 있는 화면이면 그 앞에 «값이 바뀔 때까지»를 둔다
   */
  async readTable(tbl: TableTarget, timeoutMs: number): Promise<{ rows: Row[]; note: string | null }> {
    const rows = locateAll(this.page, tbl.rows);
    const arrived = await this.#tableArrived(tbl, timeoutMs);
    if (arrived === "empty") return { rows: [], note: `빈 표 표시(${tbl.empty!.label})가 보여 빈 표로 봤습니다` };
    if (arrived === "none") {
      // 행이 하나도 없는 표도 정상일 수 있다 — 다만 «아직 안 그려짐»과 가를 수 없으니 그 사실을 남긴다
      return { rows: [], note: `행이 ${Math.round(timeoutMs / 1000)}초 동안 하나도 나오지 않아 빈 표로 봤습니다 — «빈 표 표시»를 정하면 기다리지 않고 확실히 가릅니다` };
    }
    if (tbl.scroll) return this.#readScrolled(tbl, timeoutMs);
    return { rows: await readRows(rows, tbl, timeoutMs), note: null };
  }

  /** 행이 왔나 · 빈 표 표시가 보이나 · 둘 다 아닌 채 시간이 갔나. ★빈 표 문구가 행 모양으로 그려지는 표가 있어 행이 와도 표시를 한 번 더 본다 */
  async #tableArrived(tbl: TableTarget, timeoutMs: number): Promise<"rows" | "empty" | "none"> {
    const first = locateAll(this.page, tbl.rows).first().waitFor({ state: "attached", timeout: timeoutMs }).then(() => "rows" as const, () => "none" as const);
    if (!tbl.empty) return first;
    const mark = locateAll(this.page, tbl.empty).first();
    const empty = mark.waitFor({ state: "visible", timeout: timeoutMs }).then(() => "empty" as const, () => "none" as const);
    const got = await Promise.race([first, empty]);
    if (got === "rows" && (await mark.isVisible().catch(() => false))) return "empty";
    return got;
  }

  /**
   * 보이는 행만 그리는 표(가상 스크롤) — 맨 위로 올리고 **반 화면씩** 내리며 읽는다. 묶음마다 앞 묶음의 끝과 겹치는 행을 찾아 그 뒤만 붙인다.
   * ★겹침이 없으면 행을 건너뛴 것이라 멈춘다. 셀만 훑으면 늘 보이는 몇 줄만, 그것도 그때의 스크롤 자리에 따라 다른 행을 읽고
   *  실패도 남지 않는다(NexusFlow DESIGN 13-1-4 · 2026-08-19 실측).
   * ☆스크롤 상자에 미리 그려 둔 빈 행(모든 칸이 비어 있는 행)은 뺀다 — 묶음 끝에 붙으면 겹침을 찾지 못한다.
   * ☆같은 행이 정말로 연달아 있으면 겹침을 길게 잡아 하나로 합칠 수 있다. 행에 번호 같은 고유한 칸이 있으면 열에 넣어 둔다
   */
  async #readScrolled(tbl: TableTarget, timeoutMs: number): Promise<{ rows: Row[]; note: string }> {
    const boxes = rootOf(this.page, tbl.rows.frames).locator(tbl.scroll!);
    const n = await boxes.count();
    if (n !== 1) {
      throw new StepError({ problem: n === 0 ? "missing" : "many", message: `${tbl.label} 스크롤 상자: ${n === 0 ? PROBLEMS.missing : `${PROBLEMS.many} (${n}개)`} — css=${tbl.scroll}`, label: tbl.label, locator: null, candidates: [] });
    }
    const box = boxes.first();
    const scrollTo = (to: number | null) => box.evaluate((e: any, next: number | null) => {
      if (next !== null) e.scrollTop = next;
      return { top: e.scrollTop as number, view: e.clientHeight as number };
    }, to, { timeout: timeoutMs });
    const rows = locateAll(this.page, tbl.rows);
    const start = await scrollTo(null);
    const out: Row[] = [];
    let passes = 0;
    try {
      let at = await scrollTo(0);
      for (;;) {
        const batch = (await settledRows(rows, tbl, timeoutMs, this.page)).filter((r) => !Object.values(r).every((v) => v === null || v === ""));
        passes++;
        const k = overlap(out, batch);
        if (out.length > 0 && batch.length > 0 && k === 0) {
          throw new StepError({ problem: "other", message: `${tbl.label}: 스크롤한 뒤 읽은 행이 앞 행과 겹치지 않습니다 — 건너뛴 행이 있을 수 있어 멈춥니다(${passes}번째 묶음 · 지금까지 ${out.length}행)`, label: tbl.label, locator: null, candidates: [] });
        }
        out.push(...batch.slice(k));
        if (out.length >= tbl.maxRows) break;
        const next = await scrollTo(at.top + Math.max(1, Math.floor(at.view / 2)));
        if (next.top <= at.top) break;   // 더 내려가지 않는다 — 맨 아래다
        at = next;
      }
    } finally {
      // 사람이 보던 화면일 수 있다 — 스크롤을 원래 자리로 돌린다
      await scrollTo(start.top).catch(() => undefined);
    }
    return { rows: out.slice(0, tbl.maxRows), note: `스크롤하며 ${passes}번 읽어 이었습니다` };
  }

  /**
   * 기다린다. 돌려주는 글자는 실행 기록에 덧붙일 말이다(«바뀔 때까지»가 안 바뀐 채 넘어갔을 때).
   * before는 «바뀔 때까지»가 견줄 값이다 — 바로 앞 동작 직전에 실행기가 `peek`으로 적어 둔다(null은 요소가 없었다)
   */
  async wait(w: Wait, timeoutMs: number, before: string | null = null): Promise<string | null> {
    switch (w.kind) {
      case "fixed": await this.page.waitForTimeout(w.ms); return null;
      case "visible":
      case "hidden": {
        const loc = locateAll(this.page, w.target);
        const ok = await loc.first().waitFor({ state: w.kind, timeout: timeoutMs }).then(() => true, () => false);
        if (!ok) throw new StepError({ problem: "timeout", message: `${w.target.label}이 ${w.kind === "visible" ? "나타나지" : "사라지지"} 않았습니다 — ${describeLocator(w.target.locators[0]!)}`, label: w.target.label, locator: w.target.locators[0]!, candidates: [] });
        return null;
      }
      case "url": await this.page.waitForURL(new RegExp(w.pattern, "u"), { timeout: timeoutMs }); return null;
      case "networkIdle": await this.page.waitForLoadState("networkidle", { timeout: timeoutMs }); return null;
      case "filled": {
        // 값이 찰 때까지 — 조회 뒤 결과 칸이 늦게 채워지는 화면
        const loc = locateAll(this.page, w.target).first();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const v = await readEl(loc, "auto", null, 500).catch(() => null);
          if (v !== null && String(v).trim() !== "") return null;
          await this.page.waitForTimeout(POLL_MS);
        }
        throw new StepError({ problem: "timeout", message: `${w.target.label}에 값이 차지 않았습니다 — ${describeLocator(w.target.locators[0]!)}`, label: w.target.label, locator: w.target.locators[0]!, candidates: [] });
      }
      case "stable": {
        // 같은 값이 ms 동안 이어지면 끝. 빈 값 · 요소 없음은 그대로여도 끝으로 치지 않는다(아직 안 온 것과 가를 수 없다)
        const loc = locateAll(this.page, w.target).first();
        const deadline = Date.now() + timeoutMs;
        let seen: string | null = null;
        let since = Date.now();
        while (Date.now() < deadline) {
          const v = await readEl(loc, "auto", null, 500).then(String, () => null);
          const now = Date.now();
          if (v !== seen) { seen = v; since = now; }
          else if (v !== null && v.trim() !== "" && now - since >= w.ms) return null;
          await this.page.waitForTimeout(POLL_MS);
        }
        throw new StepError({ problem: "timeout", message: `${w.target.label}의 값이 ${w.ms / 1000}초 동안 그대로인 때가 없었습니다(아직 바뀌는 중이거나 비어 있음) — ${describeLocator(w.target.locators[0]!)}`, label: w.target.label, locator: w.target.locators[0]!, candidates: [] });
      }
      case "changed": {
        const loc = locateAll(this.page, w.target).first();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const v = await readEl(loc, "auto", null, 500).then(String, () => null);
          if (v !== before) {
            // 바뀌었다 — 반쯤 그려진 결과를 읽지 않게 그대로일 때까지 본다. 남은 시간이 짧아도 정착 판정 한 번은 할 수 있게 준다
            const rest = Math.max(deadline - Date.now(), STABLE_WAIT.defaultMs + 1_000);
            return this.wait({ kind: "stable", target: w.target, ms: STABLE_WAIT.defaultMs }, rest).then(
              () => null,
              () => `${w.target.label}의 값이 바뀌었지만 그대로가 되기 전에 시간이 다 됐습니다 — 이어 갑니다`,
            );
          }
          await this.page.waitForTimeout(POLL_MS);
        }
        // ★멈추지 않는다 — 두 조회의 결과가 정말 같을 수 있다(NexusFlow DESIGN 7절 poll_changed). 무엇과 견줬는지는 남긴다
        const was = before === null ? "요소 없음" : before.trim() === "" ? "빈 값" : `${before.length}글자`;
        return `${w.target.label}의 값이 ${Math.round(timeoutMs / 1000)}초 동안 앞 동작 전(${was})과 같았습니다 — 결과가 정말 같았거나 늦었습니다. 이어 갑니다`;
      }
    }
  }
}

type Row = Record<string, string | boolean | null>;

/** 지금 그려진 행을 읽는다(최대 maxRows) */
async function readRows(rows: PwLocator, tbl: TableTarget, timeoutMs: number): Promise<Row[]> {
  const n = Math.min(await rows.count(), tbl.maxRows);
  const out: Row[] = [];
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const rec: Row = {};
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

/**
 * 스크롤 뒤 다시 그려진 행 — 가상 스크롤 표는 같은 행 요소의 내용을 스크롤 뒤에 바꾼다. 두 번 연달아 같게 읽힐 때까지 본다(최대 2초).
 * 끝내 흔들리면 마지막 것을 쓴다. 틀렸으면 겹침 검사가 멈춘다
 */
async function settledRows(rows: PwLocator, tbl: TableTarget, timeoutMs: number, page: Page): Promise<Row[]> {
  let last = await readRows(rows, tbl, timeoutMs);
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(150);
    const now = await readRows(rows, tbl, timeoutMs);
    if (JSON.stringify(now) === JSON.stringify(last)) return now;
    last = now;
  }
  return last;
}

/** 앞에 모은 행의 끝과 새 묶음의 앞이 몇 행 겹치나 — 가장 길게 겹치는 것 */
export function overlap(acc: readonly Row[], batch: readonly Row[]): number {
  const key = (r: Row) => JSON.stringify(r);
  for (let k = Math.min(acc.length, batch.length); k > 0; k--) {
    let same = true;
    for (let i = 0; i < k && same; i++) same = key(acc[acc.length - k + i]!) === key(batch[i]!);
    if (same) return k;
  }
  return 0;
}

/** 고른 보기 — 값(코드)과 사람이 보는 이름 */
function selectedOf(el: PwLocator, timeoutMs: number): Promise<{ value: string; label: string }> {
  return el.evaluate((e: any) => ({ value: String(e.value ?? ""), label: String(e.selectedOptions?.[0]?.textContent ?? "") }), undefined, { timeout: timeoutMs });
}

/** 고르려던 것이 골라져 있나 — 이름으로도 값으로도 고를 수 있으므로 둘 중 하나가 맞으면 된다 */
function isChosen(now: { value: string; label: string }, want: string): boolean {
  return norm(now.label) === norm(want) || now.value === want;
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
  await this.press_(el, timeoutMs, p.label);
  return { index };
};

declare module "./primitives.ts" {
  interface Primitives {
    pickRow(p: RowPick, value: string, timeoutMs: number): Promise<{ index: number }>;
  }
}
