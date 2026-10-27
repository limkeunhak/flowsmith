/**
 * 테스트 지갑(2026-10-19, PLAN §40) — 페이지에 지갑을 넣고 서버가 개인키로 처리한다.
 *   사이트가 MetaMask로 본다(EIP-6963) · 계정 연결 · 로그인 서명(personal_sign) · EIP-712 · 거래(허용한 체인만) · 없는 체인 거절 · 키는 페이지에 없다
 * ★가짜 QA 체인(JSON-RPC)과 가짜 dApp으로 — 서명은 viem으로 검증한다.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { keccak256, parseTransaction, recoverTransactionAddress, verifyMessage, verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseFlow } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";

const KEY = generatePrivateKey();
const ADDRESS = privateKeyToAccount(KEY).address;
const QA_CHAIN = 31337;
const sent: Hex[] = [];
let dapp: Server;
let chain: Server;
let dappUrl: string;
let rpcUrl: string;
let browser: Browser;

const TYPED = { domain: { name: "QA Market", version: "1", chainId: QA_CHAIN }, types: { Login: [{ name: "nonce", type: "uint256" }, { name: "who", type: "address" }] }, primaryType: "Login" };
// 버튼마다 지갑을 부르고, 답을 새 요소로 붙인다(읽기가 그 요소를 기다린다)
const DAPP = `<!doctype html><meta charset="utf-8"><h1>QA 마켓</h1>
<button id="connect">지갑 연결</button><button id="sign">로그인 서명</button><button id="typed">구조화 서명</button>
<button id="buy">구매</button><button id="switch">메인넷으로</button><div id="out"></div>
<script>
  const wallets = [];
  window.addEventListener("eip6963:announceProvider", (e) => wallets.push(e.detail.info.name + "|" + e.detail.info.rdns));
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const put = (id, v) => { const b = document.createElement("b"); b.id = id; b.textContent = v; document.getElementById("out").append(b); };
  setTimeout(() => put("wallets", wallets.join(",") + " meta=" + window.ethereum.isMetaMask), 50);
  let me = null;
  const run = (id, f) => document.getElementById(id).onclick = async () => { try { put(id + "-ok", await f()); } catch (e) { put(id + "-err", e.code + " " + e.message); } };
  run("connect", async () => (me = (await ethereum.request({ method: "eth_requestAccounts" }))[0]));
  run("sign", async () => ethereum.request({ method: "personal_sign", params: ["0x" + [...new TextEncoder().encode("QA 마켓 로그인 nonce=42")].map((b) => b.toString(16).padStart(2, "0")).join(""), me] }));
  run("typed", async () => ethereum.request({ method: "eth_signTypedData_v4", params: [me, JSON.stringify({ ...${JSON.stringify(TYPED)}, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }], ...${JSON.stringify(TYPED.types)} }, message: { nonce: 7, who: me } })] }));
  run("buy", async () => ethereum.request({ method: "eth_sendTransaction", params: [{ from: me, to: "0x000000000000000000000000000000000000dEaD", value: "0x2386f26fc10000" }] }));
  run("switch", async () => ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }));
</script>`;

/** 가짜 QA 체인 — viem이 거래를 만들며 묻는 것만 답하고, 받은 거래를 모은다 */
function rpc(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId": return `0x${QA_CHAIN.toString(16)}`;
    case "eth_getTransactionCount": return "0x0";
    case "eth_gasPrice": return "0x3b9aca00";
    case "eth_maxPriorityFeePerGas": return "0x3b9aca00";
    case "eth_estimateGas": return "0x5208";
    case "eth_blockNumber": return "0x10";
    case "eth_getBlockByNumber": return { number: "0x10", baseFeePerGas: "0x3b9aca00", timestamp: "0x1", hash: `0x${"ab".repeat(32)}`, transactions: [] };
    case "eth_getBalance": return "0xde0b6b3a7640000";
    case "eth_sendRawTransaction": { const raw = params[0] as Hex; sent.push(raw); return keccak256(raw); }
    default: throw new Error(`모르는 ${method}`);
  }
}

