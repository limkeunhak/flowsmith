/**
 * **지갑 브라우저**(PLAN §44 · DESKTOP.md §5) — 진짜 MetaMask를 실은 크롬. 지갑마다 프로필 하나를 계속 쓴다.
 *
 *   프로필   <profilesRoot>/<키의 지문 10자>/ — 처음 한 번 지갑을 준비하고(약 30초) 다음부터는 잠금만 푼다.
 *            사람 몫(이메일 재인증 · Cloudflare)도 한 번 풀면 프로필에 남는다
 *   비밀번호 <profilesRoot>/<지문>.json — 이 워커가 만든 MetaMask 잠금 비밀번호 · 준비됐나(프로필을 잠그는 데만 쓴다)
 *   잠금     같은 프로필은 한 번에 하나만 연다(이 프로세스 안에서 줄을 선다) — 크롬이 같은 프로필을 두 번 열지 못한다
 *
 * ★창이 있어야 한다(headless: false) — 창 없는 크롬은 승인 창을 열지 않는다. 리눅스 서버라면 Xvfb.
 * ★Windows는 경로가 짧아야 한다 — MetaMask 저장소(IndexedDB)는 프로필 안 깊은 곳이라, 뿌리가 길면 260자를 넘어
 *  지갑 화면이 여우 로딩에서 멈춘다(0단계 ④에서 겪었다). 뿌리가 길면 열기 전에 이유와 함께 멈춘다.
 * ★키는 이 파일 밖으로 나가지 않는다 — 로그에는 지갑 주소(공개)만 남긴다.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { METAMASK_VERSION, walletKeyKind } from "@flowsmith/core";
import { MetaMaskUi, type Log } from "./ui.ts";

/** 워커가 준다 — MetaMask를 풀어 둔 폴더 · 지갑 프로필 뿌리 */
export interface MetaMaskEnv {
  extensionDir: string;
  profilesRoot: string;
  /** «지갑 다시 준비» — 열기 전에 그 지갑의 프로필을 지운다(처음부터 준비한다) */
  reset?: boolean;
}

export interface WalletBrowser {
  context: BrowserContext;
  extensionId: string;
  /** 이 지갑의 주소(공개) */
  address: string;
  close(): Promise<void>;
}

/** 프로필 안에서 가장 깊은 경로가 뿌리 뒤로 이만큼 간다(0단계 ④ 실측 178자 + 여유) */
const PROFILE_DEPTH = 190;
const WIN_MAX_PATH = 259;

const locks = new Map<string, Promise<void>>();

interface Meta { password: string; ready: boolean; address: string; version: string }

export function walletFingerprint(key: string): string {
  return createHash("sha256").update(key.trim().toLowerCase().replace(/^0x/, "")).digest("hex").slice(0, 10);
}

