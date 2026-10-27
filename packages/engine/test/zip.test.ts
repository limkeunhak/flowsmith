/**
 * 압축(zip) 노드(PLAN §52) — 폴더의 파일들을 zip 하나로. 직접 풀어 내용 · CRC를 보고, 시스템 unzip이 있으면 그것으로도 연다.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globToRegExp, parseFlow, zipIncludes } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";

let root: string;
const UID = "zipflow";
const dir = () => join(root, UID);

/** zip을 푼다 — 중앙 목록을 따라 이름 · 방식 · 내용(CRC 확인) */
function unzip(buf: Buffer): { name: string; method: number; utf8: boolean; data: Buffer }[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(at + 26), lxlen = buf.readUInt16LE(at + 28);
    const raw = buf.subarray(at + 30 + lnlen + lxlen, at + 30 + lnlen + lxlen + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    expect(crc32(data) >>> 0).toBe(crc);
    out.push({ name, method, utf8: (flags & 0x0800) !== 0, data });
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const zipFlow = (config: Record<string, unknown>) => parseFlow({
  schemaVersion: 1, id: "z", name: "z", params: [{ name: "day", label: "날", required: false, type: "text", default: "20261027" }],
  nodes: [{ id: "z", type: "zip", name: "묶기", position: { x: 0, y: 0 }, config }], edges: [],
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "fs-zip-"));
  mkdirSync(join(dir(), "pdf", "[서비스 파트]", "운영"), { recursive: true });
  writeFileSync(join(dir(), "pdf", "[서비스 파트].pdf"), "%PDF-1.4 root");
  writeFileSync(join(dir(), "pdf", "[서비스 파트]", "운영", "장애 대응.pdf"), "%PDF-1.4 " + "x".repeat(5000));
  writeFileSync(join(dir(), "pdf", "[서비스 파트]", "목록.csv"), "id,title\n" + "1,가\n".repeat(500));
  writeFileSync(join(dir(), "pdf", "쓰다만.pdf.part"), "x");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("압축(zip) 노드", () => {
  it("★폴더를 묶는다 — 한글 이름(UTF-8 표시) · 하위 폴더 · PDF는 그대로 · CSV는 눌러서 · .part는 빼고 · 출력", async () => {
    const r = await runFlow(zipFlow({ from: { dir: "pdf" }, to: { dir: "", name: "서비스파트-{{ $params.day }}" } }), { files: { root, flowUid: UID } });
    expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
    expect(r.output).toMatchObject({ file: `${UID}/서비스파트-20261027.zip`, count: 3 });
    const z = unzip(readFileSync(join(dir(), "서비스파트-20261027.zip")));
    expect(z.map((e) => e.name)).toEqual(["[서비스 파트].pdf", "[서비스 파트]/목록.csv", "[서비스 파트]/운영/장애 대응.pdf"]);
    expect(z.every((e) => e.utf8)).toBe(true);
    expect(z.find((e) => e.name.endsWith("장애 대응.pdf"))!.method).toBe(0);
    expect(z.find((e) => e.name.endsWith("목록.csv"))!.method).toBe(8);
    expect(z[2]!.data.toString()).toBe("%PDF-1.4 " + "x".repeat(5000));
    expect(existsSync(join(dir(), "서비스파트-20261027.zip.part"))).toBe(false);
    expect(r.nodes[0]!.logs.join("\n")).toMatch(/3개를 묶었습니다/);
    // 시스템 unzip이 있으면 그것으로도 연다
    try { execFileSync("unzip", ["-tq", join(dir(), "서비스파트-20261027.zip")]); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  });

  it("포함 규칙 · 결과를 묶을 폴더 안에 두어도 자신은 빼고 · 이미 있으면 멈추기", async () => {
    const r = await runFlow(zipFlow({ from: { dir: "", include: ["**/*.pdf"] }, to: { dir: "", name: "pdf만" } }), { files: { root, flowUid: UID } });
    expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
    const z = unzip(readFileSync(join(dir(), "pdf만.zip")));
    expect(z.map((e) => e.name)).toEqual(["pdf/[서비스 파트].pdf", "pdf/[서비스 파트]/운영/장애 대응.pdf"]);
    // 다시 — 이번에는 자기 자신(pdf만.zip)도 폴더에 있지만 묶지 않는다
    const again = await runFlow(zipFlow({ from: { dir: "" }, to: { dir: "", name: "pdf만" } }), { files: { root, flowUid: UID } });
    expect(unzip(readFileSync(join(dir(), "pdf만.zip"))).map((e) => e.name)).not.toContain("pdf만.zip");
    expect(again.status).toBe("success");
    const fail = await runFlow(zipFlow({ from: { dir: "pdf" }, to: { dir: "", name: "pdf만" }, ifExists: "fail" }), { files: { root, flowUid: UID } });
    expect(fail.nodes[0]!.failure!.message).toMatch(/이미 있습니다/);
  });

  it("묶을 것이 없으면 · 폴더가 없으면 · 뿌리 밖이면 멈춘다", async () => {
    const none = await runFlow(zipFlow({ from: { dir: "pdf", include: ["*.png"] }, to: { name: "x" } }), { files: { root, flowUid: UID } });
    expect(none.nodes[0]!.failure!.message).toMatch(/묶을 파일이 없습니다 — 포함 규칙 \*\.png/);
    const missing = await runFlow(zipFlow({ from: { dir: "없음" }, to: { name: "x" } }), { files: { root, flowUid: UID } });
    expect(missing.nodes[0]!.failure!.message).toMatch(/묶을 폴더 「.*없음」가 없습니다/);
    expect(() => zipFlow({ from: { dir: "../밖" }, to: { name: "x" } })).toThrow(/「\.\.」/);
  });

  it("glob — ** 는 폴더를 넘고 * · ? 는 한 마디 · 대소문자 무시", () => {
    expect(globToRegExp("**/*.pdf").test("a/b/c.pdf")).toBe(true);
    expect(globToRegExp("**/*.pdf").test("c.pdf")).toBe(true);
    expect(globToRegExp("*.pdf").test("a/c.pdf")).toBe(false);
    expect(globToRegExp("a/?.txt").test("a/1.txt")).toBe(true);
    expect(zipIncludes(["*.PDF"], "x.pdf")).toBe(true);
    expect(zipIncludes([], "무엇이든")).toBe(true);
  });
});
