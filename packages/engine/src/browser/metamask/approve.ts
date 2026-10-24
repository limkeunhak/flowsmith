/**
 * **MetaMask 승인** — 확장 화면을 읽고(readScreen) 누를 만한 것만(core approvalDecision) 누른다.
 *
 * ★사이트의 일은 화면 하나가 아니다 — msu.io 로그인은 연결 · 연결(권한) · 서명 세 번이다. MetaMask는 그것을 새 알림 창에
 *  띄우기도, 이미 열린 확장 탭 안에 그리기도 한다. 그래서 «어느 화면이 어디에 올지» 기다리지 않고, 확인 단추가 보이는
 *  모든 `chrome-extension://` 화면을 훑어 누르다가 끝 표시(done)가 오면 멈춘다(webtest-automation approveAllPrompts).
 * ★누르기 전에 화면 종류를 읽는다 — 모르는 화면 · 목록 밖 체인 · 거래 허용이 꺼진 거래는 누르지 않고 이유와 함께 멈춘다.
 */
import type { BrowserContext, Page } from "playwright";
import { approvalDecision, type MetaMaskScreen, type WalletChain, type WalletSettings } from "@flowsmith/core";
import type { Log } from "./ui.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 승인 화면의 확인 단추 — 연결 · 서명 · 체인 · 거래가 함께 쓰는 testid들 */
const CONFIRM = '[data-testid="confirm-footer-button"], [data-testid="confirmation-submit-button"], [data-testid="confirm-btn"], [data-testid="page-container-footer-next"]';

const SCREEN_LABEL: Record<MetaMaskScreen["kind"], string> = { connect: "연결", signature: "서명", addChain: "체인 추가", switchChain: "체인 바꾸기", transaction: "거래", unknown: "모르는 화면" };