export function addressOf(key: string): string {
  const k = key.trim();
  return walletKeyKind(k) === "privateKey" ? privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`).address : mnemonicToAccount(k.split(/\s+/).join(" ")).address;
}

/** Windows 경로 길이 — 넘으면 이유를 돌려준다(없으면 null) */
export function profilePathProblem(profilesRoot: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32") return null;
  const longest = join(profilesRoot, "0123456789").length + PROFILE_DEPTH;
  if (longest <= WIN_MAX_PATH) return null;
  return `지갑 프로필 폴더 경로가 너무 깁니다(${profilesRoot.length}자) — MetaMask 저장소가 Windows의 260자 제한을 넘어 지갑이 열리지 않습니다. ` +
    `FLOWSMITH_WALLET_DIR를 짧은 폴더(예: C:\\fsw)로 주거나 Windows 긴 경로 지원(LongPathsEnabled)을 켜세요`;
}

/** 다른 PC(또는 죽은 컨테이너)가 남긴 프로필 잠금 — 그 PC의 크롬은 살아 있을 수 없으니 지운다(이 PC의 것은 둔다) */
function clearStaleLock(dir: string): void {
  let target: string;
  try { target = readlinkSync(join(dir, "SingletonLock")); } catch { return; }
  if (target.slice(0, target.lastIndexOf("-")) === hostname()) return;
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(join(dir, f), { force: true });
}

function readMeta(file: string): Meta | null {
  try { const m = JSON.parse(readFileSync(file, "utf8")) as Meta; return typeof m.password === "string" ? m : null; } catch { return null; }
}

/** 같은 지문은 줄을 선다 — 앞 실행이 닫을 때까지 */
async function takeLock(fp: string, log: Log): Promise<() => void> {
  const before = locks.get(fp);
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  locks.set(fp, (before ?? Promise.resolve()).then(() => mine));
  if (before) { log("MetaMask: 같은 지갑을 쓰는 다른 실행이 끝나길 기다립니다"); await before; }
  return () => { release(); if (locks.get(fp) === mine) locks.delete(fp); };
}

export async function openWalletBrowser(env: MetaMaskEnv, key: string, o: { log: Log }): Promise<WalletBrowser> {
  const kind = walletKeyKind(key);
  if (!kind) throw new Error("MetaMask 지갑: 시크릿이 개인키(0x…64자리)도 복구 문구(12~24 단어)도 아닙니다");
  const manifest = join(env.extensionDir, "manifest.json");
  if (!existsSync(manifest)) throw new Error(`MetaMask ${METAMASK_VERSION}이(가) 이 워커에 없습니다(${env.extensionDir})`);
  const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version;
  if (version !== METAMASK_VERSION) throw new Error(`MetaMask 판이 다릅니다 — ${version} (이 Flowsmith는 ${METAMASK_VERSION}만 씁니다)`);
  const pathProblem = profilePathProblem(env.profilesRoot);
  if (pathProblem) throw new Error(pathProblem);

  const fp = walletFingerprint(key);
  const address = addressOf(key);
  const release = await takeLock(fp, o.log);
  try {
    mkdirSync(env.profilesRoot, { recursive: true });
    const dir = join(env.profilesRoot, fp);
    const metaFile = join(env.profilesRoot, `${fp}.json`);
    let meta = readMeta(metaFile);
    // «지갑 다시 준비» — 프로필을 버리고 처음부터(잠금을 쥔 뒤라 다른 실행이 쓰는 중에 지우지 않는다)
    if (env.reset && (meta || existsSync(dir))) { o.log("MetaMask: 지갑 프로필을 지우고 다시 준비합니다"); meta = null; }
    // 준비하다 멈춘 프로필은 버리고 새로 — 금고는 있는데 계정을 못 불러왔을 수 있다
    if (meta && !meta.ready) { rmSync(dir, { recursive: true, force: true }); meta = null; }
    if (!meta || !existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      meta = { password: randomBytes(18).toString("base64url"), ready: false, address, version: METAMASK_VERSION };
      writeFileSync(metaFile, JSON.stringify(meta), { mode: 0o600 });
    }
    mkdirSync(dir, { recursive: true });
    clearStaleLock(dir);

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(dir, {
        headless: false,   // ★창이 있어야 승인 창이 열린다
        locale: "en-US",
        args: [`--disable-extensions-except=${env.extensionDir}`, `--load-extension=${env.extensionDir}`, "--lang=en-US"],
      });
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      throw new Error(`지갑 브라우저를 띄우지 못했습니다 — 화면이 있는 곳(데스크톱 · Xvfb)에서 돌려야 합니다 (${msg})`);
    }
    try {
      const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 20_000 });
      const extensionId = new URL(sw.url()).host;
      // ★지속 컨텍스트는 페이지가 0개가 되면 크롬이 꺼진다 — 빈 탭 하나를 늘 둔다(MetaMask는 온보딩 중 제 탭을 닫는다)
      const keep = context.pages()[0] ?? await context.newPage();
      const mmPage = await context.newPage();
      const ui = new MetaMaskUi(mmPage, extensionId, o.log);
      await ui.open();
      await closeExtraHomeTabs(context, [keep, mmPage]);
      await ui.settle();

      const pending = await ui.isOnboardingPending();
      if (!pending && !meta.ready) throw new Error("MetaMask 프로필 상태를 알 수 없습니다 — «지갑 다시 준비»로 프로필을 지우세요");
      if (pending) {
        o.log(`MetaMask: 지갑 ${address}을(를) 처음 준비합니다(30초쯤)`);
        // 개인키면 금고는 아무도 모르는 새 복구 문구로 만들고 그 키를 불러온다 — 복구 문구는 어디에도 남기지 않는다
        const words = kind === "mnemonic" ? key.trim().split(/\s+/) : generateMnemonic(english).split(" ");
        await ui.onboard(words, meta.password);
        await ui.ensureHome(meta.password);
        if (kind === "privateKey") await ui.importPrivateKey(key.trim().startsWith("0x") ? key.trim() : `0x${key.trim()}`);
        meta = { ...meta, ready: true };
        writeFileSync(metaFile, JSON.stringify(meta), { mode: 0o600 });
      } else {
        await ui.ensureHome(meta.password);
        o.log(`MetaMask: 지갑 ${address} — 잠금을 풀었습니다`);
      }
      await ui.dismissModals();
      // ★승인 화면은 열린 확장 탭 안에 그려질 수 있다 — 지갑 탭을 닫아 두면 늘 새 알림 창으로 온다
      await mmPage.close().catch(() => undefined);
      let closed = false;
      return {
        context, extensionId, address,
        close: async () => {
          if (closed) return;
          closed = true;
          await context.close().catch(() => undefined);
          release();
        },
      };
    } catch (e) {
      await context.close().catch(() => undefined);
      throw e;
    }
  } catch (e) {
    release();
    throw e;
  }
}

/** MetaMask는 깔리자마자 제 home.html 탭을 연다 — 겹친 것만 닫는다(승인 창 notification.html은 두고 · 마지막 한 장은 남긴다) */
async function closeExtraHomeTabs(context: BrowserContext, keep: Page[]): Promise<void> {
  for (let i = 0; i < 8; i++) {
    for (const p of context.pages()) {
      if (keep.includes(p) || p.isClosed() || !p.url().includes("/home.html")) continue;
      if (context.pages().filter((x) => !x.isClosed()).length < 2) continue;
      await p.close().catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** «지갑 다시 준비» — 그 지갑의 프로필을 지운다(다음 실행이 처음부터 준비한다) */
export function resetWalletProfile(env: Pick<MetaMaskEnv, "profilesRoot">, key: string): void {
  const fp = walletFingerprint(key);
  rmSync(join(env.profilesRoot, fp), { recursive: true, force: true });
  rmSync(join(env.profilesRoot, `${fp}.json`), { force: true });
}
