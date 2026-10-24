/**
 * 플러그인 묶음(.fspkg) — 모양 · 해시 · 서명 · 풀기 · 싣기(src/plugins.ts, PLAN §41).
 * ★한 바이트만 바뀌어도 걸린다 · 모르는 키 · 서명 없음 · manifest에 없는 파일 · 엔진은 이 프로그램의 것을 쓴다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterAll, describe, expect, it } from "vitest";
import { compareVersions, extractPackage, generateSigningKey, loadPlugin, parseTrustedKeys, readPackage, verifySignature, writePackage } from "../src/plugins.ts";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const CODE = (v: string) => `
import { ExtensionRegistry } from "@flowsmith/engine";
import { join, sep } from "node:path";
export const extensions = [{
  id: "demo.hello", title: "인사", description: "", options: [], outputs: ["v", "host"], browser: "none", risk: "safe",
  async run() { return { v: "${v}", host: typeof ExtensionRegistry === "function" && join("a", "b") === "a" + sep + "b" }; },
}];
`;
const META = { id: "demo", name: "데모", version: "1.0.0", description: "시험", main: "index.mjs", nodes: ["demo.hello"] };
const files = (v = "1") => new Map([["index.mjs", Buffer.from(CODE(v))], ["README.md", Buffer.from("# 데모\n")]]);
const key = generateSigningKey("사내배포");
const trusted = parseTrustedKeys(`# 믿는 키\n${key.publicLine}\n`);

/** zip 안의 한 파일을 바꿔 다시 묶는다 */
function tamper(buf: Buffer, name: string, fn: (b: Buffer) => Buffer): Buffer {
  const z = new AdmZip(buf);
  const e = z.getEntry(name)!;
  z.updateFile(e, fn(e.getData()));
  return z.toBuffer();
}

describe("묶음 — 모양 · 해시 · 서명", () => {
  it("★서명한 묶음 — 믿는 키로 맞는다 · 파일마다 해시가 manifest에", () => {
    const buf = writePackage(META, files(), { name: "사내배포", privatePem: key.privatePem });
    const p = readPackage(buf);
    expect(p.manifest).toMatchObject({ format: 1, api: 1, id: "demo", version: "1.0.0", nodes: ["demo.hello"] });
    expect(Object.keys(p.manifest.files).sort()).toEqual(["README.md", "index.mjs"]);
    expect(p.signature?.key).toBe("사내배포");
    expect(verifySignature(p, trusted)?.name).toBe("사내배포");
    expect(trusted[0]!.fingerprint).toBe(key.fingerprint);
  });

  it("★한 바이트만 바뀌어도 — 파일이면 해시가, manifest면 서명이 걸린다", () => {
    const buf = writePackage(META, files(), { name: "사내배포", privatePem: key.privatePem });
    expect(() => readPackage(tamper(buf, "index.mjs", (b) => Buffer.concat([b, Buffer.from(" ")])))).toThrow(/manifest의 해시와 다릅니다/);
    const m2 = tamper(buf, "manifest.json", (b) => Buffer.from(b.toString().replace('"1.0.0"', '"1.0.1"')));
    expect(() => verifySignature(readPackage(m2), trusted)).toThrow(/서명이 맞지 않습니다/);
  });

  it("모르는 키 · 서명 없음 · manifest에 없는 파일", () => {
    const other = generateSigningKey("남의키");
    const signed = readPackage(writePackage(META, files(), { name: "남의키", privatePem: other.privatePem }));
    expect(() => verifySignature(signed, trusted)).toThrow(/모르는 키로 서명됐습니다\(«남의키»/);
    expect(verifySignature(readPackage(writePackage(META, files())), trusted)).toBeNull();
    const z = new AdmZip(writePackage(META, files()));
    z.addFile("extra.js", Buffer.from("x"));
    expect(() => readPackage(z.toBuffer())).toThrow(/manifest에 없는 파일 «extra.js»/);
  });

  it("manifest — id · 버전 · 노드 이름 · 경로", () => {
    expect(() => writePackage({ ...META, id: "Demo" }, files())).toThrow(/영문 소문자로 시작/);
    expect(() => writePackage({ ...META, version: "1.0" }, files())).toThrow(/1\.2\.3 꼴/);
    expect(() => writePackage({ ...META, nodes: ["other.hello"] }, files())).toThrow(/«demo\.»로 시작해야/);
    expect(() => writePackage(META, new Map([["index.mjs", Buffer.from("")], ["../evil.js", Buffer.from("")]]))).toThrow(/쓸 수 없습니다/);
    expect(() => readPackage(Buffer.from("zip이 아님"))).toThrow(/읽을 수 없습니다/);
  });

  it("버전 견주기 — 숫자로 · 뒤붙이는 앞", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBeLessThan(0);
    expect(["1.0.0", "1.10.0", "1.2.0"].sort(compareVersions)).toEqual(["1.0.0", "1.2.0", "1.10.0"]);
  });

  it("믿는 키 파일 — 틀린 줄은 몇째 줄인지", () => {
    expect(() => parseTrustedKeys("사내배포 이건키가아님!")).toThrow(/1째 줄/);
    expect(parseTrustedKeys("# 비어 있음\n\n")).toEqual([]);
  });
});

describe("풀기 · 싣기", () => {
  it("★풀어서 불러온다 — 엔진은 이 프로그램의 것(플러그인 폴더에 node_modules가 없어도) · 버전마다 새 모듈", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowsmith-plugin-")); dirs.push(root);
    const p1 = readPackage(writePackage(META, files("1")));
    const p2 = readPackage(writePackage({ ...META, version: "1.1.0" }, files("2")));
    extractPackage(p1, join(root, "demo", "1.0.0"));
    extractPackage(p2, join(root, "demo", "1.1.0"));
    const [a] = await loadPlugin(join(root, "demo", "1.0.0"), p1.manifest, p1.sha256);
    const [b] = await loadPlugin(join(root, "demo", "1.1.0"), p2.manifest, p2.sha256);
    const ctx = {} as Parameters<NonNullable<typeof a>["run"]>[0];
    expect(await a!.run(ctx)).toEqual({ v: "1", host: true });
    expect(await b!.run(ctx)).toEqual({ v: "2", host: true });
  });

  it("manifest가 말한 노드가 없으면 싣지 않는다", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowsmith-plugin-")); dirs.push(root);
    const p = readPackage(writePackage({ ...META, nodes: ["demo.hello", "demo.bye"] }, files()));
    extractPackage(p, join(root, "x"));
    await expect(loadPlugin(join(root, "x"), p.manifest, p.sha256)).rejects.toThrow(/demo\.bye가 없습니다/);
  });
});