/** 화면 글자에서 체인 — 목록의 체인 id(10진 · 16진)나 이름이 보이면 그 체인 */
function chainIn(text: string, chains: readonly WalletChain[]): number | null {
  for (const c of chains) {
    const hex = `0x${c.chainId.toString(16)}`;
    if (new RegExp(`(^|\\D)${c.chainId}(\\D|$)`).test(text) || text.toLowerCase().includes(hex) || (c.name && text.includes(c.name))) return c.chainId;
  }
  const m = /chain\s*id[^0-9a-fx]*(0x[0-9a-f]+|\d+)/i.exec(text);
  if (!m) return null;
  const n = m[1]!.startsWith("0x") ? parseInt(m[1]!, 16) : Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** 이 MetaMask 화면은 무엇인가 — 주소 뒤(#)로 가르고, 체인은 글자에서 */
export async function readScreen(page: Page, chains: readonly WalletChain[], currentChainId: number | null): Promise<MetaMaskScreen> {
  const hash = new URL(page.url()).hash.replace(/^#\/?/, "");
  const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  if (hash.startsWith("connect/")) return { kind: "connect" };
  if (hash.startsWith("confirm-transaction/") && /signature/.test(hash)) return { kind: "signature", text: text.replace(/\s+/g, " ").trim().slice(0, 400) };
  if (hash.startsWith("confirmation/")) {
    // 체인 추가와 전환은 같은 주소 · 같은 단추를 두 번 쓴다(처음 «추가», 다음 «전환»)
    const kind = /switch network|네트워크 전환|switch to/i.test(text) && !/add network|adding network|네트워크 추가/i.test(text) ? "switchChain" : /network|네트워크|chain|체인/i.test(text) ? "addChain" : null;
    if (kind) return { kind, chainId: chainIn(text, chains) };
    return { kind: "unknown", hint: `confirmation — ${text.replace(/\s+/g, " ").slice(0, 80)}` };
  }
  if (hash.startsWith("confirm-transaction/")) return { kind: "transaction", chainId: currentChainId };
  return { kind: "unknown", hint: hash.split("/")[0] || "(주소 없음)" };
}

/** dApp 페이지의 지금 체인(window.ethereum.chainId) — 없으면 null */
export async function chainIdOf(page: Page): Promise<number | null> {
  const hex = await page.evaluate(() => (globalThis as any).ethereum?.chainId as string | undefined).catch(() => undefined);
  return typeof hex === "string" ? parseInt(hex, 16) : null;
}

export interface ApproveOptions {
  context: BrowserContext;
  /** 사이트 페이지 — 지금 체인을 묻는다 */
  dapp: Page;
  wallet: Pick<WalletSettings, "chains">;
  /** 끝났다는 표시가 왔나 */
  done: () => Promise<boolean>;
  timeoutMs: number;
  probe?: boolean;
  signal?: AbortSignal;
  log: Log;
}

/** 끝 표시가 올 때까지 MetaMask 화면을 누른다 — 누른 화면들을 돌려준다. 누르면 안 되는 화면 · 시간 초과는 던진다 */
export async function approveUntil(o: ApproveOptions): Promise<MetaMaskScreen[]> {
  const deadline = Date.now() + o.timeoutMs;
  const approved: MetaMaskScreen[] = [];
  let seen = "";
  // 같은 화면(주소 · 단추 글자)을 몇 번 눌렀나 — 눌러도 넘어가지 않으면 헛돌지 않고 멈춘다
  const pressed = new Map<string, number>();
  while (Date.now() < deadline) {
    if (o.signal?.aborted) throw new Error("멈췄습니다");
    if (await o.done().catch(() => false)) return approved;
    let acted = false;
    for (const page of o.context.pages()) {
      if (page.isClosed() || !page.url().startsWith("chrome-extension://")) continue;
      const button = page.locator(CONFIRM).filter({ visible: true }).first();
      if (!(await button.isVisible().catch(() => false))) continue;
      const screen = await readScreen(page, o.wallet.chains, await chainIdOf(o.dapp));
      seen = SCREEN_LABEL[screen.kind];
      const d = approvalDecision(screen, o.wallet, { probe: o.probe ?? false });
      // ★누르지 않는다 — 화면은 그대로 두고(사람이 볼 수 있게) 이유와 함께 멈춘다
      if (!d.approve) throw new Error(`MetaMask ${SCREEN_LABEL[screen.kind]} 화면을 승인하지 않았습니다 — ${d.reason}`);
      const label = (await button.innerText().catch(() => "")).trim();
      const key = `${page.url()}\0${label}`;
      const times = (pressed.get(key) ?? 0) + 1;
      pressed.set(key, times);
      if (times > 3) {
        const text = (await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        throw new Error(`MetaMask ${SCREEN_LABEL[screen.kind]} 화면이 «${label}»을(를) 눌러도 넘어가지 않습니다 — «${text}»`);
      }
      // MetaMask는 값을 확인하는 동안 단추를 꺼 둔다
      const end = Date.now() + 8000;
      while (Date.now() < end && !(await button.isEnabled().catch(() => false))) await sleep(250);
      const extra = screen.kind === "signature" ? ` — 서명한 글: «${screen.text.slice(0, 200)}»` : "chainId" in screen && screen.chainId !== null ? ` — 체인 ${screen.chainId}` : "";
      o.log(`MetaMask: ${SCREEN_LABEL[screen.kind]} 승인${extra}`);
      await button.click({ timeout: 5000 }).catch(() => undefined);
      approved.push(screen);
      acted = true;
      await sleep(2500);
      break;
    }
    if (!acted) await sleep(800);
  }
  if (await o.done().catch(() => false)) return approved;
  const did = approved.length ? `승인한 화면: ${approved.map((s) => SCREEN_LABEL[s.kind]).join(" → ")}` : "승인할 MetaMask 화면이 오지 않았습니다";
  throw new Error(`MetaMask 승인을 ${Math.round(o.timeoutMs / 1000)}초 기다렸지만 끝났다는 표시가 오지 않았습니다 — ${did}${seen ? ` · 마지막 화면: ${seen}` : ""}. 지갑에 그 사이트의 계정이 있는지, 끝 표시가 맞는지 보세요`);
}

/**
 * 워크플로우의 처음 체인으로 — 사이트 페이지에서 wallet_addEthereumChain(RPC가 있으면) · wallet_switchEthereumChain을
 * 부르고 그 승인을 누른다. 이미 그 체인이면 아무것도 안 한다
 */
export async function ensureChain(o: Omit<ApproveOptions, "done" | "timeoutMs"> & { wallet: Pick<WalletSettings, "chains" | "defaultChainId"> }): Promise<void> {
  const chains = o.wallet.chains;
  if (chains.length === 0) return;
  const target = chains.find((c) => c.chainId === o.wallet.defaultChainId) ?? chains[0]!;
  const hex = `0x${target.chainId.toString(16)}`;
  const injected = await o.dapp.waitForFunction(() => typeof (globalThis as any).ethereum !== "undefined", null, { timeout: 10_000 }).then(() => true, () => false);
  if (!injected) { o.log("MetaMask: 이 페이지에 지갑(window.ethereum)이 없어 체인을 맞추지 않았습니다"); return; }
  if ((await chainIdOf(o.dapp)) === target.chainId) return;
  // 승인이 끝나야 답이 오니 기다리지 않는다
  void o.dapp.evaluate(({ hex, name, rpcUrl, symbol }) => {
    const eth = (globalThis as any).ethereum;
    return rpcUrl
      ? eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: name, rpcUrls: [rpcUrl], nativeCurrency: { name: symbol, symbol, decimals: 18 } }] })
      : eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  }, { hex, name: target.name, rpcUrl: target.rpcUrl, symbol: target.symbol ?? "ETH" }).catch(() => undefined);
  await approveUntil({ ...o, done: async () => (await chainIdOf(o.dapp)) === target.chainId, timeoutMs: 45_000 });
  o.log(`MetaMask: 체인을 «${target.name}»(${target.chainId})로 맞췄습니다`);
}
