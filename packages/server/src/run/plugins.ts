/**
 * **플러그인** — 확장 노드를 화면에서 올리고 · 바꾸고 · 되돌린다(PLAN §41). 젠킨스의 플러그인 관리자 자리.
 *
 *   올리기        묶음(.fspkg)을 받아 모양 · 해시 · 서명을 보고 → 데이터 폴더/plugins/<id>/<version>에 풀고 → 실제로 불러 본 뒤에야 켠다
 *   사내 저장소   index.json(flowsmith-ext index)에서 새 버전을 찾아 받는다 — 받은 것은 올린 것과 똑같이 검사한다
 *   바꾸기        버전마다 주소가 달라 **재시작 없이** 새 모듈로 뜬다. 돌던 실행은 시작할 때의 것으로 끝까지 간다(레지스트리 사본)
 *   되돌리기      올린 버전은 지우지 않고 남긴다 — 고르면 바로 그 버전
 *   워커          켜 둔 플러그인 목록(desired)을 워커에 알리고, 워커가 달라는 묶음을 준다(run/worker-hub.ts)
 *
 * ★플러그인 코드는 서버 권한으로 돈다 — 올리기는 관리자만(auth.ts) · 기본은 믿는 키로 서명된 것만(FLOWSMITH_PLUGIN_KEYS).
 * ★환경변수로 실은 확장(FLOWSMITH_EXTENSIONS)은 «서버에 고정» — 화면에서 바꾸지 않고, 노드 id가 겹치는 플러그인은 받지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Flow } from "@flowsmith/core";
import { ExtensionRegistry, type Extension } from "@flowsmith/engine";
import { compareVersions, extractPackage, loadPlugin, MAX_PACKAGE_BYTES, PluginError, readPackage, sha256, verifySignature, type PluginPackage, type TrustedKey } from "@flowsmith/worker";
import type { PluginRepo, PluginVersionRow, PluginEvent } from "../storage/plugins.ts";
import { StoreError } from "../storage/types.ts";
import type { PluginSourceEntry as SourceEntry, PluginView } from "../api-types.ts";

/** 워커에 알리는 것 — 이 묶음을 이 해시로 */
export interface PluginRef { id: string; name: string; version: string; sha256: string }

export interface PluginsOptions {
  /** 묶음을 두는 곳 — 데이터 폴더/plugins */
  dir: string;
  /** 서명된 묶음만 받나(기본 예) */
  requireSigned: boolean;
  keys: TrustedKey[];
  /** 환경변수로 실은 확장 — «서버에 고정» */
  base: ExtensionRegistry;
  /** 실행 · 화면이 보는 레지스트리 — 여기를 통째로 바꾼다 */
  registry: ExtensionRegistry;
  /** 사내 저장소 index.json 주소의 기본값(FLOWSMITH_PLUGIN_SOURCE) — 화면에서 바꾸면 그것 */
  source?: string | null;
  log?: (text: string) => void;
}


const SOURCE_KEY = "plugin_source";
const FETCH_MS = 20_000;

/** 플러그인 노드에 붙이는 표 — 화면이 «사내 주문 시스템 1.2.0»으로 보인다 */
export interface PluginTag { id: string; name: string; version: string }

export class Plugins {
  readonly #repo: PluginRepo;
  readonly #o: PluginsOptions;
  readonly #loaded = new Map<string, Extension[]>();
  readonly #errors = new Map<string, string>();
  readonly #listeners = new Set<() => void>();
  /** 올리기 · 바꾸기를 한 줄로 — 둘이 겹치면 레지스트리가 엇갈린다 */
  #chain: Promise<unknown> = Promise.resolve();

  constructor(repo: PluginRepo, opts: PluginsOptions) {
    this.#repo = repo;
    this.#o = opts;
    // ★폴더는 처음 올릴 때 만든다 — 플러그인을 안 쓰는 서버의 데이터 폴더에 빈 폴더를 남기지 않는다
  }

