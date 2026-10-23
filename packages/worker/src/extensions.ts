/**
 * 확장 불러오기 — `FLOWSMITH_EXTENSIONS`에 적힌 모듈들 (쉼표로).
 *
 *   FLOWSMITH_EXTENSIONS=@flowsmith/ext-shop
 *   FLOWSMITH_EXTENSIONS=./my-ext/index.ts,@flowsmith/ext-shop
 *
 * 각 모듈은 `export const extensions: Extension[]`를 낸다.
 * ★하나라도 못 불러오면 서버가 뜨지 않는다 — 반만 뜬 워커는 «확장이 없습니다»로 실행 중에 실패한다.
 */
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ExtensionRegistry, type ExtensionModule } from "@flowsmith/engine";

export async function loadExtensions(specs: readonly string[], base = process.cwd()): Promise<ExtensionRegistry> {
  const reg = new ExtensionRegistry();
  for (const spec of specs.map((s) => s.trim()).filter(Boolean)) {
    const target = spec.startsWith(".") || isAbsolute(spec) ? pathToFileURL(resolve(base, spec)).href : spec;
    let mod: Partial<ExtensionModule>;
    try {
      mod = (await import(target)) as Partial<ExtensionModule>;
    } catch (e) {
      throw new Error(`확장 '${spec}'를 불러올 수 없습니다 — ${(e as Error).message.split("\n")[0]}`);
    }
    if (!Array.isArray(mod.extensions)) throw new Error(`확장 '${spec}'에 extensions 목록이 없습니다`);
    reg.register(...mod.extensions);
  }
  return reg;
}
