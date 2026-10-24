/**
 * **MetaMask 화면 조작**(13.0.0 — core METAMASK_VERSION) — 지갑 준비 · 잠금 풀기 · 계정 불러오기 · 막는 창 닫기.
 * 사내 webtest-automation(`src/pages/metamask/metamask.page.ts` · docs/4. METAMASK-NOTES.md)에서 실제 사이트로 다듬은 것을 옮겼다.
 *
 * ★LavaMoat — MetaMask 화면에서는 `page.evaluate` · `dispatchEvent`가 막힌다. 격리된 world의 locator 동작(click · fill ·
 *  keyboard · isChecked · innerText)만 쓴다. 복구 문구는 붙여넣기가 안 되니 **키보드로 친다**(단어마다 스페이스 · 끝에는 안 친다).
 * ★13.x는 미리 깔린 Solana · Bitcoin · Tron 스냅이 온보딩 직후 돌며 확장 화면의 메모리를 터뜨릴 수 있다 —
 *  온보딩 마지막 화면에서 «기본 기능»을 끈다(useExternalServices). 우리 체인의 RPC는 영향이 없다.
 * ★testid가 없는 요소는 영어 · 한국어를 함께 찾는다 — 확장 화면 언어는 실행 옵션으로 바뀌지 않는다.
 */
import type { Locator, Page } from "playwright";

