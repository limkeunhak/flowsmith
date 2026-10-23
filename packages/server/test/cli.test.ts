/**
 * 서버 명령 — add-worker(화면 없이 워커 토큰 · 도커 컴포즈가 쓴다).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Store } from "../src/storage/store.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "flowsmith-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = (...args: string[]) => execFileSync(process.execPath, [MAIN, ...args, "--data", dir], { encoding: "utf8", env: { ...process.env, HOST: "127.0.0.1" } }).trim();

describe("add-worker", () => {
  it("★토큰만 표준 출력으로 · 다시 하면 새 토큰(옛 것은 무효) · 라벨 · 동시 실행 수", () => {
    const t1 = run("add-worker", "도커 워커 1", "--labels", "docker,chrome", "--slots", "2");
    expect(t1).toMatch(/^fsw_[\w-]+$/);
    const t2 = run("add-worker", "도커 워커 1");
    expect(t2).not.toBe(t1);
    const s = new Store(join(dir, "flowsmith.db"));
    try {
      expect(s.workerByToken(t1)).toBeNull();
      expect(s.workerByToken(t2)).toMatchObject({ name: "도커 워커 1", labels: ["docker", "chrome"], slots: 2 });
      expect(s.listWorkers()).toHaveLength(1);
    } finally { s.close(); }
  }, 30_000);
});
