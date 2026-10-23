/**
 * **테스트 지갑**(PLAN §40) — 블록체인 사이트(dApp)를 메타마스크 없이 자동화한다.
 *
 *   페이지에 지갑(window.ethereum · EIP-6963 알림)을 넣고, 사이트가 부르는 계정 연결 · 서명 · 거래를
 *   **서버가 시크릿의 개인키로** 처리한다(engine browser/wallet.ts). 키는 페이지에 가지 않는다.
 *
 *   ★테스트 지갑 · QA 체인 전용이다. 거래 전송은 체인마다 «거래 허용»을 켠 곳에서만 · 그 밖은 거절한다.
 *   ★브라우저를 띄우는 플로우만(사람의 크롬에는 사람의 메타마스크가 있다 — 사람 기다리기로 승인)
 */

export interface WalletChain {
  /** 체인 id(10진) — 1 메인넷 · 11155111 Sepolia · QA 대역의 id */
  chainId: number;
  name: string;
  /** JSON-RPC 주소 — 읽기(잔고 · 호출)와 거래 전송이 여기로 간다. 비우면 계정 연결 · 서명만 */
  rpcUrl: string;
  /** 거래 전송(eth_sendTransaction)을 허용하나 — ★QA 체인에서만 켠다 */
  allowTx: boolean;
}

export interface WalletSettings {
  /** 개인키(0x…64자리)를 담은 시크릿 — 글자 종류 */
  secret: string;
  /** 사이트에 어떤 지갑으로 보이나 — MetaMask면 isMetaMask · EIP-6963 rdns io.metamask */
  announceAs: "MetaMask" | "Flowsmith Test Wallet";
  chains: WalletChain[];
  /** 처음 연결된 체인 */
  defaultChainId: number;
}

export const WALLET_ANNOUNCE = ["MetaMask", "Flowsmith Test Wallet"] as const;

/** 지갑이 처리하는 요청 — 그 밖은 RPC로 넘기거나(읽기) 거절한다 */
export const WALLET_SIGN_METHODS = ["personal_sign", "eth_signTypedData_v4", "eth_signTypedData_v3"] as const;
/** ★늘 거절 — 아무 해시나 서명하는 옛 방식(피싱에 쓰인다) */
export const WALLET_DENIED_METHODS = ["eth_sign", "eth_signTransaction", "eth_sendRawTransaction", "wallet_addEthereumChain_unchecked"] as const;