const flowWith = (allowTx: boolean) => parseFlow({
  schemaVersion: 1, id: "w", name: "w", settings: { defaultTimeoutMs: 5000, wallet: { secret: "qa", announceAs: "MetaMask", defaultChainId: QA_CHAIN, chains: [{ chainId: QA_CHAIN, name: "QA", rpcUrl, allowTx }] } },
  secrets: [{ name: "qa", kind: "text", description: "테스트 지갑 개인키" }],
  nodes: [{ id: "n", type: "web", name: "마켓", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: dappUrl }, actions: [
    ["wallets", null], ["connect", "connect-ok"], ["sign", "sign-ok"], ["typed", "typed-ok"], ["buy", allowTx ? "buy-ok" : "buy-err"], ["switch", "switch-err"],
  ].flatMap(([btn, out], i) => [
    ...(out ? [{ id: `c${i}`, kind: "click", target: { label: btn, locators: [{ kind: "css", value: `#${btn}` }], fingerprint: null, frames: [], verifiedAt: null }, popup: false }] : []),
    { id: `r${i}`, kind: "read", output: (out ?? btn)!.replace(/-/g, "_"), target: { label: out ?? btn, locators: [{ kind: "css", value: `#${out ?? btn}` }], fingerprint: null, frames: [], verifiedAt: null } },
  ]) } }],
  edges: [],
});

