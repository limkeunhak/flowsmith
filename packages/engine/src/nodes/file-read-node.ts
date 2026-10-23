/**
 * **파일 읽기 노드** (core nodes/file.ts) — 파일 쓰기 노드가 쓴 것을 읽어 `{ rows, file, count }`로 내놓는다.
 *
 *   csv    머리줄이 있으면 행마다 객체 { 열 이름: 값 }, 없으면 { 열1, 열2 … }
 *   jsonl  줄마다 JSON
 *   json   배열이면 그대로, 값 하나면 [값]
 *   text   줄마다 글자
 *
 * 폴더: 이 플로우(files/<uuid>) · 공유(files/shared) · 다른 플로우(files/<그 플로우의 uuid> — 서버가 알려 준다).
 * ★읽기만 한다 — 파일을 만들거나 바꾸지 않는다. ★파일 뿌리 밖은 못 읽는다.
 */
import {
  badDir, badFileName, latestOf, readFileName, SHARED_DIR,
  type FileReadNode, type FileReadSource, type Output,
} from "@flowsmith/core";
import { FileStoreError, opsOf, parseCsv, rootedPath, UID_RE, type FileStoreOptions } from "./file-common.ts";

/** 읽을 폴더(뿌리 아래 상대 경로) */
export function readDir(s: FileReadSource, files: FileStoreOptions): string {
  let base: string;
  if (s.scope === "shared") base = SHARED_DIR;
  else {
    const uid = s.scope === "flow" ? files.flowUid : files.flowUids?.[s.flowId ?? ""];
    if (!uid || !UID_RE.test(uid) || uid === SHARED_DIR) {
      throw new FileStoreError(s.scope === "flow" ? "이 워크플로우의 폴더(uuid)를 모릅니다 — 서버에 등록된 워크플로우로 돌리세요" : `워크플로우 「${s.flowId}」를 찾지 못했습니다 — 지워졌거나 id가 바뀌었는지 보세요`);
    }
    base = uid;
  }
  return s.dir ? `${base}/${s.dir}` : base;
}

function rowsOf(text: string, s: FileReadSource, rel: string): unknown[] {
  switch (s.format) {
    case "csv": {
      const all = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
      if (!s.csv.header) return all.map((r) => Object.fromEntries(r.map((v, i) => [`열${i + 1}`, v])));
      const [head = [], ...body] = all;
      return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
    }
    case "jsonl":
      return text.split("\n").filter((l) => l.trim() !== "").map((l, i) => {
        try { return JSON.parse(l); } catch { throw new FileStoreError(`${rel} ${i + 1}번째 줄을 JSON으로 읽을 수 없습니다`); }
      });
    case "json": {
      if (text.trim() === "") return [];
      let v: unknown;
      try { v = JSON.parse(text); } catch { throw new FileStoreError(`${rel}을 JSON으로 읽을 수 없습니다`); }
      return Array.isArray(v) ? v : [v];
    }
    case "text":
      return text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l !== "");
  }
}

export async function runFileReadNode(node: FileReadNode, files: FileStoreOptions | undefined, log: (text: string) => void, now = new Date()): Promise<Output> {
  const { source: s, missing, maxRows } = node.config;
  if (!files) throw new FileStoreError("파일을 읽을 곳(파일 뿌리)이 정해지지 않았습니다 — 서버에서 돌리세요");
  const bad = badDir(s.dir) ?? badFileName(s.name);
  if (bad) throw new FileStoreError(bad);
  const fs = opsOf(files);
  const dir = rootedPath(readDir(s, files));
  if (dir === null) throw new FileStoreError(`폴더 「${s.dir}」가 파일 뿌리 밖을 가리킵니다`);

  let name = readFileName(s, now);
  if (name === null) name = latestOf(s, await fs.list(dir));
  const wanted = name ?? `${s.name}-*`;
  const rel = `${dir}/${wanted}`;
  const text = name === null ? null : await fs.read(`${dir}/${name}`);
  if (text === null) {
    const where = s.scope === "otherFlow" ? `워크플로우 「${s.flowId}」의 폴더` : s.scope === "shared" ? "공유 폴더" : "이 워크플로우 폴더";
    const msg = `읽을 파일이 없습니다 — ${where}의 ${s.dir ? `${s.dir}/` : ""}${wanted}`;
    if (missing === "fail") throw new FileStoreError(msg);
    log(`${msg} — 빈 목록으로 넘어갑니다`);
    return { rows: [], file: null, count: 0 };
  }
  let rows = rowsOf(text, s, rel);
  if (maxRows !== null && rows.length > maxRows) {
    log(`${rows.length}줄 중 앞 ${maxRows}줄만 읽었습니다`);
    rows = rows.slice(0, maxRows);
  }
  log(`${rel}에서 ${rows.length}줄을 읽었습니다`);
  return { rows, file: rel, count: rows.length };
}
