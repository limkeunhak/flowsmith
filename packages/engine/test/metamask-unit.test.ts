/**
 * 지갑 브라우저의 브라우저 없는 부분 — Windows 경로 길이 · 지갑 지문 · 주소 · 승인 화면 읽기(PLAN §44).
 */
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { addressOf, profilePathProblem, readScreen, walletFingerprint } from "../src/index.ts";
import { approveUntil } from "../src/browser/metamask/approve.ts";

const HARDHAT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PHRASE = "test test test test test test test test test test test junk";

describe("Windows 경로 길이", () => {
  it("★짧은 뿌리는 된다 · 긴 뿌리는 이유와 함께 — 리눅스 · 맥은 보지 않는다", () => {
    expect(profilePathProblem("C:\\Users\\kim\\AppData\\Local\\Flowsmith\\w", "win32")).toBeNull();
    const long = `C:\\Users\\limke\\AppData\\Local\\Temp\\claude\\${"x".repeat(60)}\\scratchpad\\p0\\wta\\out\\cache-profiles`;
    expect(profilePathProblem(long, "win32")).toMatch(/260자 제한.*FLOWSMITH_WALLET_DIR/);
    expect(profilePathProblem(long, "linux")).toBeNull();
  });
});

describe("지갑 지문 · 주소", () => {
  it("지문은 키마다 같고(0x · 대소문자 무관) 키 자체는 담지 않는다", () => {
    expect(walletFingerprint(HARDHAT_KEY)).toBe(walletFingerprint(HARDHAT_KEY.slice(2).toUpperCase()));
    expect(walletFingerprint(HARDHAT_KEY)).toMatch(/^[0-9a-f]{10}$/);
    expect(HARDHAT_KEY).not.toContain(walletFingerprint(HARDHAT_KEY));
  });
  it("주소 — 개인키 · 복구 문구(첫 계정)", () => {
    expect(addressOf(HARDHAT_KEY)).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(addressOf(` ${PHRASE} `)).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });
});

/** MetaMask 화면 흉내 — 주소와 글자만 */
const fake = (url: string, text: string) => ({ url: () => url, locator: () => ({ innerText: async () => text }) }) as unknown as Page;
const chains = [{ chainId: 68414, name: "Henesys", rpcUrl: "", allowTx: false }];

describe("승인 화면 읽기", () => {
  const base = "chrome-extension://abc/notification.html";
  it("★연결 · 서명 · 거래 — 주소 뒤(#)로", async () => {
    expect(await readScreen(fake(`${base}#connect/xyz`, "Connect with MetaMask"), chains, 1)).toEqual({ kind: "connect" });
    expect(await readScreen(fake(`${base}#confirm-transaction/123/signature-request`, "Welcome to MapleStory Universe!\n Nonce: 42"), chains, 1))
      .toEqual({ kind: "signature", text: "Welcome to MapleStory Universe! Nonce: 42" });
    expect(await readScreen(fake(`${base}#confirm-transaction/123`, "Send 1 NXPC"), chains, 68414)).toEqual({ kind: "transaction", chainId: 68414 });
  });
  it("★체인 추가 · 바꾸기 — 글자 속의 체인 id · 이름으로", async () => {
    expect(await readScreen(fake(`${base}#confirmation/q1`, "Add network\nNetwork name Henesys\nChain ID 68414"), chains, 1)).toEqual({ kind: "addChain", chainId: 68414 });
    expect(await readScreen(fake(`${base}#confirmation/q1`, "Switch network to Henesys"), chains, 1)).toEqual({ kind: "switchChain", chainId: 68414 });
    expect(await readScreen(fake(`${base}#confirmation/q2`, "Add network\nChain ID 99999"), chains, 1)).toEqual({ kind: "addChain", chainId: 99999 });
  });
  it("모르는 화면", async () => {
    expect(await readScreen(fake(`${base}#confirmation/q3`, "Install snap"), chains, 1)).toMatchObject({ kind: "unknown" });
    expect(await readScreen(fake(`${base}#snap-install/1`, "Install"), chains, 1)).toEqual({ kind: "unknown", hint: "snap-install" });
  });
});

describe("승인을 적어도 몇 개 — 지갑이 꼭 불려야 하는 자리", () => {
  // 승인 화면이 하나도 오지 않는 지갑 브라우저 · 끝 표시는 처음부터 맞다(누른 단추가 처리 중으로 바뀐 것처럼)
  const base = { context: { pages: () => [] } as never, dapp: { evaluate: async () => "0x1" } as never, wallet: { mode: "metamask", secret: "k", announceAs: "MetaMask", chains: [], defaultChainId: 1 } as never, log: () => undefined, done: async () => true };
  it("없으면 끝 표시를 곧바로 믿는다", async () => {
    expect(await approveUntil({ ...base, timeoutMs: 1_000 })).toEqual([]);
  });
  it("★있으면 승인 화면이 오기 전의 끝 표시를 믿지 않고, 시간이 다 되면 «지갑을 부르지 않았다»로 멈춘다", async () => {
    await expect(approveUntil({ ...base, timeoutMs: 1_000, atLeast: 1 })).rejects.toThrow(/0개만 승인했습니다\(적어도 1개\) — 사이트가 지갑을 부르지 않았습니다/);
  });
});