  get requireSigned(): boolean { return this.#o.requireSigned; }
  get keys(): { name: string; fingerprint: string }[] { return this.#o.keys.map((k) => ({ name: k.name, fingerprint: k.fingerprint })); }
  /** 서버에 고정된 확장(환경변수) */
  builtIn(): { id: string; title: string }[] { return this.#o.base.list().map((e) => ({ id: e.id, title: e.title })); }

  onChange(fn: () => void): () => void { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.#chain.then(fn);
    this.#chain = p.catch(() => undefined);
    return p;
  }

  /** 서버를 켤 때 — 켜 둔 것을 싣는다. ★하나가 못 떠도 서버는 뜬다(화면에 까닭이 보인다) */
  async start(): Promise<void> {
    for (const p of this.#repo.listPlugins()) {
      if (!p.enabled) continue;
      const v = this.#repo.findPluginVersion(p.id, p.active);
      if (!v) { this.#errors.set(p.id, `버전 ${p.active}의 기록이 없습니다`); continue; }
      try { await this.#load(v); this.#errors.delete(p.id); } catch (e) {
        this.#errors.set(p.id, (e as Error).message);
        this.#o.log?.(`플러그인 ${p.id} ${p.active}을 싣지 못했습니다 — ${(e as Error).message}`);
      }
    }
    this.#rebuild();
  }

  #folder(id: string, version: string): string { return join(this.#o.dir, id, version); }
  #file(id: string, version: string): string { return join(this.#o.dir, id, `${version}.fspkg`); }

  async #load(v: PluginVersionRow): Promise<Extension[]> {
    const key = `${v.id}@${v.version}`;
    const have = this.#loaded.get(key);
    if (have) return have;
    const dir = this.#folder(v.id, v.version);
    if (!existsSync(join(dir, "manifest.json"))) {
      const file = this.#file(v.id, v.version);
      if (!existsSync(file)) throw new PluginError(`묶음 파일이 없습니다(${file}) — 다시 올리세요`);
      const buf = readFileSync(file);
      if (sha256(buf) !== v.sha256) throw new PluginError(`묶음 파일(${file})이 올릴 때와 다릅니다 — 다시 올리세요`);
      extractPackage(readPackage(buf), dir);
    }
    const tag: PluginTag = { id: v.id, name: v.manifest.name, version: v.version };
    const exts = (await loadPlugin(dir, v.manifest, v.sha256)).map((e): Extension => ({ ...e, plugin: tag, run: (ctx) => e.run(ctx) } as Extension));
    this.#loaded.set(key, exts);
    return exts;
  }

  /** 레지스트리를 통째로 — 서버에 고정된 것 + 켜 둔 플러그인의 지금 버전 */
  #rebuild(): void {
    const exts: Extension[] = [...this.#o.base.all()];
    for (const p of this.#repo.listPlugins()) {
      if (!p.enabled) continue;
      const loaded = this.#loaded.get(`${p.id}@${p.active}`);
      if (loaded) exts.push(...loaded);
    }
    this.#o.registry.replace(exts);
    for (const fn of this.#listeners) { try { fn(); } catch { /* 듣는 쪽의 사고는 여기서 멈춘다 */ } }
  }

  /** 서명 — 정책대로. 서명한 키 이름(서명 없이 받으면 null) */
  #signer(pkg: PluginPackage): string | null {
    if (this.#o.requireSigned && this.#o.keys.length === 0) {
      throw new StoreError(422, "믿는 서명 키가 정해져 있지 않아 플러그인을 받을 수 없습니다 — 서버의 FLOWSMITH_PLUGIN_KEYS에 믿는 키 파일을 주세요(서명 없이 받으려면 FLOWSMITH_PLUGIN_SIGNING=off)");
    }
    let key: TrustedKey | null;
    try { key = verifySignature(pkg, this.#o.keys); } catch (e) {
      if (this.#o.requireSigned) throw new StoreError(422, (e as Error).message);
      return null;
    }
    if (!key && this.#o.requireSigned) throw new StoreError(422, "서명 없는 묶음은 받지 않습니다 — flowsmith-ext build --key로 서명해 다시 만드세요");
    return key?.name ?? null;
  }

  /** 묶음을 받는다 — 검사 · 풀기 · 불러 보기를 다 지나야 켠다. 같은 버전 · 같은 내용이면 그 버전으로 바꾸기만 */
  install(buf: Buffer, by: string | null, source = "upload"): Promise<PluginView> {
    return this.#serial(async () => {
      let pkg: PluginPackage;
      try { pkg = readPackage(buf); } catch (e) {
        throw e instanceof PluginError ? new StoreError(422, e.message) : e;
      }
      const m = pkg.manifest;
      const signer = this.#signer(pkg);
      const clash = m.nodes.filter((n) => this.#o.base.get(n));
      if (clash.length) throw new StoreError(409, `서버에 고정된 확장(환경변수)과 노드 id가 겹칩니다: ${clash.join(", ")} — 그 확장을 FLOWSMITH_EXTENSIONS에서 빼고 다시 켠 뒤 올리세요`);
      const have = this.#repo.findPluginVersion(m.id, m.version);
      if (have && have.sha256 !== pkg.sha256) throw new StoreError(409, `«${m.name}» ${m.version}이 이미 있는데 내용이 다릅니다 — package.json의 version을 올려 다시 빌드하세요`);
      if (!have) {
        mkdirSync(join(this.#o.dir, m.id), { recursive: true });
        const dir = this.#folder(m.id, m.version);
        rmSync(dir, { recursive: true, force: true });
        writeFileSync(this.#file(m.id, m.version), buf);
        extractPackage(pkg, dir);
        const row: Omit<PluginVersionRow, "installedAt"> = { id: m.id, version: m.version, sha256: pkg.sha256, manifest: m, signer, size: pkg.size, source, installedBy: by };
        try { await this.#load({ ...row, installedAt: "" }); } catch (e) {
          rmSync(dir, { recursive: true, force: true });
          rmSync(this.#file(m.id, m.version), { force: true });
          throw new StoreError(422, (e as Error).message);
        }
        this.#repo.addPluginVersion(row);
      } else {
        await this.#load(have).catch((e: Error) => { throw new StoreError(422, e.message); });
      }
      const prev = this.#repo.findPlugin(m.id);
      this.#repo.setPlugin(m.id, { active: m.version, enabled: true }, by);
      this.#repo.logPlugin(have ? "activate" : "install", m.id, m.version, `${prev ? `${prev.active} → ` : ""}${m.version}${source === "upload" ? "" : ` · ${source}`}${signer ? ` · 서명 ${signer}` : " · 서명 없음"}`, by);
      this.#errors.delete(m.id);
      this.#rebuild();
      return this.view(m.id)!;
    });
  }

  /** 지금 쓰는 버전 — 되돌리기 · 다시 올리기 */
  setActive(id: string, version: string, by: string | null): Promise<PluginView> {
    return this.#serial(async () => {
      const p = this.#repo.findPlugin(id);
      if (!p) throw new StoreError(404, `플러그인 ${id}가 없습니다`);
      const v = this.#repo.findPluginVersion(id, version);
      if (!v) throw new StoreError(404, `플러그인 ${id}에 버전 ${version}이 없습니다`);
      await this.#load(v).catch((e: Error) => { throw new StoreError(422, e.message); });
      this.#repo.setPlugin(id, { active: version }, by);
      this.#repo.logPlugin(compareVersions(version, p.active) < 0 ? "rollback" : "activate", id, version, `${p.active} → ${version}`, by);
      this.#errors.delete(id);
      this.#rebuild();
      return this.view(id)!;
    });
  }

  setEnabled(id: string, enabled: boolean, by: string | null): Promise<PluginView> {
    return this.#serial(async () => {
      const p = this.#repo.findPlugin(id);
      if (!p) throw new StoreError(404, `플러그인 ${id}가 없습니다`);
      if (enabled) {
        const v = this.#repo.findPluginVersion(id, p.active);
        if (!v) throw new StoreError(404, `플러그인 ${id}에 버전 ${p.active}이 없습니다`);
        await this.#load(v).catch((e: Error) => { throw new StoreError(422, e.message); });
        this.#errors.delete(id);
      }
      this.#repo.setPlugin(id, { enabled }, by);
      this.#repo.logPlugin(enabled ? "enable" : "disable", id, p.active, "", by);
      this.#rebuild();
      return this.view(id)!;
    });
  }

  /** 지운다 — 쓰는 워크플로우가 있는지는 부르는 쪽(길)이 먼저 본다 */
  remove(id: string, by: string | null): Promise<void> {
    return this.#serial(async () => {
      const p = this.#repo.findPlugin(id);
      if (!p) throw new StoreError(404, `플러그인 ${id}가 없습니다`);
      this.#repo.removePlugin(id);
      this.#repo.logPlugin("remove", id, p.active, "", by);
      rmSync(join(this.#o.dir, id), { recursive: true, force: true });
      this.#errors.delete(id);
      this.#rebuild();
    });
  }

  /** 이 플러그인의 노드 id들(지금 버전) */
  nodesOf(id: string): string[] {
    const p = this.#repo.findPlugin(id);
    return p ? this.#repo.findPluginVersion(id, p.active)?.manifest.nodes ?? [] : [];
  }

  /** 노드 id의 주인 플러그인 */
  #owner(nodeId: string): string | null {
    const id = nodeId.split(".")[0] ?? "";
    return this.#repo.findPlugin(id) ? id : null;
  }

  /** 이 워크플로우가 쓰는 플러그인 → 지금 버전(켜 둔 것만) — 버전을 만들 때 적어 둔다 */
  versionsFor(flow: Pick<Flow, "nodes">): Record<string, string> {
    const out: Record<string, string> = {};
    for (const n of flow.nodes) {
      if (n.type !== "extension") continue;
      const owner = this.#owner(n.config.extension);
      const p = owner ? this.#repo.findPlugin(owner) : null;
      if (p?.enabled) out[p.id] = p.active;
    }
    return out;
  }

  /** 워커에 알릴 것 — 켜 두었고 불러진 것만 */
  desired(): PluginRef[] {
    const out: PluginRef[] = [];
    for (const p of this.#repo.listPlugins()) {
      if (!p.enabled || !this.#loaded.has(`${p.id}@${p.active}`)) continue;
      const v = this.#repo.findPluginVersion(p.id, p.active);
      if (v) out.push({ id: p.id, name: v.manifest.name, version: v.version, sha256: v.sha256 });
    }
    return out;
  }

  /** 워커가 달라는 묶음 */
  bytes(id: string, version: string): Buffer | null {
    const v = this.#repo.findPluginVersion(id, version);
    if (!v) return null;
    const f = this.#file(id, version);
    return existsSync(f) ? readFileSync(f) : null;
  }

  view(id: string): PluginView | null {
    const p = this.#repo.findPlugin(id);
    if (!p) return null;
    const versions = this.#repo.listPluginVersions(id).sort((a, b) => compareVersions(b.version, a.version));
    const v = versions.find((x) => x.version === p.active) ?? versions[0];
    const loaded = this.#loaded.get(`${id}@${p.active}`);
    return {
      id, name: v?.manifest.name ?? id, description: v?.manifest.description ?? "", version: p.active, enabled: p.enabled,
      nodes: (v?.manifest.nodes ?? []).map((n) => ({ id: n, title: loaded?.find((e) => e.id === n)?.title ?? n })),
      signer: v?.signer ?? null, loaded: p.enabled && loaded !== undefined, error: this.#errors.get(id) ?? null,
      changedAt: p.changedAt, changedBy: p.changedBy,
      versions: versions.map((x) => ({ version: x.version, sha256: x.sha256, signer: x.signer, size: x.size, source: x.source, installedAt: x.installedAt, installedBy: x.installedBy, builtAt: x.manifest.builtAt ?? null })),
    };
  }

  list(): PluginView[] { return this.#repo.listPlugins().map((p) => this.view(p.id)!); }
  events(limit?: number): PluginEvent[] { return this.#repo.pluginEvents(limit); }

  // ─── 사내 저장소 ───────────────────────────────────────────────

  get source(): string | null { return this.#repo.getSetting(SOURCE_KEY) ?? this.#o.source ?? null; }

  setSource(url: string | null, by: string | null): string | null {
    const v = url === null ? "" : String(url).trim();
    if (v !== "") {
      let u: URL;
      try { u = new URL(v); } catch { throw new StoreError(400, "사내 저장소 주소를 읽을 수 없습니다 — https://…/index.json"); }
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new StoreError(400, "사내 저장소는 http(s) 주소입니다");
    }
    this.#repo.setSetting(SOURCE_KEY, v === "" ? null : v);
    this.#repo.logPlugin("source", "-", null, v || "(지움)", by);
    return this.source;
  }

  async #fetch(url: string, max: number): Promise<Buffer> {
    let res: Response;
    try { res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), redirect: "follow" }); } catch (e) {
      throw new StoreError(502, `사내 저장소에 닿지 못했습니다(${url}) — ${(e as Error).message}`);
    }
    if (!res.ok) throw new StoreError(502, `사내 저장소가 ${res.status}을 돌려주었습니다(${url})`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > max) throw new StoreError(422, `받을 파일이 너무 큽니다(${url})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new StoreError(422, `받을 파일이 너무 큽니다(${url})`);
    return buf;
  }

  async #index(): Promise<{ url: string; entries: { id: string; name: string; version: string; description: string; nodes: string[]; file: string; sha256: string; size: number; signer: string | null }[] }> {
    const url = this.source;
    if (!url) throw new StoreError(400, "사내 저장소 주소가 없습니다 — «확장» 화면에서 index.json 주소를 넣으세요");
    let raw: unknown;
    try { raw = JSON.parse((await this.#fetch(url, 5 * 1024 * 1024)).toString("utf8")); } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError(422, `사내 저장소의 index.json을 읽을 수 없습니다(${url})`);
    }
    const list = (raw as { plugins?: unknown }).plugins;
    if (!Array.isArray(list)) throw new StoreError(422, `index.json에 plugins 목록이 없습니다(${url}) — flowsmith-ext index로 만드세요`);
    const entries = list.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object").map((x) => ({
      id: String(x["id"] ?? ""), name: String(x["name"] ?? x["id"] ?? ""), version: String(x["version"] ?? ""), description: String(x["description"] ?? ""),
      nodes: Array.isArray(x["nodes"]) ? x["nodes"].map(String) : [], file: String(x["file"] ?? ""), sha256: String(x["sha256"] ?? ""),
      size: Number(x["size"] ?? 0), signer: typeof x["signer"] === "string" ? x["signer"] : null,
    })).filter((e) => e.id && e.version && e.file && /^[0-9a-f]{64}$/.test(e.sha256));
    return { url, entries };
  }

  /** 새 버전 확인 — 저장소의 묶음마다 «깔려 있나 · 더 새것인가» */
  async checkSource(): Promise<{ url: string; plugins: SourceEntry[] }> {
    const { url, entries } = await this.#index();
    const plugins = entries.map((e): SourceEntry => {
      const p = this.#repo.findPlugin(e.id);
      return { id: e.id, name: e.name, version: e.version, description: e.description, nodes: e.nodes, signer: e.signer, size: e.size,
        installed: p?.active ?? null, have: this.#repo.findPluginVersion(e.id, e.version) !== null, newer: p ? compareVersions(e.version, p.active) > 0 : false };
    }).sort((a, b) => a.id.localeCompare(b.id) || compareVersions(b.version, a.version));
    return { url, plugins };
  }

  /** 저장소에서 받아 올린다 — 해시가 index와 다르면 받지 않는다 */
  async installFromSource(id: string, version: string, by: string | null): Promise<PluginView> {
    const { url, entries } = await this.#index();
    const e = entries.find((x) => x.id === id && x.version === version);
    if (!e) throw new StoreError(404, `사내 저장소에 ${id} ${version}이 없습니다`);
    const fileUrl = new URL(e.file, url).href;
    const buf = await this.#fetch(fileUrl, MAX_PACKAGE_BYTES);
    if (sha256(buf) !== e.sha256) throw new StoreError(422, `받은 묶음이 index.json의 해시와 다릅니다(${fileUrl}) — 저장소를 확인하세요`);
    return this.install(buf, by, url);
  }
}
