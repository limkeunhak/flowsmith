/**
 * **파일 쓰기 노드 — 로컬 파일** (core nodes/file.ts).
 *
 *   csv    엑셀이 여는 표. 머리줄 · BOM(엑셀 한글) · 열 순서. 이어 붙일 때는 **있는 파일의 머리줄**을 따른다
 *   jsonl  한 줄에 하나(JSON). 이어 붙이기 쉽고 다른 프로그램이 읽기 쉽다
 *   json   배열 하나. 이어 붙이면 파일 전체를 다시 쓴다
 *   text   한 줄에 하나 — 글자는 그대로, 객체는 값들을 탭으로
 *
 * 폴더: 파일 뿌리/<플로우 uuid>/<하위 폴더> · 공유면 파일 뿌리/shared/<하위 폴더>.
 * ★파일은 **파일 뿌리(data/files) 아래에만** 쓴다. 폴더 · 이름은 검문소가 먼저 막고, 여기서 한 번 더 경로를 확인한다.
 * ★같은 파일에 두 실행이 동시에 쓰지 않게 파일마다 줄을 세운다(이 프로세스 안에서).
 * ★쓸 것이 없으면(빈 목록) 파일을 만들지 않는다.
 */
import {
  badDir, badFileName, belongsTo, evaluate, fileNameFor, seqOf, SHARED_DIR,
  type FileStoreTarget, type Output, type Scope, type FileWriteNode,
} from "@flowsmith/core";
import { csvCell, FileStoreError, opsOf, parseCsv, rootedPath, UID_RE, type FileOps, type FileStoreOptions } from "./file-common.ts";
export { FileStoreError, localFileOps, parseCsv, rootedPath, UID_RE, type FileOps, type FileStat, type FileStoreOptions } from "./file-common.ts";

/** 파일 쓰기 노드의 폴더(뿌리 아래 상대 경로) — 이 플로우 폴더 · 공유 폴더 */
export function scopeDir(t: FileStoreTarget, files: FileStoreOptions): string {
  let base: string;
  if (t.scope === "shared") base = SHARED_DIR;
  else {
    if (!files.flowUid || !UID_RE.test(files.flowUid) || files.flowUid === SHARED_DIR) throw new FileStoreError("이 워크플로우의 폴더(uuid)를 모릅니다 — 서버에 등록된 워크플로우로 돌리세요");
    base = files.flowUid;
  }
  return t.dir ? `${base}/${t.dir}` : base;
}

type Rec = Record<string, unknown>;
const BOM = "﻿";

/** 같은 파일에 쓰는 것을 줄 세운다 */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(path) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(path, next.catch(() => undefined));
  try { return await next; } finally { if (locks.get(path) === next) locks.delete(path); }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** 서버 시각 — 「2026-10-15 18:00:05」 */
export const localStamp = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** 저장할 값을 줄들로 — 목록이면 항목마다, 객체 하나면 한 줄, 글자 · 숫자면 그것 하나 */
function toRecords(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null);
  return [v];
}

const asRec = (x: unknown): Rec => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : { value: x });

const cellText = (v: unknown): string =>
  v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

// ─── 어느 파일에 ────────────────────────────────────────────────────

async function countRows(fs: FileOps, path: string, t: FileStoreTarget): Promise<number> {
  const text = (await fs.read(path).catch(() => null)) ?? "";
  if (t.format === "json") { try { const a = JSON.parse(text); return Array.isArray(a) ? a.length : 0; } catch { return 0; } }
  if (t.format === "csv") return Math.max(0, parseCsv(text).length - (t.csv.header ? 1 : 0));
  return text.split("\n").filter((l) => l !== "").length;
}

