/**
 * 지갑 브라우저(MetaMask · PLAN §44) — 승인 판단 · 키 꼴 · 검문소(방식과 브라우저가 맞나 · MetaMask 승인 동작).
 */
import { describe, expect, it } from "vitest";
import { approvalDecision, FlowError, parseFlow, walletKeyKind, type WalletChain } from "../src/index.ts";

const chains: WalletChain[] = [{ chainId: 68414, name: "Henesys", rpcUrl: "https://rpc.example", allowTx: false }, { chainId: 31337, name: "QA", rpcUrl: "https://qa.example", allowTx: true }];
const HARDHAT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PHRASE = "test test test test test test test test test test test junk";

describe("approvalDecision — 무엇이든 누르지 않는다", () => {
  it("★연결 · 서명은 누른다", () => {
    expect(approvalDecision({ kind: "connect" }, { chains })).toEqual({ approve: true });
    expect(approvalDecision({ kind: "signature", text: "Welcome" }, { chains: [] })).toEqual({ approve: true });
  });
  it("★체인 추가 · 바꾸기는 목록 안만 — 모르는 체인 · 목록 밖은 이유와 함께", () => {
    expect(approvalDecision({ kind: "addChain", chainId: 68414 }, { chains })).toEqual({ approve: true });
    expect(approvalDecision({ kind: "switchChain", chainId: 31337 }, { chains })).toEqual({ approve: true });
    const out = approvalDecision({ kind: "addChain", chainId: 99999 }, { chains });
    expect(out).toMatchObject({ approve: false, reason: expect.stringMatching(/체인 99999.*목록에 없습니다/) });
    expect(approvalDecision({ kind: "switchChain", chainId: null }, { chains })).toMatchObject({ approve: false, reason: expect.stringMatching(/알 수 없음/) });
  });
  it("★거래는 «거래 허용» 체인만 · 점검에서는 늘 안 누른다", () => {
    expect(approvalDecision({ kind: "transaction", chainId: 31337 }, { chains })).toEqual({ approve: true });
    expect(approvalDecision({ kind: "transaction", chainId: 68414 }, { chains })).toMatchObject({ approve: false, reason: expect.stringMatching(/거래 허용이 꺼져/) });
    expect(approvalDecision({ kind: "transaction", chainId: 1 }, { chains })).toMatchObject({ approve: false, reason: expect.stringMatching(/목록에 없습니다/) });
    expect(approvalDecision({ kind: "transaction", chainId: 31337 }, { chains }, { probe: true })).toMatchObject({ approve: false, reason: expect.stringMatching(/점검/) });
  });
  it("모르는 화면은 누르지 않는다", () => {
    expect(approvalDecision({ kind: "unknown", hint: "snap-install" }, { chains })).toMatchObject({ approve: false, reason: expect.stringMatching(/snap-install/) });
  });
});

describe("walletKeyKind — 개인키 · 복구 문구", () => {
  it("개인키(0x 있어도 없어도) · 복구 문구(12~24 단어) · 그 밖", () => {
    expect(walletKeyKind(HARDHAT_KEY)).toBe("privateKey");
    expect(walletKeyKind(HARDHAT_KEY.slice(2))).toBe("privateKey");
    expect(walletKeyKind(`  ${PHRASE}  `)).toBe("mnemonic");
    expect(walletKeyKind("test test test")).toBeNull();
    expect(walletKeyKind("0x1234")).toBeNull();
    expect(walletKeyKind(PHRASE.replace("junk", "Junk"))).toBeNull();
  });
});

