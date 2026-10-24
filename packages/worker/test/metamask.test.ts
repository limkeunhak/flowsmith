/**
 * MetaMask 준비 — 이 PC의 지갑 폴더 · 화면이 있나 · 받은 묶음의 SHA256(PLAN §44). 진짜로 받지는 않는다.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { METAMASK_VERSION } from "@flowsmith/core";
import { InProcessWorker } from "../src/index.ts";
import { ensureMetaMask, hasDisplay, walletDirs } from "../src/metamask.ts";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe("지갑 폴더", () => {
  it("★Windows는 %LOCALAPPDATA%\\Flowsmith · 그 밖은 ~/.cache/flowsmith · FLOWSMITH_WALLET_DIR가 이긴다", () => {
    expect(walletDirs({ LOCALAPPDATA: "C:\\Users\\kim\\AppData\\Local" }, "win32").root).toBe(join("C:\\Users\\kim\\AppData\\Local", "Flowsmith"));
    expect(walletDirs({ XDG_CACHE_HOME: "/tmp/c" }, "linux")).toEqual({ root: join("/tmp/c", "flowsmith"), extensionDir: join("/tmp/c", "flowsmith", "mm", METAMASK_VERSION), profilesRoot: join("/tmp/c", "flowsmith", "w") });
    expect(walletDirs({ FLOWSMITH_WALLET_DIR: "D:\\fsw", LOCALAPPDATA: "C:\\x" }, "win32").profilesRoot).toBe(join("D:\\fsw", "w"));
  });
  it("화면 — Windows · 맥은 늘 · 리눅스는 DISPLAY · WAYLAND_DISPLAY가 있을 때", () => {
    expect(hasDisplay({}, "win32")).toBe(true);
    expect(hasDisplay({}, "linux")).toBe(false);
    expect(hasDisplay({ DISPLAY: ":0" }, "linux")).toBe(true);
    expect(hasDisplay({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
  });
  it("★창 없는 워커는 지갑 브라우저를 할 수 있다고 하지 않는다", () => {
    expect(new InProcessWorker({ headless: true }).capabilities).toEqual([]);
  });
});

describe("받은 묶음 확인", () => {
  it("★SHA256이 다르면 쓰지 않는다 · 없는 파일은 그 경로를 말한다", async () => {
    const d = mkdtempSync(join(tmpdir(), "flowsmith-mm-")); dirs.push(d);
    const zip = join(d, "fake.zip");
    writeFileSync(zip, "PK not really a zip");
    await expect(ensureMetaMask({ extensionDir: join(d, "mm") }, () => undefined, { FLOWSMITH_METAMASK_ZIP: zip })).rejects.toThrow(/SHA256이 맞지 않습니다/);
    await expect(ensureMetaMask({ extensionDir: join(d, "mm2") }, () => undefined, { FLOWSMITH_METAMASK_ZIP: join(d, "none.zip") })).rejects.toThrow(/파일이 없습니다 — .*none\.zip/);
  });
});
