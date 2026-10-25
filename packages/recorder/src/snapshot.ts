/**
 * **화면 요약**(PLAN §42-8 · AI가 사이트를 본다) — 열린 페이지에서 보이는 요소(누를 것 · 넣을 칸 · 고를 것 · 읽을 글자 · 표)를
 * 녹화와 똑같은 위치 후보 · 지문으로 모은다. 녹화기의 #resolve처럼 **그 요소 하나만 가리키는 후보만** 남긴다 —
 * 그래서 AI가 이 요소를 쓰면(from) 녹화한 것과 같은 품질의 위치가 들어간다. 하나로 가리킬 후보가 없는 요소는 뺀다.
 *
 * ★넣은 값 · 비밀번호는 보내지 않는다(inject.js의 fingerprint가 이미 뺀다). 페이지의 글자는 그대로 간다 — AI 회사로 보내는 것은 관리자가 켠다.
 */
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import type { Locator, TableTarget, Target } from "@flowsmith/core";
import { build } from "@flowsmith/engine";

const INJECT = readFileSync(new URL("./inject.js", import.meta.url), "utf8");
/** 후보는 셋까지 — 녹화기는 다 남기지만 요약이 커진다 */
const MAX_LOCATORS = 3;

export type SnapKind = "button" | "link" | "input" | "select" | "checkbox" | "radio" | "text" | "table";
export interface SnapElement {
  kind: SnapKind;
  label: string;
  /** 읽을 글자면 그 글자 · 고르기면 고를 수 있는 것 */
  text?: string;
  options?: string[];
  target?: Target;
  table?: TableTarget;
}
export interface PageSnapshot { url: string; title: string; elements: SnapElement[] }

interface RawItem {
  token: string; kind: SnapKind; label: string; candidates?: Locator[]; fingerprint?: Target["fingerprint"];
  text?: string; options?: string[];
  table?: { rowsCss: string; columns: { name: string; selector: string }[]; count: number; label: string };
}

/** 페이지에 요약 스크립트를 심는다(녹화 스크립트와 같은 것 — 둘러보기 모드라 아무것도 가로채지 않는다) */
async function install(page: Page): Promise<void> {
  const has = await page.evaluate(() => typeof (globalThis as { __relaySnapshot?: unknown }).__relaySnapshot === "function").catch(() => false);
  if (!has) await page.evaluate(`${INJECT}\nrelayRecorder({ forbidden: [] });`);
}

export async function pageSnapshot(page: Page, opts: { max?: number } = {}): Promise<PageSnapshot> {
  await install(page);
  const raw = await page.evaluate((m) => (globalThis as unknown as { __relaySnapshot: (m: number) => { url: string; title: string; items: RawItem[] } }).__relaySnapshot(m), opts.max ?? 160);
  const elements: SnapElement[] = [];
  const now = new Date().toISOString();
  for (const it of raw.items) {
    if (it.kind === "table" && it.table) {
      const rows = page.locator(it.table.rowsCss);
      if ((await rows.count().catch(() => 0)) < 1) continue;
      elements.push({ kind: "table", label: it.label, text: `행 ${it.table.count}개`, table: {
        label: it.label, maxRows: 100,
        rows: { label: it.label, locators: [{ kind: "css", value: it.table.rowsCss }], fingerprint: null, frames: [], verifiedAt: now },
        columns: it.table.columns.map((c) => ({ name: c.name, selector: c.selector, strategy: "auto" as const })),
      } });
      continue;
    }
    // 그 요소 하나만 가리키는 후보 — 녹화기(session.ts #resolve)와 같은 확인
    const ok: Locator[] = [];
    const seen = new Set<string>();
    for (const c of it.candidates ?? []) {
      if (ok.length >= MAX_LOCATORS) break;
      const key = `${c.kind}\0${c.value}\0${c.name ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const loc = build(page, c);
        if ((await loc.count()) !== 1) continue;
        if (await loc.evaluate((el, t) => (globalThis as { __relayEls?: Record<string, unknown> }).__relayEls?.[t] === el, it.token)) ok.push(c);
      } catch { /* Playwright가 모르는 역할 등 */ }
    }
    if (ok.length === 0) continue;
    elements.push({
      kind: it.kind, label: it.label,
      ...(it.text ? { text: it.text } : {}), ...(it.options?.length ? { options: it.options } : {}),
      target: { label: it.label, locators: ok, fingerprint: it.fingerprint ?? null, frames: [], verifiedAt: now },
    });
  }
  return { url: raw.url, title: raw.title, elements };
}
