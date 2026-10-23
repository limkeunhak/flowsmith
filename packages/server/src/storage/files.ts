/**
 * **저장된 파일** — 파일 쓰기 노드가 파일 뿌리(data/files) 아래에 쓴 것을 화면이 보고 · 받고 · 지운다.
 *
 * ★뿌리 밖은 못 본다 — 「..」 · 절대 경로 · 숨은 파일을 막고, 풀어 낸 경로가 뿌리 안인지 한 번 더 본다.
 */
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { toRows, toXlsx, XLSX_TYPE } from "@flowsmith/core";
import { parseCsv } from "@flowsmith/engine";
import { basename, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

export class FilesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FilesError";
    this.status = status;
  }
}

export interface FileEntry {
  name: string;
  /** 뿌리 아래 경로(「flow-a/output-20261015.csv」) */
  path: string;
  kind: "file" | "dir";
  size: number;
  modified: string;
}

const PREVIEW_BYTES = 64 * 1024;
/** 엑셀로 바꿔 줄 수 있는 크기 — 엑셀 한 시트는 104만 행까지다 */
const XLSX_MAX_BYTES = 50 * 1024 * 1024;
/** 엑셀로 바꿔 줄 수 있는 파일 */
export const XLSX_FROM = ["csv", "jsonl", "json"] as const;
const MIME: Record<string, string> = {
  csv: "text/csv; charset=utf-8", jsonl: "application/x-ndjson; charset=utf-8", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8",
};

export class Files {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** 상대 경로 → 절대 경로. ★뿌리 밖이면 던진다 */
  #abs(rel: string): string {
    if (/^[\\/]|^[a-zA-Z]:/.test(rel) || rel.split(/[\\/]/).some((s) => s === ".." || s.startsWith("."))) throw new FilesError(400, "그 경로는 볼 수 없습니다");
    const abs = resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new FilesError(400, "그 경로는 볼 수 없습니다");
    return abs;
  }

  /** 폴더 한 겹 — 폴더가 먼저, 파일은 최근에 바뀐 것부터 */
  async list(dir: string): Promise<{ root: string; dir: string; entries: FileEntry[] }> {
    await mkdir(this.root, { recursive: true });
    const abs = this.#abs(dir);
    const names = await readdir(abs).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return [] as string[]; throw e; });
    const entries: FileEntry[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const s = await stat(resolve(abs, name)).catch(() => null);
      if (!s) continue;
      entries.push({ name, path: dir ? `${dir}/${name}` : name, kind: s.isDirectory() ? "dir" : "file", size: s.size, modified: s.mtime.toISOString() });
    }
    entries.sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : b.modified.localeCompare(a.modified)));
    return { root: this.root, dir, entries };
  }

  async #file(rel: string): Promise<{ abs: string; size: number }> {
    const abs = this.#abs(rel);
    const s = await stat(abs).catch(() => null);
    if (!s || !s.isFile()) throw new FilesError(404, "없는 파일입니다");
    return { abs, size: s.size };
  }

  /** 앞부분만 — 큰 파일도 화면이 바로 보게 */
  async preview(rel: string): Promise<{ path: string; size: number; text: string; truncated: boolean }> {
    const { abs, size } = await this.#file(rel);
    const fh = await open(abs, "r");
    try {
      const buf = Buffer.alloc(Math.min(size, PREVIEW_BYTES));
      await fh.read(buf, 0, buf.length, 0);
      let text = buf.toString("utf8");
      if (size > PREVIEW_BYTES) text = text.replace(/[^\n]*$/, "");   // 잘린 마지막 줄은 버린다
      return { path: rel, size, text: text.replace(/^﻿/, ""), truncated: size > PREVIEW_BYTES };
    } finally {
      await fh.close();
    }
  }

  async download(rel: string, res: ServerResponse): Promise<void> {
    const { abs, size } = await this.#file(rel);
    const name = basename(abs);
    const ext = name.split(".").pop() ?? "";
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-length": size,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    });
    await new Promise<void>((ok, fail) => createReadStream(abs).on("error", fail).on("end", () => ok()).pipe(res));
  }

  /**
   * 엑셀로 내려받기 — 파일 쓰기 노드가 쓴 CSV(머리줄) · JSON Lines · JSON을 표로 읽어 .xlsx로.
   * ★파일은 그대로 둔다 — 바꿔서 보내기만 한다
   */
  async downloadXlsx(rel: string, res: ServerResponse): Promise<void> {
    const { abs, size } = await this.#file(rel);
    const name = basename(abs);
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    if (!(XLSX_FROM as readonly string[]).includes(ext)) throw new FilesError(400, `${ext || "이"} 파일은 엑셀로 바꿀 수 없습니다 — CSV · JSON Lines · JSON만`);
    if (size > XLSX_MAX_BYTES) throw new FilesError(413, "파일이 너무 커서 엑셀로 바꾸지 못합니다(50MB까지) — 원본을 내려받으세요");
    const text = (await readFile(abs, "utf8")).replace(/^\uFEFF/, "");
    let rows: Record<string, unknown>[];
    try {
      if (ext === "csv") {
        const [head = [], ...body] = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
        rows = body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
      } else if (ext === "jsonl") rows = toRows(text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l)));
      else rows = toRows(text.trim() === "" ? [] : JSON.parse(text));
    } catch { throw new FilesError(422, `${name}을(를) 표로 읽지 못했습니다 — 원본을 내려받으세요`); }
    const bytes = toXlsx([{ name: name.replace(/\.[^.]+$/, ""), rows }]);
    const out = name.replace(/\.[^.]+$/, "") + ".xlsx";
    res.writeHead(200, {
      "content-type": XLSX_TYPE, "content-length": bytes.length,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out)}`, "cache-control": "no-store",
    });
    res.end(Buffer.from(bytes));
  }

  async remove(rel: string): Promise<void> {
    const { abs } = await this.#file(rel);
    await rm(abs);
  }
}
