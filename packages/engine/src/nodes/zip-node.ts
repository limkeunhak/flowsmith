/**
 * 압축(zip) 노드(PLAN §52) — 이 워크플로우(또는 공유) 폴더의 파일들을 zip 하나로. 실제로 묶는 것은 FileOps.zip(파일이 있는 곳).
 */
import { badDir, badFileName, evaluate, SHARED_DIR, zipFileName, type Output, type Scope, type ZipNode } from "@flowsmith/core";
import { FileStoreError, opsOf, rootedPath, UID_RE, type FileStoreOptions } from "./file-common.ts";

const text = (template: string, scope: Scope, what: string): string => {
  const v = evaluate(template, { ...scope, secrets: {} }).value;
  if (v === undefined || v === null) throw new FileStoreError(`${what} 값이 없습니다`);
  return String(v).trim();
};

function base(scope: "flow" | "shared", files: FileStoreOptions): string {
  if (scope === "shared") return SHARED_DIR;
  if (!files.flowUid || !UID_RE.test(files.flowUid) || files.flowUid === SHARED_DIR) throw new FileStoreError("이 워크플로우의 폴더(uuid)를 모릅니다 — 서버에 등록된 워크플로우로 돌리세요");
  return files.flowUid;
}

export async function runZipNode(node: ZipNode, scope: Scope, files: FileStoreOptions | undefined, log: (text: string) => void): Promise<Output> {
  if (!files) throw new FileStoreError("파일을 둘 곳이 없습니다 — 서버에서 돌리세요");
  const c = node.config;
  const fromDir = text(c.from.dir, scope, "묶을 폴더");
  const toDir = text(c.to.dir, scope, "결과 폴더");
  const name = zipFileName(text(c.to.name, scope, "결과 이름"));
  for (const [what, bad] of [["묶을 폴더", badDir(fromDir)], ["결과 폴더", badDir(toDir)], ["결과 이름", badFileName(name)]] as const) {
    if (bad) throw new FileStoreError(`${what}: ${bad}`);
  }
  const src = rootedPath(fromDir ? `${base(c.from.scope, files)}/${fromDir}` : base(c.from.scope, files));
  const dest = rootedPath(`${base(c.to.scope, files)}/${toDir ? `${toDir}/` : ""}${name}`);
  if (!src || !dest) throw new FileStoreError("파일 뿌리 밖은 묶지 않습니다");
  const started = Date.now();
  const r = await opsOf(files).zip(src, c.from.include, dest, c.ifExists);
  log(`${dest}에 ${r.count}개를 묶었습니다 — ${Math.max(1, Math.round(r.bytes / 1024))}KB · ${((Date.now() - started) / 1000).toFixed(1)}초`);
  return { file: dest, count: r.count, bytes: r.bytes };
}
