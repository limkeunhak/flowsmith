/**
 * **테스트 지갑** — 페이지에 EIP-1193 지갑(window.ethereum)을 넣고, 요청은 **이 프로세스가 개인키로** 처리한다(core wallet.ts · PLAN §40).
 *
 *   페이지 쪽   window.ethereum(request · on · removeListener) + EIP-6963 알림(MetaMask로 보이게 할 수 있다).
 *              요청은 바인딩(__flowsmithWallet)으로 넘어온다 — ★개인키는 페이지에 가지 않는다
 *   이쪽       계정 연결 · 체인 바꾸기 · 서명(personal_sign · EIP-712) · 거래(허용한 체인만) · 그 밖의 읽기는 RPC로
 *
 * ★거절: eth_sign(아무 해시나 서명) · 허용하지 않은 체인의 거래 · 목록에 없는 체인으로 바꾸기
 * ★점검(probe)은 거래를 보내지 않는다 · 서명은 한다(로그인 화면을 따라가야 한다)
 */
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "playwright";
import { createWalletClient, hexToString, http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WalletSettings } from "@flowsmith/core";

export class WalletError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

/** 페이지에 심는 지갑 — 요청을 바인딩으로 넘긴다. 이벤트(chainChanged · accountsChanged)는 답을 보고 페이지 쪽에서 낸다 */
function providerScript(announceAs: WalletSettings["announceAs"], chainIdHex: string, uuid: string): string {
  const meta = announceAs === "MetaMask";
  const info = {
    uuid,
    name: announceAs,
    rdns: meta ? "io.metamask" : "io.flowsmith.testwallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iI2Y2ODUxYiIvPjwvc3ZnPg==",
  };
  return `(() => {
  if (window.__flowsmithWalletInstalled) return;
  window.__flowsmithWalletInstalled = true;
  const listeners = {};
  const emit = (ev, v) => (listeners[ev] || []).slice().forEach((f) => { try { f(v); } catch (e) { console.error(e); } });
  const provider = {
    isMetaMask: ${meta}, isFlowsmithTestWallet: true, _metamask: { isUnlocked: async () => true },
    chainId: ${JSON.stringify(chainIdHex)}, networkVersion: String(parseInt(${JSON.stringify(chainIdHex)}, 16)), selectedAddress: null,
    isConnected: () => true,
    async request(args) {
      if (!args || typeof args.method !== "string") throw Object.assign(new Error("잘못된 요청"), { code: -32600 });
      const r = await window.__flowsmithWallet({ method: args.method, params: args.params ?? [] });
      if (r && r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, data: r.error.data });
      const v = r ? r.result : null;
      if (args.method === "eth_requestAccounts" || args.method === "eth_accounts") {
        if (Array.isArray(v) && v[0] && provider.selectedAddress !== v[0]) { provider.selectedAddress = v[0]; emit("accountsChanged", v); }
      }
      if ((args.method === "wallet_switchEthereumChain" || args.method === "wallet_addEthereumChain") && r && r.chainId && r.chainId !== provider.chainId) {
        provider.chainId = r.chainId; provider.networkVersion = String(parseInt(r.chainId, 16)); emit("chainChanged", r.chainId);
      }
      return v;
    },
    // 옛 방식(web3.js 0.x) — 같은 길로
    send(a, b) { return typeof b === "function" ? this.sendAsync(a, b) : this.request(typeof a === "string" ? { method: a, params: b } : a); },
    sendAsync(p, cb) { this.request(p).then((result) => cb(null, { id: p.id, jsonrpc: "2.0", result }), (e) => cb(e)); },
    enable() { return this.request({ method: "eth_requestAccounts" }); },
    on(ev, f) { (listeners[ev] ||= []).push(f); return this; },
    once(ev, f) { const g = (v) => { this.removeListener(ev, g); f(v); }; return this.on(ev, g); },
    removeListener(ev, f) { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); return this; },
    off(ev, f) { return this.removeListener(ev, f); },
    removeAllListeners(ev) { if (ev) delete listeners[ev]; else for (const k of Object.keys(listeners)) delete listeners[k]; return this; },
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true, writable: true });
  const detail = Object.freeze({ info: Object.freeze(${JSON.stringify(info)}), provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  window.dispatchEvent(new Event("ethereum#initialized"));
})();`;
}

const hex = (n: number): Hex => `0x${n.toString(16)}`;
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface WalletLog { (text: string): void }

/**
 * 컨텍스트에 지갑을 단다 — 그 컨텍스트의 모든 페이지(팝업 포함)에 들어간다.
 * privateKey는 시크릿에서 · probe면 거래를 보내지 않는다
 */