/** 이번에 쓸 파일 — 번호 롤링은 폴더를 보고 정한다 */
async function pickFile(fs: FileOps, dir: string, t: FileStoreTarget, now: Date, incoming: number): Promise<{ name: string; note: string | null }> {
  if (t.rolling.kind !== "sequence") return { name: fileNameFor(t, now), note: null };
  const names = await fs.list(dir);
  const last = Math.max(0, ...names.map((n) => seqOf(t, n) ?? 0));
  if (last === 0) return { name: fileNameFor(t, now, 1), note: null };
  const r = t.rolling;
  const lastName = fileNameFor(t, now, last);
  if (r.every === "run") return { name: fileNameFor(t, now, last + 1), note: null };
  const limit = r.limit ?? Infinity;
  if (r.every === "bytes") {
    const size = (await fs.stat(`${dir}/${lastName}`))?.size ?? 0;
    return size >= limit ? { name: fileNameFor(t, now, last + 1), note: `${lastName}이 ${size}바이트라 다음 번호로` } : { name: lastName, note: null };
  }
  const rows = await countRows(fs, `${dir}/${lastName}`, t);
  if (rows > 0 && rows + incoming > limit) return { name: fileNameFor(t, now, last + 1), note: `${lastName}에 ${rows}행 — 더하면 ${limit}행을 넘어 다음 번호로` };
  return { name: lastName, note: null };
}

// ─── 쓰기 ───────────────────────────────────────────────────────────

/** 이미 있는 키들 — 이어 붙일 때 겹치는 것을 건너뛰려고 */
function keysIn(text: string, t: FileStoreTarget, key: string): Set<string> {
  const out = new Set<string>();
  if (t.format === "csv") {
    const rows = parseCsv(text);
    const head = t.csv.header ? rows[0] ?? [] : (t.csv.columns ?? []);
    const i = head.indexOf(key);
    if (i >= 0) for (const r of rows.slice(t.csv.header ? 1 : 0)) out.add(r[i] ?? "");
  } else if (t.format === "jsonl") {
    for (const line of text.split("\n")) { if (!line.trim()) continue; try { out.add(cellText(asRec(JSON.parse(line))[key])); } catch { /* 깨진 줄은 건너뛴다 */ } }
  } else if (t.format === "json") {
    try { const a = JSON.parse(text); if (Array.isArray(a)) for (const x of a) out.add(cellText(asRec(x)[key])); } catch { /* 빈 파일 */ }
  } else {
    for (const line of text.split("\n")) if (line !== "") out.add(line);
  }
  return out;
}

const textLine = (x: unknown): string => {
  if (x !== null && typeof x === "object" && !Array.isArray(x)) return Object.values(x as Rec).map(cellText).join("\t").replace(/\r?\n/g, " ");
  return cellText(x).replace(/\r?\n/g, " ");
};

/**
 * 파일 쓰기 노드를 돈다. 돌려주는 것: { file: 뿌리 아래 경로, written: 쓴 줄 수, skipped: 겹쳐서 건너뛴 수 }
 */
