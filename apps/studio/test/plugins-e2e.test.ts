/**
 * «확장» 화면 e2e(2026-10-20, PLAN §41) — 묶음 올리기 → 카드 · 노드 고르기에 보인다 → 새 버전 → 버전 고르기(되돌리기) → 끄기.
 * 게시한 버전과 지금 플러그인 버전이 다르면 편집 화면에 «확장이 바뀌었습니다»가 뜬다.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { generateKey, InProcessWorker, SecretBox, startApp, type App } from "@flowsmith/server";
import { writePackage } from "@flowsmith/worker";

const root = fileURLToPath(new URL("..", import.meta.url));
let app: App;
let browser: Browser;
let page: Page;
let dir: string;
const api = (method: string, path: string, body?: unknown) => fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.json() as Promise<any>);
const fspkg = (version: string) => {
  const file = join(dir, `demo-${version}.fspkg`);
  writeFileSync(file, writePackage({ id: "demo", name: "데모 확장", version, description: "시험용 확장", main: "index.mjs", nodes: ["demo.hello"] },
    new Map([["index.mjs", Buffer.from(`export const extensions = [{ id: "demo.hello", title: "인사하기", description: "인사", options: [], outputs: ["v"], browser: "none", risk: "safe", async run() { return { v: "${version}" }; } }];`)]])));
  return file;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-plugins-ui-"));
  await build({ root, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true } });
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), staticDir: join(dir, "dist"), monitor: false, schedule: false, retention: false,
    plugins: { dir: join(dir, "plugins"), requireSigned: false, keys: [] } });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("«확장» 화면", () => {
  it("★올리기 → 카드 · 새 버전 → 버전 고르기(되돌리기) · 끄기", async () => {
    await page.goto(`${app.url}/#/plugins`);
    await page.getByText("설치된 플러그인이 없습니다").waitFor();
    await page.getByText(/서명 없는 묶음도 받습니다/).waitFor();
    await page.getByLabel("묶음 파일").setInputFiles(fspkg("1.0.0"));
    const card = page.locator('[data-plugin="demo"]');
    await card.getByText("데모 확장").waitFor();
    await page.getByText(/«데모 확장» 1\.0\.0을 올렸습니다/).waitFor();
    expect(await card.getByTitle("지금 쓰는 버전").textContent()).toBe("1.0.0");
    await card.getByText("인사하기").waitFor();

    await page.getByLabel("묶음 파일").setInputFiles(fspkg("1.1.0"));
    await expect.poll(() => card.getByTitle("지금 쓰는 버전").textContent()).toBe("1.1.0");
    await card.getByLabel("버전 고르기").selectOption("1.0.0");
    await expect.poll(() => card.getByTitle("지금 쓰는 버전").textContent()).toBe("1.0.0");
    expect((await api("GET", "/api/plugins")).events[0].action).toBe("rollback");

    await card.getByRole("button", { name: "끄기" }).click();
    await card.getByText("꺼 둠").waitFor();
    expect(await api("GET", "/api/extensions")).toEqual([]);
    await card.getByRole("button", { name: "켜기" }).click();
    await card.getByRole("button", { name: "끄기" }).waitFor();
  });

  it("★게시한 버전과 플러그인 버전이 다르면 편집 화면이 알린다", async () => {
    const draft = { schemaVersion: 1, id: "hello", name: "인사", nodes: [{ id: "x", type: "extension", name: "인사하기", position: { x: 0, y: 0 }, config: { extension: "demo.hello", options: {}, outputs: ["v"] } }], edges: [] };
    await api("POST", "/api/flows", { draft });
    await api("POST", "/api/flows/hello/versions", { note: "" });
    await api("POST", "/api/flows/hello/deploy", { version: 1 });
    await page.goto(`${app.url}/#/flows/hello`);
    await page.getByLabel("워크플로우 이름").waitFor();
    expect(await page.locator(".plugin-drift").count()).toBe(0);
    await api("PUT", "/api/plugins/demo", { version: "1.1.0" });
    await page.reload();
    await page.locator(".plugin-drift").getByText(/확장이 바뀌었습니다/).waitFor();
    expect(await page.locator(".plugin-drift").textContent()).toMatch(/데모 확장 1\.0\.0 → 1\.1\.0/);
  });
});
