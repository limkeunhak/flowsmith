/**
 * Target → Playwright 위치.
 *
 * ★**정확히 하나**를 가리켜야 한다. 없으면 멈추고, 여러 개여도 멈춘다 —
 *  `.first()`로 아무거나 집으면 «비어 있지 않은데 틀린 값»이 된다.
 * ★실행은 `locators[0]`만 쓴다. 나머지는 실패할 때 «지금 몇 개를 가리키나»를 붙이는 데만 쓴다(결정 3).
 */
import type { FrameLocator, Locator as PwLocator, Page } from "playwright";
import type { Locator, Target } from "@flowsmith/core";
import { PROBLEMS, StepError, type Candidate } from "../errors.ts";

type Root = Page | FrameLocator;

export function rootOf(page: Page, frames: readonly string[]): Root {
  let r: Root = page;
  for (const f of frames) r = r.frameLocator(f);
  return r;
}

export function build(root: Root, l: Locator): PwLocator {
  switch (l.kind) {
    case "testid": return root.getByTestId(l.value);
    // role 이름은 검문소가 모른다 — Playwright가 모르는 역할이면 여기서 던진다
    case "role": return root.getByRole(l.value as Parameters<Page["getByRole"]>[0], l.name ? { name: l.name, exact: true } : {});
    case "label": return root.getByLabel(l.value, { exact: true });
    case "placeholder": return root.getByPlaceholder(l.value, { exact: true });
    case "text": return root.getByText(l.value, { exact: true });
    case "css": return root.locator(l.value);
    case "xpath": return root.locator(`xpath=${l.value}`);
  }
}

export const describeLocator = (l: Locator): string =>
  l.kind === "role" && l.name ? `role=${l.value}[name="${l.name}"]` : `${l.kind}=${l.value}`;

/** 다른 위치들이 지금 몇 개를 가리키나. 기다리지 않는다 — 진단용이다 */
export async function candidatesOf(page: Page, t: Target): Promise<Candidate[]> {
  const root = rootOf(page, t.frames);
  const out: Candidate[] = [];
  for (const l of t.locators.slice(1)) {
    const count = await build(root, l).count().catch(() => -1);
    out.push({ locator: l, count });
  }
  return out;
}

/** 정확히 하나를 찾는다. 나타날 때까지는 기다리고, 나타난 뒤 개수를 센다 */
export async function locateOne(page: Page, t: Target, timeoutMs: number): Promise<PwLocator> {
  const primary = t.locators[0]!;
  const loc = build(rootOf(page, t.frames), primary);
  const appeared = await loc.first().waitFor({ state: "attached", timeout: timeoutMs }).then(() => true, () => false);
  const count = appeared ? await loc.count() : 0;
  if (count === 1) return loc;
  const problem = count === 0 ? "missing" : "many";
  throw new StepError({
    problem,
    message: `${t.label}: ${PROBLEMS[problem]}${count > 1 ? ` (${count}개)` : ""} — ${describeLocator(primary)}`,
    label: t.label,
    locator: primary,
    candidates: await candidatesOf(page, t),
    url: page.url(),
  });
}

/** 여러 개를 허용한다 — 표의 행 */
export function locateAll(page: Page, t: Target): PwLocator {
  return build(rootOf(page, t.frames), t.locators[0]!);
}
