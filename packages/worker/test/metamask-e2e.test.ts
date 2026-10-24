/**
 * **지갑 브라우저 — 진짜 MetaMask**(PLAN §44). 시험 사이트의 dApp(/dapp)에 «지갑 연결» → 체인 추가(가짜 RPC) → 연결 → 서명 →
 * 주소 읽기. 같은 프로필로 다시 돌면 잠금만 푼다 · 목록 밖 체인은 누르지 않는다.
 *
 * ☆화면이 있어야 하고(창 있는 크롬) MetaMask를 받는다(처음 한 번 · ~/.cache/flowsmith/mm) — FLOWSMITH_MM_E2E=1일 때만 돈다(CI는 건너뛴다).
 *   FLOWSMITH_MM_E2E=1 pnpm exec vitest run packages/worker/test/metamask-e2e.test.ts
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFlow } from "@flowsmith/core";
import { addressOf, approveUntil, runFlow, type RunResult } from "@flowsmith/engine";
import { RecorderSession } from "@flowsmith/recorder";
import type { ServerMessage } from "@flowsmith/recorder/protocol";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { InProcessWorker } from "../src/index.ts";
import { ensureMetaMask, hasDisplay, walletDirs } from "../src/metamask.ts";

const on = process.env["FLOWSMITH_MM_E2E"] === "1" && hasDisplay();
const KEY = `0x${randomBytes(32).toString("hex")}`;   // 시험마다 새 지갑 — 자산 없음

let site: TestSite;
let extensionDir: string;
let profilesRoot: string;

const t = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const flowOf = (actions: unknown[]) => parseFlow({
  schemaVersion: 1, id: "mm-e2e", name: "지갑 로그인", secrets: [{ name: "wk", kind: "text" }],
  settings: {
    browser: "wallet", defaultTimeoutMs: 15_000,
    wallet: { mode: "metamask", secret: "wk", defaultChainId: 31337, chains: [{ chainId: 31337, name: "Flowsmith QA", rpcUrl: `${site.url}/__rpc?chain=31337`, allowTx: false, symbol: "FQA" }] },
  },
  nodes: [{ id: "w", type: "web", name: "dApp 로그인", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${site.url}/dapp` }, actions } }],
  edges: [],
});
const run = (actions: unknown[]): Promise<RunResult> => runFlow(flowOf(actions), { secrets: { wk: KEY }, metamask: { extensionDir, profilesRoot } });
const logsOf = (r: RunResult) => r.nodes.flatMap((n) => n.logs).join("\n");
const failOf = (r: RunResult) => `${r.message} ${r.nodes.map((n) => n.failure?.message ?? "").join(" ")}`;

describe.skipIf(!on)("지갑 브라우저 — 진짜 MetaMask", () => {
  beforeAll(async () => {
    site = await startTestSite(0);
    extensionDir = await ensureMetaMask(walletDirs(), (s) => console.log(s));
    profilesRoot = mkdtempSync(join(tmpdir(), "fsw-"));
  }, 180_000);
  afterAll(async () => {
    await site?.close();
    if (profilesRoot) rmSync(profilesRoot, { recursive: true, force: true });
  });

  const login = [
    { id: "a1", kind: "click", target: t("'지갑 연결' 버튼", "#connect") },
    { id: "a2", kind: "walletApprove", done: { kind: "visible", target: t("로그인됨", "#signed") } },
    { id: "a3", kind: "read", output: "address", strategy: "text", target: t("지갑 주소", "#address") },
  ];

  it("★처음 — 지갑 준비 → 체인 추가 → 연결 → 서명 → 주소", async () => {
    const r = await run(login);
    expect(r.status, failOf(r)).toBe("success");
    expect(String(r.output["address"]).toLowerCase()).toBe(addressOf(KEY).toLowerCase());
    const logs = logsOf(r);
    expect(logs).toMatch(/처음 준비합니다/);
    expect(logs).toMatch(/체인을 «Flowsmith QA»\(31337\)로 맞췄습니다/);
    expect(logs).toMatch(/연결 승인/);
    expect(logs).toMatch(/서명 승인 — 서명한 글: «.*Flowsmith 시험 로그인/);
    expect(logs).not.toContain(KEY.slice(2));   // ★키는 기록에 없다
  }, 240_000);

  it("★다시 — 같은 프로필 · 잠금만 푼다", async () => {
    const r = await run(login);
    expect(r.status, failOf(r)).toBe("success");
    expect(logsOf(r)).toMatch(/잠금을 풀었습니다/);
    expect(logsOf(r)).not.toMatch(/처음 준비합니다/);
  }, 180_000);

  it("★목록 밖 체인은 누르지 않는다 — 이유와 함께 멈춘다", async () => {
    const r = await run([
      { id: "b1", kind: "click", target: t("'다른 체인 넣기' 버튼", "#bad-chain") },
      { id: "b2", kind: "walletApprove", timeoutMs: 30_000, done: { kind: "visible", target: t("로그인됨", "#signed") } },
    ]);
    expect(r.status).toBe("failure");
    // 화면에 체인 id가 안 나오면 «알 수 없음» — 어느 쪽이든 목록에 없어 누르지 않는다
    expect(failOf(r)).toMatch(/체인 추가 화면을 승인하지 않았습니다 — 체인 (99999|\(알 수 없음\)).*목록에 없습니다/);
  }, 180_000);

  it("★지갑 다시 준비 — 워커가 프로필을 지우고 처음부터(resetWallet)", async () => {
    const worker = new InProcessWorker({ headless: false, wallet: { extensionDir, profilesRoot } });
    try {
      const r = await worker.run({ runId: "reset-1", flow: flowOf(login), params: {}, secrets: { wk: KEY }, resetWallet: true }, () => undefined);
      expect(r.status, failOf(r)).toBe("success");
      expect(logsOf(r)).toMatch(/지갑 프로필을 지우고 다시 준비합니다/);
      expect(logsOf(r)).toMatch(/처음 준비합니다/);
    } finally { await worker.close(); }
  }, 240_000);

  it("★녹화 — 지갑 브라우저로 열고 · MetaMask 창에서 누른 것은 녹화하지 않는다 · 이 노드의 «MetaMask 승인»은 재생된다", async () => {
    const worker = new InProcessWorker({ headless: false, wallet: { extensionDir, profilesRoot } });
    const raw = { ...JSON.parse(JSON.stringify(flowOf([]))), nodes: [{ id: "w", type: "web", name: "dApp 로그인", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: `${site.url}/dapp` }, actions: [] } }] };
    const msgs: ServerMessage[] = [];
    const io = { send: (m: ServerMessage) => msgs.push(m), frame: () => undefined };
    // ① 빈 노드를 녹화 — «지갑 연결»을 누르고, 사람 대신 MetaMask 창에서 승인한다
    const s = await RecorderSession.open(await worker.walletSource(raw, { wk: KEY }), { t: "open", flowId: raw.id, nodeId: "w", draft: raw, params: {}, replay: false, replayExisting: false, startMode: "record", viewport: { width: 1200, height: 800 } }, { wk: KEY }, io);
    try {
      expect(msgs.filter((m) => m.t === "phase").map((m) => (m as { phase: string }).phase)).toContain("ready");
      await s.page.locator("#connect").click();
      await s.settle();
      await approveUntil({ context: s.page.context(), dapp: s.page, wallet: { chains: raw.settings.wallet.chains }, done: () => s.page.locator("#signed").isVisible(), timeoutMs: 90_000, log: () => undefined });
      await s.settle();
      const recorded = msgs.filter((m) => m.t === "recorded").map((m) => (m as { item: { action: { kind: string; target?: { label: string } } } }).item.action);
      expect(recorded.map((a) => a.kind)).toEqual(["click"]);   // ★MetaMask 창의 «Connect» · «Confirm»은 들어오지 않는다
      expect(recorded[0]!.target!.label).toMatch(/지갑 연결/);
    } finally { await s.close(); }
    // ② 이 노드에 동작이 있으면 녹화 전에 재생한다 — «MetaMask 승인»이 저절로 누른다
    raw.nodes[0].config.actions = login.slice(0, 2);
    msgs.length = 0;
    const s2 = await RecorderSession.open(await worker.walletSource(raw, { wk: KEY }), { t: "open", flowId: raw.id, nodeId: "w", draft: raw, params: {}, replay: false, replayExisting: true, startMode: "record", viewport: { width: 1200, height: 800 } }, { wk: KEY }, io);
    try {
      expect(await s2.page.locator("#signed").isVisible()).toBe(true);
      expect(msgs.filter((m) => m.t === "notice" && (m as { level: string }).level === "error")).toEqual([]);
    } finally { await s2.close(); await worker.close(); }
  }, 300_000);
});