export async function installWallet(context: BrowserContext, settings: WalletSettings, privateKey: string, opts: { log?: WalletLog; probe?: boolean; fetch?: typeof fetch } = {}): Promise<{ address: string }> {
  const key = privateKey.trim().replace(/^(?!0x)/, "0x") as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new WalletError(4100, "테스트 지갑의 개인키가 0x로 시작하는 64자리 16진수가 아닙니다 — 시크릿을 확인하세요");
  const account = privateKeyToAccount(key);
  let chainId = settings.defaultChainId;
  const chainOf = (id: number) => settings.chains.find((c) => c.chainId === id);
  const log = opts.log ?? (() => undefined);
  const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
    const c = chainOf(chainId);
    if (!c?.rpcUrl) throw new WalletError(4200, `«${method}» — 이 체인(${chainId})에 RPC 주소가 없어 읽을 수 없습니다(지갑 설정)`);
    const res = await (opts.fetch ?? fetch)(c.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
    const j = await res.json() as { result?: unknown; error?: { code: number; message: string } };
    if (j.error) throw new WalletError(j.error.code ?? -32603, j.error.message);
    return j.result;
  };

  const handle = async (req: { method: string; params: unknown[] }): Promise<{ result?: unknown; error?: { code: number; message: string }; chainId?: string }> => {
    const p = Array.isArray(req.params) ? req.params : [];
    try {
      switch (req.method) {
        case "eth_requestAccounts":
          log(`지갑: 계정 연결 — ${account.address}`);
          return { result: [account.address] };
        case "eth_accounts": return { result: [account.address] };
        case "eth_coinbase": return { result: account.address };
        case "eth_chainId": return { result: hex(chainId) };
        case "net_version": return { result: String(chainId) };
        case "wallet_requestPermissions": case "wallet_getPermissions":
          return { result: [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [account.address] }] }] };
        case "wallet_revokePermissions": return { result: null };
        case "wallet_switchEthereumChain": case "wallet_addEthereumChain": {
          const want = Number.parseInt(String((p[0] as { chainId?: string } | undefined)?.chainId ?? ""), 16);
          if (!chainOf(want)) throw new WalletError(4902, `체인 ${Number.isNaN(want) ? "?" : want}은(는) 지갑 설정에 없습니다 — QA 체인만 씁니다`);
          chainId = want;
          log(`지갑: 체인 바꿈 — ${chainOf(want)!.name}(${want})`);
          return { result: null, chainId: hex(want) };
        }
        case "personal_sign": {
          // [메시지, 주소] — 순서를 바꿔 보내는 사이트도 있다
          const [a, b] = p as [string, string];
          const msg = isHex(a) && !(isHex(b) && b.length !== 42 && a.length === 42) ? a : b;
          const text = isHex(msg) ? (() => { try { return hexToString(msg); } catch { return msg; } })() : msg;
          log(`지갑: 서명(personal_sign) — «${short(text.replace(/\s+/g, " "))}»`);
          return { result: await account.signMessage({ message: isHex(msg) ? { raw: msg } : msg }) };
        }
        case "eth_signTypedData_v4": case "eth_signTypedData_v3": case "eth_signTypedData": {
          const raw = typeof p[1] === "string" ? JSON.parse(p[1]) : p[1];
          const { domain, types, primaryType, message } = raw as { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
          const { EIP712Domain: _drop, ...rest } = types as Record<string, unknown>;
          log(`지갑: 서명(EIP-712 ${primaryType}) — ${String(domain["name"] ?? "")}`);
          // 사이트가 보낸 모양 그대로 — viem의 정적 타입(정의된 types에서 끌어내는 것)은 여기서 알 수 없다
          return { result: await account.signTypedData({ domain, types: rest, primaryType, message } as unknown as Parameters<typeof account.signTypedData>[0]) };
        }
        case "eth_sendTransaction": {
          const c = chainOf(chainId)!;
          if (!c.allowTx) throw new WalletError(4100, `거래 전송은 «거래 허용»을 켠 체인에서만 합니다 — 지금 체인 ${c.name}(${chainId})`);
          if (opts.probe) throw new WalletError(4001, "점검(변경 감시)은 거래를 보내지 않습니다");
          const tx = (p[0] ?? {}) as { to?: Hex; data?: Hex; value?: Hex; gas?: Hex; from?: string };
          if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) throw new WalletError(4100, `보내는 주소(${tx.from})가 테스트 지갑(${account.address})이 아닙니다`);
          const client = createWalletClient({ account, transport: http(c.rpcUrl, { ...(opts.fetch ? { fetchFn: opts.fetch } : {}) }), chain: { id: c.chainId, name: c.name, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [c.rpcUrl] } } } });
          const hash = await client.sendTransaction({
            ...(tx.to ? { to: tx.to } : {}), ...(tx.data ? { data: tx.data } : {}),
            ...(tx.value ? { value: BigInt(tx.value) } : {}), ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
          } as never);
          log(`지갑: 거래 보냄 — ${c.name} · ${tx.to ?? "(계약 만들기)"} · ${hash}`);
          return { result: hash };
        }
        case "eth_sign": case "eth_signTransaction": case "eth_sendRawTransaction":
          throw new WalletError(4200, `«${req.method}»는 테스트 지갑이 하지 않습니다(위험한 서명)`);
        default:
          if (req.method.startsWith("wallet_") || req.method.startsWith("personal_")) throw new WalletError(4200, `«${req.method}»는 테스트 지갑이 모르는 요청입니다`);
          return { result: await rpc(req.method, p) };
      }
    } catch (e) {
      const code = e instanceof WalletError ? e.code : -32603;
      const message = e instanceof Error ? e.message.split("\n")[0]! : String(e);
      log(`지갑: 거절 — ${req.method}: ${message}`);
      return { error: { code, message } };
    }
  };

  await context.exposeBinding("__flowsmithWallet", (_src, req: { method: string; params: unknown[] }) => handle(req));
  const script = providerScript(settings.announceAs, hex(chainId), randomUUID());
  await context.addInitScript({ content: script });
  // 이미 열린 페이지에도
  await Promise.all(context.pages().map((pg) => pg.evaluate(script).catch(() => undefined)));
  return { address: account.address };
}
