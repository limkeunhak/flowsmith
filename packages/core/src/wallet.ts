/**
 * **지갑** — 블록체인 사이트(dApp)의 지갑 로그인을 자동화한다. 두 방식:
 *
 *   inject(PLAN §40)   **테스트 지갑** — 페이지에 지갑(window.ethereum · EIP-6963 알림)을 넣고, 사이트가 부르는
 *                      계정 연결 · 서명 · 거래를 **서버가 시크릿의 개인키로** 처리한다(engine browser/wallet.ts).
 *                      키는 페이지에 가지 않는다. 브라우저를 띄우는 플로우(launch)만.
 *   metamask(PLAN §44) **진짜 MetaMask 확장**을 실은 크롬(지갑 브라우저 — browser: "wallet").
 *                      사이트가 확장을 직접 확인하는 곳(MetaMask SDK — msu.io)용. 승인은 «MetaMask 승인» 동작이
 *                      화면을 읽어 누른다(approvalDecision). ★창이 있어야 한다 — 창 없는 브라우저는 승인 창을 열지 않는다
 *
 *   ★테스트 지갑 · QA 체인 전용이다. 거래는 체인마다 «거래 허용»을 켠 곳에서만 · 그 밖은 거절한다.
 *   ★사람의 크롬(attach)에는 사람의 메타마스크가 있다 — 사람 기다리기로 승인한다
 */

export const WALLET_MODES = ["inject", "metamask"] as const;
export type WalletMode = (typeof WALLET_MODES)[number];

export interface WalletChain {
  /** 체인 id(10진) — 1 메인넷 · 11155111 Sepolia · QA 대역의 id */
  chainId: number;
  name: string;
  /** JSON-RPC 주소 — 읽기(잔고 · 호출)와 거래 전송이 여기로 간다. 비우면 계정 연결 · 서명만 */
  rpcUrl: string;
  /** 거래 전송(eth_sendTransaction)을 허용하나 — ★QA 체인에서만 켠다 */
  allowTx: boolean;
  /** 화폐 기호 — MetaMask에 체인을 넣을 때(없으면 ETH) */
  symbol?: string;
}

export interface WalletSettings {
  /** 방식 — 없으면 inject(옛 매니페스트) */
  mode: WalletMode;
  /** 키를 담은 시크릿 — 글자 종류. inject: 개인키(0x…64자리) · metamask: 개인키 또는 복구 문구(12 · 15 · 18 · 21 · 24 단어) */
  secret: string;
  /** 사이트에 어떤 지갑으로 보이나(inject만) — MetaMask면 isMetaMask · EIP-6963 rdns io.metamask */
  announceAs: "MetaMask" | "Flowsmith Test Wallet";
  /** inject: 하나 이상 · metamask: 비어도 된다(체인을 더하지 않고 MetaMask의 기본 체인으로) */
  chains: WalletChain[];
  /** 처음 연결된 체인 */
  defaultChainId: number;
}

export const WALLET_ANNOUNCE = ["MetaMask", "Flowsmith Test Wallet"] as const;

/**
 * MetaMask 판 — **고정**한다(PLAN §44 · DESKTOP.md §5.3). 12.x는 사이트가 확장을 못 알아보고(externally_connectable),
 * 13.4x 이상은 온보딩 직후 확장 화면의 메모리가 터진다. 바꿀 때는 «사이트가 알아보나 · 온보딩 · 45초 안정»을 다시 본다.
 * SHA256은 GitHub 릴리스가 적어 둔 것(13.0.0에는 SHA256SUMS 파일이 없다)
 */
export const METAMASK_VERSION = "13.0.0";
export const METAMASK_SHA256 = "901bae57c92a752168d35643cd225d80716e6eae0f939d3bb812299f4dfb9bee";

/** 시크릿의 키가 어떤 꼴인가 — 개인키(0x 없어도) · 복구 문구 · 모름 */
export function walletKeyKind(key: string): "privateKey" | "mnemonic" | null {
  const k = key.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(k)) return "privateKey";
  const words = k.split(/\s+/);
  if ([12, 15, 18, 21, 24].includes(words.length) && words.every((w) => /^[a-z]+$/.test(w))) return "mnemonic";
  return null;
}

/** «MetaMask 승인»이 읽은 화면 — engine이 MetaMask 화면에서 짓는다(browser/metamask) */
export type MetaMaskScreen =
  | { kind: "connect" }
  | { kind: "signature"; text: string }
  | { kind: "addChain"; chainId: number | null }
  | { kind: "switchChain"; chainId: number | null }
  | { kind: "transaction"; chainId: number | null }
  | { kind: "unknown"; hint: string };

/**
 * 그 화면을 누를까 — **무엇이든 누르지 않는다**(PLAN §44). 연결 · 서명은 누르고, 체인은 설정의 목록 안만,
 * 거래는 «거래 허용»을 켠 체인만(점검에서는 늘 안 누른다), 모르는 화면은 누르지 않는다.
 */
export function approvalDecision(screen: MetaMaskScreen, wallet: Pick<WalletSettings, "chains">, opts: { probe?: boolean } = {}): { approve: true } | { approve: false; reason: string } {
  const listed = (id: number | null) => id !== null && wallet.chains.some((c) => c.chainId === id);
  switch (screen.kind) {
    case "connect": return { approve: true };
    case "signature": return { approve: true };
    case "addChain":
    case "switchChain":
      return listed(screen.chainId) ? { approve: true } : { approve: false, reason: `체인 ${screen.chainId ?? "(알 수 없음)"}은(는) 워크플로우 설정의 체인 목록에 없습니다 — 목록에 넣거나 사이트가 맞는 체인을 쓰는지 보세요` };
    case "transaction": {
      if (opts.probe) return { approve: false, reason: "점검 실행은 거래를 승인하지 않습니다" };
      const c = wallet.chains.find((x) => x.chainId === screen.chainId);
      if (!c) return { approve: false, reason: `거래 화면의 체인 ${screen.chainId ?? "(알 수 없음)"}이(가) 체인 목록에 없습니다` };
      return c.allowTx ? { approve: true } : { approve: false, reason: `체인 «${c.name}»은(는) 거래 허용이 꺼져 있습니다 — QA 체인이면 설정에서 «거래 허용»을 켜세요` };
    }
    case "unknown": return { approve: false, reason: `모르는 MetaMask 화면이라 누르지 않았습니다(${screen.hint})` };
  }
}

/** 지갑이 처리하는 요청 — 그 밖은 RPC로 넘기거나(읽기) 거절한다 */
export const WALLET_SIGN_METHODS = ["personal_sign", "eth_signTypedData_v4", "eth_signTypedData_v3"] as const;
/** ★늘 거절 — 아무 해시나 서명하는 옛 방식(피싱에 쓰인다) */
export const WALLET_DENIED_METHODS = ["eth_sign", "eth_signTransaction", "eth_sendRawTransaction", "wallet_addEthereumChain_unchecked"] as const;
