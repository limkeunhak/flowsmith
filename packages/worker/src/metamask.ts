/**
 * **MetaMask 준비** — 지갑 브라우저(PLAN §44)가 쓸 MetaMask를 이 PC에 받아 둔다. 처음 쓸 때 한 번.
 *
 *   어디   FLOWSMITH_WALLET_DIR(없으면 Windows `%LOCALAPPDATA%\Flowsmith` · 그 밖 `~/.cache/flowsmith`)
 *            mm/<판>/   MetaMask를 풀어 둔 곳
 *            w/         지갑마다의 크롬 프로필(engine metamask/wallet-browser.ts)
 *   받기   GitHub 릴리스에서 받고 **SHA256을 맞춰 본다**(core METAMASK_SHA256). 맞지 않으면 쓰지 않는다.
 *          사내망에서 GitHub가 막혔으면 FLOWSMITH_METAMASK_ZIP=<받아 둔 zip>을 준다 — 그것도 같은 SHA256을 본다
 *
 * ★Windows는 짧은 경로에 — 뿌리가 길면 프로필이 260자를 넘는다(engine profilePathProblem이 막는다)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { METAMASK_SHA256, METAMASK_VERSION } from "@flowsmith/core";
import type { MetaMaskEnv } from "@flowsmith/engine";

const RELEASE = `https://github.com/MetaMask/metamask-extension/releases/download/v${METAMASK_VERSION}/metamask-chrome-${METAMASK_VERSION}.zip`;

/** 지갑 폴더들 — 이 PC의 것 */
export function walletDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): MetaMaskEnv & { root: string } {
  const root = env["FLOWSMITH_WALLET_DIR"]?.trim()
    || (platform === "win32" ? join(env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "Flowsmith") : join(env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "flowsmith"));
  return { root, extensionDir: join(root, "mm", METAMASK_VERSION), profilesRoot: join(root, "w") };
}

/** 이 PC가 창을 띄울 수 있나 — 리눅스는 DISPLAY · WAYLAND_DISPLAY(Xvfb · WSLg)가 있어야 한다 */
export function hasDisplay(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32" || platform === "darwin") return true;
  return Boolean(env["DISPLAY"] || env["WAYLAND_DISPLAY"]);
}

let preparing: Promise<string> | null = null;

/** MetaMask를 풀어 둔 폴더 — 없으면 받는다(동시에 불러도 한 번만) */
export function ensureMetaMask(dirs: Pick<MetaMaskEnv, "extensionDir">, log: (text: string) => void = () => undefined, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (installed(dirs.extensionDir)) return Promise.resolve(dirs.extensionDir);
  preparing ??= prepare(dirs.extensionDir, log, env).finally(() => { preparing = null; });
  return preparing;
}

function installed(dir: string): boolean {
  try { return (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { version?: string }).version === METAMASK_VERSION; } catch { return false; }
}

async function prepare(dir: string, log: (text: string) => void, env: NodeJS.ProcessEnv): Promise<string> {
  const local = env["FLOWSMITH_METAMASK_ZIP"]?.trim();
  let zip: Buffer;
  if (local) {
    if (!existsSync(local)) throw new Error(`FLOWSMITH_METAMASK_ZIP의 파일이 없습니다 — ${local}`);
    zip = readFileSync(local);
  } else {
    log(`MetaMask ${METAMASK_VERSION}을(를) 받습니다(처음 한 번 · 약 24MB)`);
    let r: Response;
    try { r = await fetch(RELEASE, { redirect: "follow" }); } catch (e) {
      throw new Error(`MetaMask를 받지 못했습니다(${(e as Error).message}) — 사내망이면 ${RELEASE}을 받아 FLOWSMITH_METAMASK_ZIP으로 주세요`);
    }
    if (!r.ok) throw new Error(`MetaMask를 받지 못했습니다 — HTTP ${r.status} (${RELEASE})`);
    zip = Buffer.from(await r.arrayBuffer());
  }
  const sha = createHash("sha256").update(zip).digest("hex");
  // ★맞지 않으면 쓰지 않는다 — 지갑 키를 다루는 확장이다
  if (sha !== METAMASK_SHA256) throw new Error(`MetaMask 묶음의 SHA256이 맞지 않습니다 — ${sha} (기대 ${METAMASK_SHA256}). 다른 파일이거나 망가졌습니다`);
  const tmp = `${dir}.part`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  new AdmZip(zip).extractAllTo(tmp, true);
  if (!installed(tmp)) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`받은 묶음이 MetaMask ${METAMASK_VERSION}이(가) 아닙니다`); }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, ".."), { recursive: true });
  renameSync(tmp, dir);
  log(`MetaMask ${METAMASK_VERSION} 준비됨 — ${dir}`);
  return dir;
}