const web = (actions: unknown[]) => ({ id: "w", type: "web", name: "로그인", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://msu.example" }, actions } });
const approve = { id: "a2", kind: "walletApprove", done: { kind: "visible", target: { label: "지갑 주소", locators: [{ kind: "css", value: "#address" }] } } };
const flowWith = (settings: Record<string, unknown>, actions: unknown[] = [approve]) => ({
  schemaVersion: 1, id: "mm", name: "MetaMask 로그인",
  secrets: [{ name: "wk", kind: "text" }],
  settings, nodes: [web(actions)], edges: [],
});
const problems = (f: unknown): string[] => { try { parseFlow(f); return []; } catch (e) { if (e instanceof FlowError) return [...e.problems]; throw e; } };

describe("검문소 — 지갑 방식과 브라우저", () => {
  it("★지갑 브라우저 + MetaMask — 체인 없이도 된다 · 화폐 기호", () => {
    const f = parseFlow(flowWith({ browser: "wallet", wallet: { mode: "metamask", secret: "wk", chains: [] } }));
    expect(f.settings.wallet).toMatchObject({ mode: "metamask", secret: "wk", chains: [] });
    const g = parseFlow(flowWith({ browser: "wallet", wallet: { mode: "metamask", secret: "wk", chains: [{ chainId: 68414, name: "Henesys", rpcUrl: "https://r.example", symbol: "NXPC" }] } }));
    expect(g.settings.wallet!.chains[0]).toMatchObject({ chainId: 68414, symbol: "NXPC" });
    expect(problems(flowWith({ browser: "wallet", wallet: { mode: "metamask", secret: "wk", chains: [{ chainId: 1, symbol: "N X" }] } })).join("\n")).toMatch(/화폐 기호/);
  });
  it("옛 매니페스트(mode 없음)는 페이지에 넣는 테스트 지갑 — 체인이 있어야 한다", () => {
    const f = parseFlow(flowWith({ wallet: { secret: "wk", chains: [{ chainId: 31337 }] } }, [{ id: "a1", kind: "goto", url: "https://x.example" }]));
    expect(f.settings.wallet!.mode).toBe("inject");
    expect(problems(flowWith({ wallet: { secret: "wk", chains: [] } }, [{ id: "a1", kind: "goto", url: "https://x.example" }])).join("\n")).toMatch(/체인을 하나 이상/);
  });
  it("★방식과 브라우저가 어긋나면 — 사람 말로", () => {
    expect(problems(flowWith({ browser: "launch", wallet: { mode: "metamask", secret: "wk", chains: [] } }, [])).join("\n")).toMatch(/«지갑 브라우저\(MetaMask\)»로 고르세요/);
    expect(problems(flowWith({ browser: "wallet", wallet: null }, [])).join("\n")).toMatch(/«MetaMask 확장» 방식으로 정하세요/);
    expect(problems(flowWith({ browser: "wallet", wallet: { mode: "inject", secret: "wk", chains: [{ chainId: 1 }] } }, [])).join("\n")).toMatch(/페이지에 넣는 테스트 지갑을 쓰지 않습니다/);
    expect(problems(flowWith({ browser: "attach", wallet: { mode: "inject", secret: "wk", chains: [{ chainId: 1 }] } }, [])).join("\n")).toMatch(/사람의 크롬에 붙는 워크플로우에는 넣지 않습니다/);
    // 앱 안 브라우저 — 컨텍스트를 앱 전체가 함께 쓰므로 페이지에 넣는 지갑은 싣지 않는다 · MetaMask도 안 된다
    expect(problems(flowWith({ browser: "app", wallet: { mode: "inject", secret: "wk", chains: [{ chainId: 1 }] } }, [])).join("\n")).toMatch(/앱 안 브라우저에는 넣지 않습니다/);
    expect(problems(flowWith({ browser: "app", wallet: { mode: "metamask", secret: "wk", chains: [] } }, [])).join("\n")).toMatch(/«지갑 브라우저\(MetaMask\)»로 고르세요/);
    expect(parseFlow(flowWith({ browser: "app", wallet: null }, [])).settings.browser).toBe("app");
    expect(problems({ ...flowWith({ browser: "wallet", wallet: { mode: "metamask", secret: "nope", chains: [] } }), secrets: [] }).join("\n")).toMatch(/MetaMask 지갑: 시크릿 "nope"이\(가\) 정의되지 않았습니다 — 개인키 또는 복구 문구/);
  });
});

describe("검문소 — MetaMask 승인 동작", () => {
  const mm = { browser: "wallet", wallet: { mode: "metamask", secret: "wk", chains: [] } };
  it("★끝났다는 표시 · 기다리는 시간(10초~10분)", () => {
    const f = parseFlow(flowWith(mm));
    const n = f.nodes[0]!;
    expect(n.type === "web" && n.config.actions[0]).toMatchObject({ kind: "walletApprove", done: { kind: "visible" }, timeoutMs: null });
    expect(problems(flowWith(mm, [{ ...approve, timeoutMs: 5_000 }])).join("\n")).toMatch(/10초~10분/);
    expect(problems(flowWith(mm, [{ ...approve, done: { kind: "url", pattern: "(" } }])).length).toBeGreaterThan(0);
  });
  it("적어도 승인할 화면 수(atLeast) — 1~10", () => {
    const f = parseFlow(flowWith(mm, [{ ...approve, atLeast: 1 }]));
    expect(f.nodes[0]!.type === "web" && f.nodes[0]!.config.actions[0]).toMatchObject({ kind: "walletApprove", atLeast: 1 });
    expect(problems(flowWith(mm, [{ ...approve, atLeast: 11 }])).join("\n")).toMatch(/1~10/);
  });
  it("«있을 때만»을 켜지 않는다 — 이미 끝나 있으면 저절로 지나간다", () => {
    expect(problems(flowWith(mm, [{ ...approve, optional: true }])).join("\n")).toMatch(/«있을 때만»을 켜지 않습니다/);
  });
  it("★지갑 브라우저가 아니면 쓰지 않는다", () => {
    expect(problems(flowWith({ browser: "launch" })).join("\n")).toMatch(/MetaMask 승인은 지갑 브라우저\(MetaMask\)에서만/);
  });
  it("전체 시간 제한이 승인 기다림보다 짧으면", () => {
    expect(problems(flowWith({ ...mm, runTimeoutMin: 1 }, [{ ...approve, timeoutMs: 5 * 60_000 }])).join("\n")).toMatch(/MetaMask 승인을 5분 기다리는데 전체 시간 제한이 1분/);
  });
});
