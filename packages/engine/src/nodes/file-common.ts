/**
 * 파일 노드(쓰기 · 읽기)가 함께 쓰는 것 — 파일 뿌리 · 오류 · CSV 읽고 쓰기.
 * ★파일은 파일 뿌리(data/files) 아래에만 — 이 플로우 폴더(<uuid>) · 공유 폴더(shared) · 다른 플로우의 폴더.
 * 실제로 다루는 것은 `FileOps` — 서버에서는 디스크, PC 워커에서는 서버에 맡긴다(2026-10-17).
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { zipIncludes } from "@flowsmith/core";
import { writeZip, ZipLimitError } from "../zip.ts";

export interface FileStoreOptions {
  /** 파일 뿌리 — 파일 쓰기 노드는 이 아래에만 쓴다(ops가 없을 때 이 PC의 디스크) */
  root?: string;
  /**
   * 파일을 다루는 곳 — 없으면 root 아래 이 PC의 디스크. PC 워커는 서버에 맡긴다(파일은 늘 서버에 남는다).
   * ★경로는 뿌리 아래 상대 경로(「<uuid>/하위/이름」) — 노드가 먼저 확인하고, 다루는 쪽이 한 번 더 확인한다
   */
  ops?: FileOps;
  /** 이 플로우의 폴더 이름(서버가 붙인 uuid) — «이 플로우 폴더»에 쓸 때 */
  flowUid?: string;
  /** 다른 플로우의 폴더 이름들(플로우 id → uuid) — 파일 읽기가 «다른 플로우의 폴더»를 읽을 때. 서버가 채운다 */
  flowUids?: Record<string, string>;
}

export const UID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface FileStat { size: number; mtimeMs: number; isFile: boolean }

/** 파일 다루기 — 경로는 모두 뿌리 아래 상대 경로(「/」로). 없으면 list는 [], read · stat은 null */
export interface FileOps {
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string | null>;
  /** 폴더가 없으면 만든다 */
  write(path: string, text: string): Promise<void>;
  /** 바이트 그대로 — «파일로 저장»(PDF 같은 것). 폴더가 없으면 만든다 */
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  /**
   * 압축(PLAN §52) — srcDir 아래 파일들(include glob · 비우면 모두)을 dest에 zip으로. 파일이 있는 곳에서 한다(PC 워커는 서버에 맡긴다).
   * 결과 zip 자신 · 쓰다 만 것(.part)은 묶지 않는다 · 쓰다 실패하면 남기지 않는다
   */
  zip(srcDir: string, include: string[], dest: string, ifExists: "overwrite" | "fail"): Promise<{ count: number; bytes: number }>;
  append(path: string, text: string): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
  remove(path: string): Promise<void>;
}

/** 뿌리 아래 상대 경로로 고른다 — 뿌리 밖(「..」 · 절대 경로 · 빈 경로)이면 null */
export function rootedPath(rel: string): string | null {
  if (typeof rel !== "string" || rel === "" || rel.includes("\0") || rel.includes("\\") || posix.isAbsolute(rel)) return null;
  const n = posix.normalize(rel);
  if (n === "." || n === ".." || n.startsWith("../")) return null;
  return n.replace(/\/$/, "");
}

/** 이 PC의 디스크 — root 아래에만 */
export function localFileOps(root: string): FileOps {
  const base = resolve(root);
  const abs = (rel: string): string => {
    const r = rootedPath(rel);
    const p = r === null ? null : resolve(base, r);
    if (p === null || !p.startsWith(base + sep)) throw new FileStoreError(`「${rel}」는 파일 뿌리 밖입니다`);
    return p;
  };
  const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR";
  return {
    list: (dir) => readdir(abs(dir)).catch((e) => { if (missing(e)) return []; throw e; }),
    read: (path) => readFile(abs(path), "utf8").catch((e) => { if (missing(e)) return null; throw e; }),
    write: async (path, text) => { const p = abs(path); await mkdir(dirname(p), { recursive: true }); await writeFile(p, text, "utf8"); },
    writeBytes: async (path, data) => { const p = abs(path); await mkdir(dirname(p), { recursive: true }); await writeFile(p, data); },
    zip: async (srcDir, include, dest, ifExists) => {
      const src = abs(srcDir);
      const d = abs(dest);
      const there = await stat(src).catch(() => null);
      if (!there?.isDirectory()) throw new FileStoreError(`묶을 폴더 「${srcDir}」가 없습니다`);
      if (ifExists === "fail" && (await stat(d).catch(() => null))) throw new FileStoreError(`「${dest}」가 이미 있습니다 — 덮어쓰려면 «이미 있으면»을 «덮어쓰기»로`);
      const part = `${d}.part`;
      const names = (await readdir(src, { recursive: true })).map((n) => String(n).split(sep).join("/")).sort();
      const entries = [];
      for (const name of names) {
        const full = resolve(src, name);
        if (full === d || full === part || name.endsWith(".part") || !zipIncludes(include, name)) continue;
        const st = await stat(full).catch(() => null);
        if (!st?.isFile()) continue;
        entries.push({ name, mtime: st.mtime, read: () => readFile(full) });
      }
      if (entries.length === 0) throw new FileStoreError(`「${srcDir}」에 묶을 파일이 없습니다${include.length ? ` — 포함 규칙 ${include.join(" · ")}` : ""}`);
      await mkdir(dirname(d), { recursive: true });
      try {
        const r = await writeZip(part, entries);
        await rename(part, d);
        return r;
      } catch (e) {
        await rm(part, { force: true }).catch(() => undefined);
        if (e instanceof ZipLimitError) throw new FileStoreError(e.message);
        throw e;
      }
    },
    append: async (path, text) => { const p = abs(path); await mkdir(dirname(p), { recursive: true }); await appendFile(p, text, "utf8"); },
    stat: (path) => stat(abs(path)).then((s) => ({ size: s.size, mtimeMs: s.mtimeMs, isFile: s.isFile() }), (e) => { if (missing(e)) return null; throw e; }),
    remove: (path) => rm(abs(path)),
  };
}

/** 노드가 쓸 파일 다루기 — ops가 있으면 그것, 없으면 root 아래 디스크 */
export function opsOf(files: FileStoreOptions): FileOps {
  if (files.ops) return files.ops;
  if (!files.root) throw new FileStoreError("파일 뿌리가 정해지지 않았습니다 — 서버에서 돌리세요");
  return localFileOps(files.root);
}

export class FileStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileStoreError";
  }
}

const BOM = "\uFEFF";
const cellText = (v: unknown): string =>
  v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

// ─── CSV ────────────────────────────────────────────────────────────

export function csvCell(v: unknown): string {
  const s = cellText(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV를 줄 · 칸으로 — 따옴표 안의 쉼표 · 줄바꿈 · 「""」를 안다 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
