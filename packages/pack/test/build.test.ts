/**
 * flowsmith-ext build — 확장 폴더를 묶음(.fspkg)으로(PLAN §41).
 * ★확장 폴더(CJS 의존성 adm-zip을 쓴다)를 JS 하나로 묶어 불러온다 · 엔진 · Playwright는 묶지 않는다 · 서명 · index.json.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { extractPackage, generateSigningKey, loadPlugin, parseTrustedKeys, readPackage, verifySignature } from "@flowsmith/worker";
import { buildPlugin, indexOf } from "../src/index.ts";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "flowsmith-ext-")); dirs.push(d); return d; };
/** 이 폴더에는 node_modules가 없다 — adm-zip은 워커 패키지의 것을 찾게 이어 둔다(rolldown이 위로 올라가며 찾는다) */
const linkAdmZip = (d: string) => { mkdirSync(join(d, "node_modules")); symlinkSync(join(repo, "packages/worker/node_modules/adm-zip"), join(d, "node_modules/adm-zip")); };

describe("flowsmith-ext build", () => {
  it("★주문 확장 — 서명 · 풀어서 불러오면 노드 두 개", async () => {
    const d = tmp();
    mkdirSync(join(d, "src"));
    writeFileSync(join(d, "src/index.ts"), `import AdmZip from "adm-zip";\nimport type { Extension } from "@flowsmith/engine";\n`
      + `const node = (id: string, title: string): Extension => ({ id, title, description: "", options: [{ name: "orderNo", label: "주문번호", required: true }], outputs: ["values"], browser: "attach", risk: "safe",\n`
      + `  run: async (ctx) => { const z = new AdmZip(); z.addFile("order.txt", Buffer.from(String(ctx.options["orderNo"]))); return { values: { orderNo: z.readAsText("order.txt") } }; } });\n`
      + `export const extensions: Extension[] = [node("shop.order-read", "주문 읽기"), node("shop.order-write", "주문 넣기")];\n`);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "@flowsmith/ext-shop", version: "1.0.0", description: "사내 주문 시스템 읽기 · 넣기", flowsmith: { id: "shop", name: "사내 주문 시스템", main: "src/index.ts" } }));
    linkAdmZip(d);
    const key = generateSigningKey("사내배포");
    const built = await buildPlugin(d, { signer: { name: "사내배포", privatePem: key.privatePem } });
    expect(built.name).toMatch(/^shop-\d+\.\d+\.\d+\.fspkg$/);
    expect(built.manifest.nodes).toEqual(["shop.order-read", "shop.order-write"]);
    const pkg = readPackage(built.file);
    expect(verifySignature(pkg, parseTrustedKeys(key.publicLine))?.name).toBe("사내배포");
    expect(pkg.files.get("index.mjs")!.toString()).not.toMatch(/from "adm-zip"/);   // CJS 의존성을 묶었다
    const dir = join(tmp(), "shop");
    extractPackage(pkg, dir);
    const exts = await loadPlugin(dir, pkg.manifest, pkg.sha256);
    expect(exts.map((e) => [e.id, e.browser])).toEqual([["shop.order-read", "attach"], ["shop.order-write", "attach"]]);
    expect(await exts[0]!.run({ options: { orderNo: "A-1001" } } as unknown as Parameters<NonNullable<(typeof exts)[0]>["run"]>[0])).toEqual({ values: { orderNo: "A-1001" } });
  }, 120_000);

  it("★의존성은 묶고(CJS도) 엔진 · Playwright는 묶지 않는다", async () => {
    const d = tmp();
    mkdirSync(join(d, "src"));
    writeFileSync(join(d, "src/index.ts"), `import AdmZip from "adm-zip";\nimport { chromium } from "playwright";\nimport type { Extension } from "@flowsmith/engine";\n`
      + `export const extensions: Extension[] = [{ id: "zipper.count", title: "묶음 세기", description: "", options: [], outputs: ["n", "pw"], browser: "none", risk: "safe",\n`
      + `  run: async () => { const z = new AdmZip(); z.addFile("a.txt", Buffer.from("a")); return { n: z.getEntries().length, pw: typeof chromium.launch === "function" }; } }];\n`);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "zipper", version: "0.1.0", flowsmith: { id: "zipper" } }));
    linkAdmZip(d);
    const built = await buildPlugin(d);
    const pkg = readPackage(built.file);
    const code = pkg.files.get("index.mjs")!.toString();
    expect(code).toMatch(/from "playwright"/);          // 묶지 않았다
    expect(code).not.toMatch(/from "adm-zip"/);         // 묶었다
    const dir = join(tmp(), "zipper");
    extractPackage(pkg, dir);
    const [ext] = await loadPlugin(dir, pkg.manifest, pkg.sha256);
    expect(await ext!.run({} as Parameters<NonNullable<typeof ext>["run"]>[0])).toEqual({ n: 1, pw: true });
  }, 120_000);

  it("노드 id는 «<id>.»로 · package.json의 flowsmith 칸 · version", async () => {
    const d = tmp();
    mkdirSync(join(d, "src"));
    writeFileSync(join(d, "src/index.ts"), `import { helper } from "./helper.ts";\nexport const extensions = [{ id: "other.x", title: "x", description: "", options: [], outputs: [], browser: "none", risk: "safe", run: async () => ({ v: helper() }) }];\n`);
    writeFileSync(join(d, "src/helper.ts"), "export const helper = (): number => 1;\n");
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    await expect(buildPlugin(d)).rejects.toThrow(/«flowsmith» 칸이 없습니다/);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", version: "1.0", flowsmith: { id: "demo" } }));
    await expect(buildPlugin(d)).rejects.toThrow(/1\.2\.3 꼴/);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", flowsmith: { id: "demo" } }));
    await expect(buildPlugin(d)).rejects.toThrow(/«demo\.»로 시작해야/);
    writeFileSync(join(d, "src/index.ts"), `import { helper } from "./helper.ts";\nexport const extensions = [{ id: "demo.x", title: "x", description: "", options: [], outputs: ["v"], browser: "none", risk: "safe", run: async () => ({ v: helper() }) }];\n`);
    const b = await buildPlugin(d);
    expect(b.manifest).toMatchObject({ id: "demo", name: "demo", version: "1.0.0", nodes: ["demo.x"] });
    expect(readPackage(b.file).signature).toBeNull();
  }, 60_000);

  it("index — 폴더의 묶음마다 한 줄(해시 · 서명한 키)", async () => {
    const d = tmp();
    mkdirSync(join(d, "src"));
    writeFileSync(join(d, "src/index.ts"), `export const extensions = [{ id: "demo.x", title: "x", description: "", options: [], outputs: [], browser: "none", risk: "safe", run: async () => ({}) }];\n`);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", version: "2.0.0", description: "데모", flowsmith: { id: "demo", name: "데모" } }));
    const repoDir = tmp();
    const b = await buildPlugin(d);
    writeFileSync(join(repoDir, b.name), b.file);
    const idx = indexOf(repoDir);
    expect(idx.plugins).toEqual([expect.objectContaining({ id: "demo", name: "데모", version: "2.0.0", description: "데모", file: "demo-2.0.0.fspkg", nodes: ["demo.x"], signer: null, size: b.file.length })]);
    expect(idx.plugins[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
