/**
 * **워커의 플러그인** — 서버가 알린 목록(id · 버전 · 해시)대로 이 PC에 받아 두고 싣는다(PLAN §41).
 *
 *   받아 둔 곳   <dir>/<id>/<version>.fspkg · 풀어 둔 것 <dir>/<id>/<version>/ — 다시 붙어도 다시 받지 않는다
 *   확인         서버가 알린 해시와 같아야 싣는다(서명은 서버가 이미 봤다 — 워커는 서버를 믿고, 서버가 준 해시로 확인한다)
 *   목록에 없음   레지스트리에서 내린다(파일은 남겨 둔다 — 되돌리면 바로 쓴다)
 * ★이 PC의 환경변수로 실은 확장(FLOWSMITH_EXTENSIONS)은 그대로 둔다 — 같은 노드 id면 그쪽이 앞선다
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Extension, ExtensionRegistry } from "@flowsmith/engine";
import { extractPackage, loadPlugin, readExtracted, readPackage, sha256 } from "./plugins.ts";

export interface PluginRef { id: string; name: string; version: string; sha256: string }

export interface SyncResult {
  extensions: string[];
  plugins: Record<string, string>;
  errors: Record<string, string>;
}

export class PluginCache {
  readonly #dir: string;
  readonly #registry: ExtensionRegistry;
  readonly #base: Extension[];
  readonly #loaded = new Map<string, Extension[]>();
  #chain: Promise<unknown> = Promise.resolve();

  constructor(dir: string, registry: ExtensionRegistry) {
    this.#dir = dir;
    this.#registry = registry;
    this.#base = registry.all();
  }

  /** 목록대로 맞춘다 — fetch는 서버에 묶음을 달라고 한다. ★차례로(겹치면 레지스트리가 엇갈린다) */
  sync(list: readonly PluginRef[], fetch: (id: string, version: string) => Promise<Buffer>, log: (t: string) => void = () => undefined): Promise<SyncResult> {
    const p = this.#chain.then(() => this.#sync(list, fetch, log));
    this.#chain = p.catch(() => undefined);
    return p;
  }

  async #sync(list: readonly PluginRef[], fetch: (id: string, version: string) => Promise<Buffer>, log: (t: string) => void): Promise<SyncResult> {
    const errors: Record<string, string> = {};
    const plugins: Record<string, string> = {};
    const exts: Extension[] = [...this.#base];
    const taken = new Set(this.#base.map((e) => e.id));
    for (const ref of list) {
      try {
        const loaded = await this.#ensure(ref, fetch, log);
        const fresh = loaded.filter((e) => !taken.has(e.id));
        exts.push(...fresh);
        for (const e of fresh) taken.add(e.id);
        plugins[ref.id] = ref.version;
      } catch (e) {
        errors[ref.id] = (e as Error).message;
        log(`플러그인 «${ref.name}» ${ref.version}을 싣지 못했습니다 — ${(e as Error).message}`);
      }
    }
    this.#registry.replace(exts);
    return { extensions: exts.map((e) => e.id), plugins, errors };
  }

  async #ensure(ref: PluginRef, fetch: (id: string, version: string) => Promise<Buffer>, log: (t: string) => void): Promise<Extension[]> {
    const key = `${ref.id}@${ref.version}#${ref.sha256}`;
    const have = this.#loaded.get(key);
    if (have) return have;
    const file = join(this.#dir, ref.id, `${ref.version}.fspkg`);
    const dir = join(this.#dir, ref.id, ref.version);
    let buf: Buffer | null = existsSync(file) ? readFileSync(file) : null;
    if (buf && sha256(buf) !== ref.sha256) buf = null;   // 서버의 같은 버전이 바뀌었다(지웠다 다시 올림) — 다시 받는다
    if (!buf) {
      log(`플러그인 «${ref.name}» ${ref.version} 받는 중…`);
      buf = await fetch(ref.id, ref.version);
      if (sha256(buf) !== ref.sha256) throw new Error("받은 묶음이 서버가 알린 해시와 다릅니다");
      mkdirSync(join(this.#dir, ref.id), { recursive: true });
      writeFileSync(file, buf);
      extractPackage(readPackage(buf), `${dir}.${ref.sha256.slice(0, 12)}`);
    } else if (!existsSync(join(`${dir}.${ref.sha256.slice(0, 12)}`, "manifest.json"))) {
      extractPackage(readPackage(buf), `${dir}.${ref.sha256.slice(0, 12)}`);
    }
    const where = `${dir}.${ref.sha256.slice(0, 12)}`;
    const exts = await loadPlugin(where, readExtracted(where), ref.sha256);
    this.#loaded.set(key, exts);
    return exts;
  }
}