export type Log = (text: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 지갑 화면(계정 단추)이 보이면 지갑이 준비된 것 */
const HOME = '[data-testid="account-menu-icon"], [data-testid="eth-overview__primary-currency"], [data-testid="account-options-menu-button"]';

export class MetaMaskUi {
  page: Page;
  readonly extensionId: string;
  readonly #log: Log;

  constructor(page: Page, extensionId: string, log: Log) {
    this.page = page;
    this.extensionId = extensionId;
    this.#log = log;
  }

  get homeUrl(): string { return `chrome-extension://${this.extensionId}/home.html`; }

  async open(): Promise<void> {
    await this.page.goto(this.homeUrl, { waitUntil: "domcontentloaded" });
  }

  /** 확장 화면이 무엇이든 그려질 때까지 — 일찍 판단하면 잠긴 지갑을 «없음»으로 본다 */
  async settle(timeoutMs = 30_000): Promise<void> {
    await this.page.locator(`[data-testid="unlock-page"], ${HOME}, [data-testid="onboarding-import-wallet"], [data-testid="onboarding-get-started-button"], [data-testid="terms-of-use-checkbox"], input#onboarding__terms-checkbox`)
      .first().waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
  }

  async isWalletHome(timeout = 4000): Promise<boolean> {
    return this.page.locator(HOME).first().isVisible({ timeout }).catch(() => false);
  }

  async isOnboardingPending(): Promise<boolean> {
    if (this.page.url().includes("onboarding/welcome")) return true;
    return this.page.locator('[data-testid="onboarding-import-wallet"], [data-testid="onboarding-get-started-button"], [data-testid="terms-of-use-checkbox"], input#onboarding__terms-checkbox')
      .first().isVisible({ timeout: 3000 }).catch(() => false);
  }

  // ─── 작은 도구 ──────────────────────────────────────────────────

  async #clickIfVisible(l: Locator, timeout = 2000): Promise<boolean> {
    const t = l.first();
    if (await t.isVisible({ timeout }).catch(() => false)) { await t.click({ force: true }).catch(() => undefined); return true; }
    return false;
  }

  /** MetaMask는 값이 맞을 때까지 제출 단추를 꺼 둔다 */
  async #waitEnabled(l: Locator, ms: number, what: string): Promise<void> {
    const t = l.first();
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await t.isEnabled().catch(() => false)) return; await sleep(250); }
    throw new Error(`MetaMask «${what}» 단추가 ${Math.round(ms / 1000)}초 동안 꺼져 있었습니다 — 넣은 값을 확인하세요`);
  }

  // ─── 지갑 준비(온보딩) ────────────────────────────────────────────

  /** 복구 문구로 지갑을 만든다 — 끝나면 지갑 화면 */
  async onboard(words: string[], password: string): Promise<void> {
    const p = this.page;
    await p.goto(`${this.homeUrl}#onboarding/welcome`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2500);
    // 13.0.x: 시작 화면 → 이용약관 창(끝까지 내려야 «동의»가 켜진다) → «시작하기»
    await this.#acceptTerms();
    await this.#clickIfVisible(p.locator('[data-testid="onboarding-get-started-button"], button:has-text("Get started"), button:has-text("시작하기")'), 4000);
    await this.#acceptTerms();
    const importBtn = p.locator('[data-testid="onboarding-import-wallet"], button:has-text("Import an existing wallet"), button:has-text("기존 지갑 가져오기")');
    await importBtn.first().waitFor({ state: "visible", timeout: 20_000 });
    await importBtn.first().click();
    await p.waitForTimeout(1500);
    // 소셜 로그인 화면 → 복구 문구로
    await this.#clickIfVisible(p.locator('[data-testid="onboarding-import-with-srp-button"], button:has-text("Import using Secret Recovery Phrase"), button:has-text("비밀복구구문으로 가져오기")'), 6000);
    await p.waitForTimeout(1200);
    await this.#dismissMetrics();
    await this.#typePhrase(words);
    await this.#createPassword(password);
    // 끝 화면(«지갑 준비됨»)에서 멈춘다 — «완료» 전에 기본 기능을 끈다
    await this.#settleScreens(12, false, password);
    await this.#unlockOnce(password);
    await this.#disableBasicFunctionality();
    await this.#settleScreens(20, true, password);
    // ★금고를 만든 직후에는 잠금 화면 · 완료 화면 사이를 오간다 — 여기서 지갑 화면을 따지지 않는다(부른 쪽이 잠금을 푼 뒤 본다)
    this.#log("MetaMask: 지갑을 준비했습니다");
  }

  /** 지갑 화면까지 — 잠겨 있으면 풀고, 그래도 아니면 지갑 주소로 다시 가 본다. 끝내 아니면 던진다 */
  async ensureHome(password: string): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await this.unlock(password);
      if (await this.isWalletHome(6000)) return;
      await this.open();
      await this.settle(15_000);
    }
    throw new Error("MetaMask가 지갑 화면으로 가지 않습니다 — «지갑 다시 준비»로 프로필을 지우거나 MetaMask 판을 확인하세요");
  }

  async #acceptTerms(): Promise<boolean> {
    const p = this.page;
    const box = p.locator('[data-testid="terms-of-use-checkbox"]');
    if (!(await box.first().isVisible({ timeout: 4000 }).catch(() => false))) return false;
    const scroll = p.locator('[data-testid="terms-of-use-scroll-button"]');
    for (let i = 0; i < 8; i++) { if (!(await this.#clickIfVisible(scroll, 700))) break; await p.waitForTimeout(400); }
    await box.first().click({ force: true });
    const agree = p.locator('[data-testid="terms-of-use-agree-button"]');
    await this.#waitEnabled(agree, 8000, "이용약관 동의");
    await agree.first().click();
    await p.waitForTimeout(1500);
    return true;
  }

  async #typePhrase(words: string[]): Promise<void> {
    const p = this.page;
    const note = p.locator('#first-word-input-text-area, [data-testid="srp-input-import__srp-note"]');
    await note.first().waitFor({ state: "visible", timeout: 10_000 });
    await note.first().click();
    for (let i = 0; i < words.length; i++) {
      await p.keyboard.type(words[i]!, { delay: 30 });
      if (i === words.length - 1) break;   // ★끝 단어 뒤에 스페이스를 치면 빈 칸이 남아 확인이 꺼진다
      await p.keyboard.press("Space");
      await p.locator(`[data-testid="import-srp__srp-word-${i + 1}"]`).waitFor({ state: "visible", timeout: 8000 });
      await p.waitForTimeout(120);
    }
    const confirm = p.locator('[data-testid="import-srp-confirm"]');
    await confirm.waitFor({ state: "visible", timeout: 10_000 });
    await this.#waitEnabled(confirm, 15_000, "복구 문구 확인");
    await confirm.click();
    await p.waitForTimeout(2500);
  }

  async #createPassword(password: string): Promise<void> {
    const p = this.page;
    const first = p.locator('[data-testid="create-password-new-input"], [data-testid="create-password-new"]');
    await first.first().waitFor({ state: "visible", timeout: 20_000 });
    await first.first().fill(password);
    await p.locator('[data-testid="create-password-confirm-input"], [data-testid="create-password-confirm"]').first().fill(password);
    await this.#clickIfVisible(p.locator('[data-testid="create-password-terms"]'), 3000);
    const submit = p.locator('[data-testid="create-password-submit"], [data-testid="create-password-import"]');
    await submit.first().waitFor({ state: "visible", timeout: 10_000 });
    await this.#waitEnabled(submit, 10_000, "비밀번호 만들기");
    await submit.first().click();
    await p.waitForTimeout(3000);
  }

  async #dismissMetrics(): Promise<boolean> {
    return this.#clickIfVisible(this.page.locator('[data-testid="metametrics-no-thanks"], [data-testid="onboarding-metametrics-no-thanks"], button:has-text("No thanks"), button:has-text("동의하지 않음")'), 3000);
  }

  /** 온보딩 끝의 화면들(사용 데이터 · 패스키 · 고정 · 완료)은 차례가 바뀐다 — 보이는 것을 넘긴다 */
  async #settleScreens(maxSteps: number, allowComplete: boolean, password: string): Promise<void> {
    const p = this.page;
    const stop = p.locator([HOME, ...(allowComplete ? [] : ['[data-testid="manage-default-settings"]'])].join(", "));
    const advance = [
      ...(allowComplete ? ['[data-testid="onboarding-complete-done"]'] : []),
      '[data-testid="metametrics-no-thanks"]', '[data-testid="metametrics-i-agree"]', '[data-testid="passkey-maybe-later-button"]',
      '[data-testid="pin-extension-next"]', '[data-testid="pin-extension-done"]',
      'button:has-text("No thanks"), button:has-text("동의하지 않음")', 'button:has-text("Maybe later"), button:has-text("나중에")',
      'button:has-text("Not right now"), button:has-text("지금은 안 함")', 'button:has-text("Got it"), button:has-text("확인했습니다")',
      'button:has-text("Continue"), button:has-text("계속")',
    ];
    // 눌러도 넘어가지 않는 단추는 다시 누르지 않는다(끝 화면에 남아 있는 단추)
    const spent = new Set<string>();
    for (let step = 0; step < maxSteps; step++) {
      if (await stop.first().isVisible({ timeout: 1500 }).catch(() => false)) return;
      // 금고를 만든 직후 잠금 화면으로 튀어 돌아갈 때가 있다 — 바로 푼다
      if (await this.#unlockOnce(password)) continue;
      let moved = false;
      for (const s of advance) {
        if (spent.has(s)) continue;
        const before = p.url();
        if (await this.#clickIfVisible(p.locator(s), 600)) {
          await p.waitForTimeout(1500);
          if (p.url() === before) spent.add(s);
          moved = true;
          break;
        }
      }
      if (!moved) await p.waitForTimeout(1200);
    }
    await p.goto(this.homeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await p.waitForTimeout(2500);
  }

  /** «기본 기능» 끄기 — 미리 깔린 스냅이 돌지 않게(온보딩 끝 화면의 «기본 설정 관리»에서) */
  async #disableBasicFunctionality(): Promise<void> {
    const p = this.page;
    const manage = p.locator('[data-testid="manage-default-settings"]');
    if (!(await manage.first().isVisible({ timeout: 6000 }).catch(() => false))) { this.#log("MetaMask: «기본 설정 관리»가 없어 기본 기능 끄기를 건너뜁니다"); return; }
    await manage.first().click();
    const first = p.locator('[data-testid^="category-item-"]').first();
    await first.waitFor({ state: "visible", timeout: 10_000 });
    await first.click();
    const toggle = p.locator('[data-testid="basic-functionality-toggle"] input').first();
    await toggle.waitFor({ state: "visible", timeout: 10_000 });
    if (await toggle.isChecked()) {
      await toggle.click({ force: true });
      const ack = p.locator('[data-testid="basic-configuration-checkbox"]').first();
      await ack.waitFor({ state: "visible", timeout: 8000 });
      await ack.click({ force: true });
      const ok = p.locator('[data-testid="basic-configuration-modal-toggle-button"]').first();
      await ok.waitFor({ state: "visible", timeout: 8000 });
      await this.#waitEnabled(ok, 8000, "기본 기능 끄기");
      await ok.click();
      await ok.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
    }
    const off = !(await toggle.isChecked().catch(() => true));
    await this.#clickIfVisible(p.locator('[data-testid="category-back-button"]'), 5000);
    await p.waitForTimeout(1000);
    await this.#clickIfVisible(p.locator('[data-testid="privacy-settings-back-button"]'), 5000);
    await p.waitForTimeout(1500);
    this.#log(off ? "MetaMask: 기본 기능을 껐습니다(미리 깔린 스냅이 돌지 않게)" : "MetaMask: 기본 기능이 아직 켜져 있습니다 — 확장 화면이 느려질 수 있습니다");
  }

  // ─── 잠금 ───────────────────────────────────────────────────────

  /** 잠겨 있으면 푼다 — 풀었으면 true */
  async unlock(password: string): Promise<boolean> {
    if (!(await this.#unlockOnce(password))) return false;
    await this.#settleScreens(4, true, password);
    return true;
  }

  async #unlockOnce(password: string): Promise<boolean> {
    const p = this.page;
    const btn = p.locator('button[data-testid="unlock-submit"]');
    if (!(await btn.isVisible({ timeout: 2500 }).catch(() => false))) return false;
    const input = p.locator('input[data-testid="unlock-password"], input#password').first();
    await input.waitFor({ state: "visible", timeout: 8000 });
    await input.fill(password);
    // 그려지는 중에 넣으면 값이 빠질 때가 있다 — 들어갔나 본다
    if ((await input.inputValue().catch(() => "")) !== password) { await input.click(); await input.pressSequentially(password, { delay: 20 }); }
    await this.#waitEnabled(btn, 8000, "잠금 풀기");
    await btn.click();
    await p.waitForTimeout(2500);
    return true;
  }

  // ─── 막는 창 · 계정 ───────────────────────────────────────────────

  /**
   * 지갑 화면 위에 뜨는 창(«새로운 기능» · 설문)을 닫는다 — 계정 단추를 가로챈다.
   * ★`.mm-modal` 껍데기는 크기가 0이라 «안 보임»으로 나온다 — 실제로 덮는 `[role=dialog]` · `.mm-modal-content`로 본다.
   * ★`isVisible`은 기다리지 않는다 — 지갑 화면이 자리 잡은 뒤 뜨는 창은 `waitFor`로 기다린다
   */
  async dismissModals(rounds = 6): Promise<boolean> {
    const p = this.page;
    const modal = p.locator('[role="dialog"], .mm-modal-content, [data-testid="whats-new-modal"]').filter({ visible: true }).first();
    const closers = [
      '[data-testid="not-now-button"]', '[data-testid="modal-header-close-button"]', '[data-testid="popover-close"]', '[data-testid="update-modal-close-button"]',
      '.mm-modal button[aria-label="Close"], .mm-modal button[aria-label="닫기"]',
      'button:has-text("Got it"), button:has-text("확인했습니다")', 'button:has-text("Not now"), button:has-text("나중에")',
    ];
    await modal.waitFor({ state: "visible", timeout: 6000 }).catch(() => undefined);
    for (let r = 0; r < rounds; r++) {
      if (!(await modal.isVisible().catch(() => false))) return true;
      for (const s of closers) {
        const t = p.locator(s).filter({ visible: true }).first();
        if (!(await t.isVisible().catch(() => false))) continue;
        await t.click({ timeout: 3000 }).catch(() => undefined);
        // 눌러도 안 닫히는 단추는 넘어간다
        if (await modal.isHidden({ timeout: 2000 }).catch(() => false)) return true;
      }
      for (const layer of [".mm-modal-content", ".mm-modal-overlay"]) {
        await p.locator(layer).first().click({ force: true, position: { x: 5, y: 5 }, timeout: 2000 }).catch(() => undefined);
        if (await modal.isHidden({ timeout: 1000 }).catch(() => false)) return true;
      }
      await p.keyboard.press("Escape").catch(() => undefined);
      await p.waitForTimeout(800);
    }
    return !(await modal.isVisible().catch(() => false));
  }

  /** 개인키로 계정을 불러온다(그 계정이 골라진다) */
  async importPrivateKey(key: string): Promise<void> {
    const p = this.page;
    await this.open();
    await p.waitForTimeout(1500);
    await this.dismissModals();
    const menu = p.locator('button[data-testid="account-menu-icon"]');
    await menu.waitFor({ state: "visible", timeout: 15_000 });
    let opened = false;
    for (let i = 0; i < 3 && !opened; i++) {
      await this.dismissModals();
      opened = await menu.click({ timeout: 8000 }).then(() => true, () => false);
    }
    if (!opened) throw new Error("MetaMask 계정 목록을 열지 못했습니다 — 무엇인가 계정 단추를 덮고 있습니다");
    await p.waitForTimeout(1000);
    const add = p.locator('[data-testid="account-list-add-wallet-button"], [data-testid="multichain-account-menu-popover-action-button"], button:has-text("Add wallet"), button:has-text("지갑 추가"), button:has-text("Add account"), button:has-text("계정 또는 하드웨어 지갑 추가")');
    await add.first().waitFor({ state: "visible", timeout: 10_000 });
    await this.#waitEnabled(add, 45_000, "지갑 추가");   // 13.x는 계정 목록이 정리될 때까지(동기화 중) 꺼 둔다
    await add.first().click();
    await p.waitForTimeout(1000);
    await this.#clickIfVisible(p.locator('[data-testid="import-account"], [data-testid="multichain-account-menu-popover-add-imported-account"], button:has-text("Import an account"), button:has-text("계정 가져오기"), button:has-text("Import account")'), 8000);
    await p.waitForTimeout(1000);
    const box = p.locator("input#private-key-box, #private-key-box input, #private-key-box");
    await box.first().waitFor({ state: "visible", timeout: 10_000 });
    await box.first().fill(key);
    const ok = p.locator('[data-testid="import-account-confirm-button"], button:has-text("Import"), button:has-text("가져오기")');
    await ok.first().waitFor({ state: "visible", timeout: 8000 });
    await this.#waitEnabled(ok, 8000, "계정 가져오기");
    await ok.first().click();
    await p.waitForTimeout(2500);
    this.#log("MetaMask: 개인키 계정을 불러왔습니다");
  }
}