export async function runFileWriteNode(node: FileWriteNode, scope: Scope, files: FileStoreOptions | undefined, log: (text: string) => void, now = new Date()): Promise<Output> {
  const t = node.config.target;
  if (!files) throw new FileStoreError("파일을 저장할 곳(파일 뿌리)이 정해지지 않았습니다 — 서버에서 돌리세요");
  const bad = badDir(t.dir) ?? badFileName(t.name);
  if (bad) throw new FileStoreError(bad);
  const fs = opsOf(files);
  const dir = rootedPath(scopeDir(t, files));
  if (dir === null) throw new FileStoreError(`폴더 「${t.dir}」가 파일 뿌리 밖을 가리킵니다`);

  const value = evaluate(node.config.data, { ...scope, secrets: {} }).value;
  if (value === undefined) throw new FileStoreError(`저장할 값이 없습니다 — ${node.config.data}`);
  let items = toRecords(value);
  const stamp = localStamp(now);
  if (t.stampColumn && t.format !== "text") items = items.map((x) => ({ ...asRec(x), [t.stampColumn!]: stamp }));

  const { name, note } = await pickFile(fs, dir, t, now, items.length);
  if (note) log(note);
  const path = `${dir}/${name}`;
  const rel = path;

  const result = await withLock(path, async () => {
    const before = await fs.stat(path);
    const append = t.mode === "append" && before !== null && before.size > 0;
    const old = append ? (await fs.read(path)) ?? "" : "";

    // 겹치는 것 건너뛰기 — 이 파일에 이미 있는 것 · 이번 묶음 안에서 겹치는 것
    let skipped = 0;
    if (t.dedupeKey) {
      const key = t.dedupeKey;
      const seen = append ? keysIn(old, t, key) : new Set<string>();
      const keyOf = (x: unknown) => (t.format === "text" ? textLine(x) : cellText(asRec(x)[key]));
      const kept: unknown[] = [];
      for (const x of items) {
        const k = keyOf(x);
        if (k !== "" && seen.has(k)) { skipped++; continue; }
        seen.add(k);
        kept.push(x);
      }
      items = kept;
    }
    const out = { file: rel, written: items.length, skipped };
    if (items.length === 0) {
      log(skipped > 0 ? `${rel} — 새로 쓸 것이 없습니다(${skipped}개는 이미 있음)` : "쓸 것이 없습니다 — 파일을 건드리지 않았습니다");
      return out;
    }
    const sepIfNeeded = append && !old.endsWith("\n") ? "\n" : "";

    switch (t.format) {
      case "csv": {
        const recs = items.map(asRec);
        let columns: string[];
        const existingHead = append && t.csv.header ? parseCsv(old)[0] : undefined;
        if (existingHead && existingHead.length) columns = existingHead;
        else if (t.csv.columns) columns = t.csv.columns;
        else {
          const seen = new Set<string>();
          for (const r of recs) for (const k of Object.keys(r)) seen.add(k);
          columns = [...seen];
        }
        const dropped = new Set<string>();
        for (const r of recs) for (const k of Object.keys(r)) if (!columns.includes(k)) dropped.add(k);
        if (dropped.size) log(`열에 없는 값은 쓰지 않았습니다 — ${[...dropped].join(", ")}${existingHead ? " (있는 파일의 머리줄을 따릅니다)" : ""}`);
        const body = recs.map((r) => columns.map((c) => csvCell(r[c])).join(",")).join("\r\n") + "\r\n";
        if (append) await fs.append(path, (sepIfNeeded ? "\r\n" : "") + body);
        else await fs.write(path, (t.csv.bom ? BOM : "") + (t.csv.header ? columns.map(csvCell).join(",") + "\r\n" : "") + body);
        break;
      }
      case "jsonl": {
        const body = items.map((x) => JSON.stringify(x)).join("\n") + "\n";
        if (append) await fs.append(path, sepIfNeeded + body);
        else await fs.write(path, body);
        break;
      }
      case "json": {
        let all: unknown[] = items;
        if (append) {
          let prev: unknown;
          try { prev = JSON.parse(old); } catch { throw new FileStoreError(`${rel}이 JSON 배열이 아니라 이어 붙일 수 없습니다 — 덮어쓰기로 바꾸거나 파일을 옮기세요`); }
          all = [...(Array.isArray(prev) ? prev : [prev]), ...items];
        }
        await fs.write(path, JSON.stringify(all, null, 2) + "\n");
        break;
      }
      case "text": {
        const body = items.map(textLine).join("\n") + "\n";
        if (append) await fs.append(path, sepIfNeeded + body);
        else await fs.write(path, body);
        break;
      }
    }
    log(`${rel}에 ${items.length}개를 ${append ? "이어 붙였습니다" : before ? "덮어썼습니다" : "새로 썼습니다"}${skipped ? ` · ${skipped}개는 이미 있어 건너뜀` : ""}`);
    return out;
  });
  if (t.keepDays !== null) await pruneOld(fs, dir, t, name, now, log);
  return result;
}

/**
 * n일 지난 파일 지우기 — 이 노드가 쓰는 꼴의 파일(같은 폴더 · 같은 이름 · 같은 형식) 중 바뀐 지 n일 지난 것.
 * ★지금 쓴 파일은 두고, 다른 이름의 파일은 건드리지 않는다
 */
async function pruneOld(fs: FileOps, dir: string, t: FileStoreTarget, current: string, now: Date, log: (text: string) => void): Promise<void> {
  const cutoff = now.getTime() - (t.keepDays ?? 0) * 24 * 3_600_000;
  const gone: string[] = [];
  for (const n of await fs.list(dir).catch(() => [] as string[])) {
    if (n === current || !belongsTo(t, n)) continue;
    const st = await fs.stat(`${dir}/${n}`).catch(() => null);
    if (!st?.isFile || st.mtimeMs >= cutoff) continue;
    await fs.remove(`${dir}/${n}`).then(() => gone.push(n), () => undefined);
  }
  if (gone.length) log(`${t.keepDays}일 지난 파일 ${gone.length}개를 지웠습니다 — ${gone.slice(0, 3).join(", ")}${gone.length > 3 ? " …" : ""}`);
}