beforeAll(async () => {
  dapp = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(DAPP); });
  chain = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const calls = JSON.parse(body);
    const one = (c: { id: number; method: string; params: unknown[] }) => { try { return { jsonrpc: "2.0", id: c.id, result: rpc(c.method, c.params) }; } catch (e) { return { jsonrpc: "2.0", id: c.id, error: { code: -32601, message: (e as Error).message } }; } };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(Array.isArray(calls) ? calls.map(one) : one(calls)));
  });
  await new Promise<void>((r) => dapp.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => chain.listen(0, "127.0.0.1", r));
  dappUrl = `http://127.0.0.1:${(dapp.address() as AddressInfo).port}`;
  rpcUrl = `http://127.0.0.1:${(chain.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => dapp?.close(r));
  await new Promise((r) => chain?.close(r));
});

describe("테스트 지갑", () => {
  it("★사이트가 MetaMask로 본다 · 계정 연결 · 로그인 서명 · EIP-712 · 거래(허용한 QA 체인) · 없는 체인은 거절", async () => {
    const r = await runFlow(flowWith(true), { browser, secrets: { qa: KEY } });
    expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
    const o = r.output as Record<string, string>;
    expect(o["wallets"]).toBe("MetaMask|io.metamask meta=true");
    expect(o["connect_ok"]).toBe(ADDRESS);
    expect(await verifyMessage({ address: ADDRESS, message: "QA 마켓 로그인 nonce=42", signature: o["sign_ok"] as Hex })).toBe(true);
    expect(await verifyTypedData({ address: ADDRESS, ...TYPED, message: { nonce: 7n, who: ADDRESS }, signature: o["typed_ok"] as Hex } as never)).toBe(true);
    // 거래 — 서명돼 RPC로 갔고, 보낸 사람이 테스트 지갑
    expect(sent).toHaveLength(1);
    const tx = parseTransaction(sent[0]!);
    expect(tx).toMatchObject({ value: 10_000_000_000_000_000n, chainId: QA_CHAIN });
    expect(tx.to!.toLowerCase()).toBe("0x000000000000000000000000000000000000dead");
    expect(await recoverTransactionAddress({ serializedTransaction: sent[0]! as never })).toBe(ADDRESS);
    expect(o["buy_ok"]).toBe(keccak256(sent[0]!));
    expect(o["switch_err"]).toMatch(/^4902 체인 1은\(는\) 지갑 설정에 없습니다/);
    // 기록 — 지갑이 한 일 · ★키는 어디에도 없다
    const logs = r.nodes[0]!.logs.join("\n");
    expect(logs).toMatch(/지갑: 계정 연결/);
    expect(logs).toMatch(/지갑: 서명\(personal_sign\) — «QA 마켓 로그인 nonce=42»/);
    expect(logs).toMatch(/지갑: 거래 보냄 — QA/);
    expect(JSON.stringify(r)).not.toContain(KEY.slice(2));
  }, 60_000);

  it("★거래를 허용하지 않은 체인 — 거절(4100)하고 보내지 않는다 · 점검도 보내지 않는다", async () => {
    const before = sent.length;
    const r = await runFlow(flowWith(false), { browser, secrets: { qa: KEY } });
    expect(r.status).toBe("success");
    expect((r.output as Record<string, string>)["buy_err"]).toMatch(/^4100 거래 전송은 «거래 허용»을 켠 체인에서만 합니다/);
    expect(sent).toHaveLength(before);
  }, 60_000);

  it("검문소 — 개인키 시크릿(글자) · 사람의 크롬에는 넣지 않는다 · 체인", () => {
    const base = (wallet: unknown, more: Record<string, unknown> = {}) => () => parseFlow({ schemaVersion: 1, id: "x", name: "x", settings: { wallet, ...more }, secrets: [{ name: "qa", kind: "text" }],
      nodes: [{ id: "c", type: "custom", name: "c", position: { x: 0, y: 0 }, config: { code: "return {};", outputs: [] } }], edges: [] });
    const ok = { secret: "qa", defaultChainId: 5, chains: [{ chainId: 5, name: "QA", rpcUrl: "", allowTx: false }] };
    expect(base(ok)).not.toThrow();
    expect(base({ ...ok, secret: "없음" })).toThrow(/시크릿 "없음"이\(가\) 정의되지 않았습니다/);
    expect(base(ok, { browser: "attach" })).toThrow(/사람의 크롬에 붙는 워크플로우에는 넣지 않습니다/);
    expect(base({ ...ok, chains: [{ chainId: 5, name: "QA", rpcUrl: "", allowTx: true }] })).toThrow(/RPC 주소가 있어야/);
    expect(base({ ...ok, defaultChainId: 9 })).toThrow(/처음 체인 9/);
  });
});

describe("실행마다 지갑을 고른다 — 두 지갑이 차례를 주고받는 거래(판매자 · 구매자)", () => {
  const KEY_B = generatePrivateKey();
  const pick = (secret: string, param: Record<string, unknown> = { name: "wallet", label: "지갑", type: "select", options: ["qa", "qa_b"], default: "qa" }) => parseFlow({
    schemaVersion: 1, id: "p", name: "p", params: [param],
    settings: { defaultTimeoutMs: 5000, wallet: { secret, announceAs: "MetaMask", defaultChainId: QA_CHAIN, chains: [{ chainId: QA_CHAIN, name: "QA", rpcUrl, allowTx: false }] } },
    secrets: [{ name: "qa", kind: "text" }, { name: "qa_b", kind: "text" }],
    nodes: [{ id: "n", type: "web", name: "마켓", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: dappUrl }, actions: [
      { id: "c", kind: "click", target: { label: "연결", locators: [{ kind: "css", value: "#connect" }], fingerprint: null, frames: [], verifiedAt: null }, popup: false },
      { id: "r", kind: "read", output: "me", target: { label: "주소", locators: [{ kind: "css", value: "#connect-ok" }], fingerprint: null, frames: [], verifiedAt: null } },
    ] } }],
    edges: [],
  });

  it("★실행 입력이 고른 시크릿의 키로 · 입력이 없으면 기본값", async () => {
    const f = pick("{{ $params.wallet }}");
    const b = await runFlow(f, { browser, params: { wallet: "qa_b" }, secrets: { qa: KEY, qa_b: KEY_B } });
    expect(b.status, JSON.stringify(b.nodes[0]!.failure)).toBe("success");
    expect((b.output as Record<string, string>)["me"]).toBe(privateKeyToAccount(KEY_B).address);
    const a = await runFlow(f, { browser, secrets: { qa: KEY, qa_b: KEY_B } });
    expect((a.output as Record<string, string>)["me"]).toBe(ADDRESS);
  }, 60_000);

  it("검문소 — 고르는 입력은 «고르기» · 보기마다 글자 시크릿 · 보기 밖 값은 실행 전에 멈춘다", async () => {
    expect(() => pick("{{ $params.nope }}")).toThrow(/실행 입력 "nope"이\(가\) 정의되지 않았습니다/);
    expect(() => pick("{{ $params.wallet }}", { name: "wallet", label: "지갑", type: "text" })).toThrow(/«고르기» 종류여야/);
    expect(() => pick("{{ $params.wallet }}", { name: "wallet", label: "지갑", type: "select", options: ["qa", "mainnet"] })).toThrow(/시크릿 "mainnet"이\(가\) 정의되지 않았습니다/);
    // 보기 밖 값은 입력 검사가 막는다 — 다른 시크릿을 끌어오지 못한다
    await expect(runFlow(pick("{{ $params.wallet }}"), { browser, params: { wallet: "other" }, secrets: { qa: KEY, qa_b: KEY_B } })).rejects.toThrow(/지갑/);
  });
});
