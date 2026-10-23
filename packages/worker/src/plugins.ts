/**
 * **플러그인 묶음**(.fspkg) — 확장 노드를 밖에서 만들어 올리는 형식(PLAN §41). 젠킨스의 .hpi와 같은 자리.
 *
 *   x.fspkg (zip)
 *     manifest.json    { format, id, name, version, description, api, main, nodes[], files{경로: sha256} }
 *     signature.json   { key, fingerprint, sig } — manifest.json 바이트의 Ed25519 서명(없으면 «서명 없음»)
 *     index.mjs        빌드된 JS 하나(main) — `export const extensions: Extension[]`
 *     …                그 밖의 파일(manifest.files에 모두 적혀 있어야 한다)
 *
 * ★서명은 manifest.json에, manifest는 파일마다의 해시를 — 그래서 한 바이트만 바뀌어도 걸린다.
 * ★의존성은 미리 한 파일로 묶는다(사내망에서 npm을 받지 않는다). 엔진 · 코어 · Playwright만은 이 프로그램의 것을 쓴다(hostHooks).
 * ★서버와 워커가 함께 쓴다 — 서버는 올린 것을 검사해 풀고, 워커는 서버가 준 것을 해시로 확인해 푼다.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import type { Extension } from "@flowsmith/engine";

export const PLUGIN_FORMAT = 1;
/** 엔진이 확장에 주는 것(ExtensionContext)의 판 — 바뀌면 옛 플러그인은 받지 않는다 */
export const PLUGIN_API = 1;
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/;
/** 묶음 크기 · 풀었을 때의 크기 · 파일 수 */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 2000;

export interface PluginManifest {
  format: number;
  id: string;
  name: string;
  version: string;
  description: string;
  api: number;
  main: string;
  /** 이 묶음이 내놓는 확장 노드 id — 모두 «<id>.»로 시작한다 */
  nodes: string[];
  /** manifest.json · signature.json 밖의 모든 파일 — 경로 → sha256(16진) */
  files: Record<string, string>;
  builtAt?: string;
}

export interface PluginSignature { key: string; fingerprint: string; sig: string }

export interface PluginPackage {
  manifest: PluginManifest;
  manifestBytes: Buffer;
  signature: PluginSignature | null;
  files: Map<string, Buffer>;
  /** 묶음 전체의 sha256 — 워커에 나눠 줄 때 이것으로 확인한다 */
  sha256: string;
  size: number;
}

export class PluginError extends Error {}

export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** 0.10.0 > 0.9.9 — 숫자로 견준다. 뒤붙이(-beta)가 있으면 없는 것보다 앞 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => { const [core, pre] = v.split("-", 2) as [string, string | undefined]; return { n: core.split(".").map(Number), pre: pre ?? null }; };
  const x = split(a), y = split(b);
  for (let i = 0; i < 3; i++) { const d = (x.n[i] ?? 0) - (y.n[i] ?? 0); if (d) return d; }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** zip 안의 경로 — 위로 · 절대 경로 · 역슬래시는 안 된다 */
function safePath(p: string): boolean {
  return p !== "" && !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

function manifestOf(raw: unknown): PluginManifest {
  const bad = (t: string): never => { throw new PluginError(`manifest.json: ${t}`); };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) bad("객체여야 합니다");
  const m = raw as Record<string, unknown>;
  if (m["format"] !== PLUGIN_FORMAT) bad(`format이 ${PLUGIN_FORMAT}이어야 합니다(받은 값: ${JSON.stringify(m["format"])})`);
  const str = (k: string, max = 200): string => { const v = m[k]; if (typeof v !== "string" || v.trim() === "" || v.length > max) bad(`${k}가 비었거나 너무 깁니다`); return v as string; };
  const id = str("id", 40);
  if (!PLUGIN_ID_RE.test(id)) bad(`id «${id}» — 영문 소문자로 시작하고 소문자 · 숫자 · -만(2~40자)`);
  const version = str("version", 60);
  if (!VERSION_RE.test(version)) bad(`version «${version}» — 1.2.3 꼴이어야 합니다`);
  if (m["api"] !== PLUGIN_API) bad(`이 묶음은 확장 API ${JSON.stringify(m["api"])}판으로 만들어졌습니다 — 이 서버는 ${PLUGIN_API}판입니다(flowsmith-ext로 다시 빌드하세요)`);
  const main = str("main");
  if (!safePath(main)) bad(`main «${main}»을 읽을 수 없습니다`);
  const nodes = m["nodes"];
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 100) bad("nodes가 비었습니다");
  for (const n of nodes as unknown[]) if (typeof n !== "string" || !n.startsWith(`${id}.`) || !/^[a-z0-9.-]+$/i.test(n)) bad(`노드 id «${String(n)}» — «${id}.»로 시작해야 합니다`);
  const files = m["files"];
  if (files === null || typeof files !== "object" || Array.isArray(files)) bad("files가 없습니다");
  for (const [p, h] of Object.entries(files as Record<string, unknown>)) {
    if (!safePath(p) || p === "manifest.json" || p === "signature.json") bad(`파일 경로 «${p}»를 쓸 수 없습니다`);
    if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) bad(`«${p}»의 해시가 틀렸습니다`);
  }
  if (!(main in (files as object))) bad(`main «${main}»이 files에 없습니다`);
  const description = typeof m["description"] === "string" ? m["description"].slice(0, 1000) : "";
  return {
    format: PLUGIN_FORMAT, id, name: str("name", 80), version, description, api: PLUGIN_API, main,
    nodes: [...new Set(nodes as string[])], files: files as Record<string, string>,
    ...(typeof m["builtAt"] === "string" ? { builtAt: m["builtAt"].slice(0, 40) } : {}),
  };
}

/** 묶음을 읽고 모양 · 파일 해시를 확인한다(서명은 따로 — verifySignature) */
export function readPackage(buf: Buffer): PluginPackage {
  if (buf.length > MAX_PACKAGE_BYTES) throw new PluginError(`묶음이 너무 큽니다(${(buf.length / 1048576).toFixed(1)}MB · 최대 ${MAX_PACKAGE_BYTES / 1048576}MB)`);
  let zip: AdmZip;
  try { zip = new AdmZip(buf); } catch { throw new PluginError("플러그인 묶음(.fspkg · zip)을 읽을 수 없습니다"); }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > MAX_FILES) throw new PluginError(`파일이 너무 많습니다(${entries.length}개)`);
  let total = 0;
  for (const e of entries) {
    if (!safePath(e.entryName)) throw new PluginError(`묶음 안의 경로 «${e.entryName}»를 쓸 수 없습니다`);
    total += e.header.size;
    if (total > MAX_UNPACKED_BYTES) throw new PluginError("풀면 너무 큽니다");
  }
  const byName = new Map(entries.map((e) => [e.entryName, e]));
  const manifestEntry = byName.get("manifest.json");
  if (!manifestEntry) throw new PluginError("manifest.json이 없습니다 — flowsmith-ext build로 만든 묶음인가요?");
  const manifestBytes = manifestEntry.getData();
  let raw: unknown;
  try { raw = JSON.parse(manifestBytes.toString("utf8")); } catch { throw new PluginError("manifest.json을 읽을 수 없습니다"); }
  const manifest = manifestOf(raw);
  let signature: PluginSignature | null = null;
  const sigEntry = byName.get("signature.json");
  if (sigEntry) {
    try {
      const s = JSON.parse(sigEntry.getData().toString("utf8")) as Record<string, unknown>;
      if (typeof s["key"] !== "string" || typeof s["fingerprint"] !== "string" || typeof s["sig"] !== "string") throw new Error();
      signature = { key: s["key"].slice(0, 80), fingerprint: s["fingerprint"], sig: s["sig"] };
    } catch { throw new PluginError("signature.json을 읽을 수 없습니다"); }
  }
  const files = new Map<string, Buffer>();
  for (const [p, want] of Object.entries(manifest.files)) {
    const e = byName.get(p);
    if (!e) throw new PluginError(`manifest에 적힌 «${p}»가 묶음에 없습니다`);
    const data = e.getData();
    if (sha256(data) !== want) throw new PluginError(`«${p}»가 manifest의 해시와 다릅니다 — 묶음이 바뀌었습니다`);
    files.set(p, data);
  }
  for (const name of byName.keys()) {
    if (name !== "manifest.json" && name !== "signature.json" && !files.has(name)) throw new PluginError(`manifest에 없는 파일 «${name}»이 들어 있습니다`);
  }
  return { manifest, manifestBytes, signature, files, sha256: sha256(buf), size: buf.length };
}

// ─── 서명 ──────────────────────────────────────────────────────────

export interface TrustedKey { name: string; fingerprint: string; key: KeyObject }

/** 공개 키의 지문 — SPKI DER의 sha256 앞 16자 */
export const fingerprintOf = (key: KeyObject): string => sha256(key.export({ type: "spki", format: "der" })).slice(0, 16);

/**
 * 믿는 키 목록 — 한 줄에 «이름 공개키(base64 SPKI)» · #은 설명.
 *   사내배포 MCowBQYDK2VwAyEA…
 */
export function parseTrustedKeys(text: string): TrustedKey[] {
  const out: TrustedKey[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.replace(/#.*$/, "").trim();
    if (!l) return;
    const m = /^(\S+)\s+([A-Za-z0-9+/=]+)$/.exec(l);
    if (!m) throw new PluginError(`믿는 키 ${i + 1}째 줄을 읽을 수 없습니다 — «이름 공개키(base64)»`);
    let key: KeyObject;
    try { key = createPublicKey({ key: Buffer.from(m[2]!, "base64"), format: "der", type: "spki" }); } catch { throw new PluginError(`믿는 키 ${i + 1}째 줄(${m[1]})의 공개키를 읽을 수 없습니다`); }
    if (key.asymmetricKeyType !== "ed25519") throw new PluginError(`믿는 키 «${m[1]}»는 Ed25519 키가 아닙니다`);
    out.push({ name: m[1]!, fingerprint: fingerprintOf(key), key });
  });
  return out;
}

/** 서명을 본다 — 서명이 없으면 null · 있는데 틀렸거나 모르는 키면 던진다 */
export function verifySignature(pkg: PluginPackage, keys: readonly TrustedKey[]): TrustedKey | null {
  const s = pkg.signature;
  if (!s) return null;
  const k = keys.find((x) => x.fingerprint === s.fingerprint);
  if (!k) throw new PluginError(`모르는 키로 서명됐습니다(«${s.key}» · 지문 ${s.fingerprint}) — 서버의 믿는 키 목록(FLOWSMITH_PLUGIN_KEYS)에 그 공개키를 넣으세요`);
  let ok = false;
  try { ok = verify(null, pkg.manifestBytes, k.key, Buffer.from(s.sig, "base64")); } catch { ok = false; }
  if (!ok) throw new PluginError(`서명이 맞지 않습니다(«${k.name}») — 묶음이 바뀌었거나 다른 키로 서명됐습니다`);
  return k;
}

/** 서명 키 한 벌 — 비밀키(PEM)는 만드는 쪽이 갖고, 공개키 줄은 서버의 믿는 키 목록에 */
export function generateSigningKey(name: string): { privatePem: string; publicLine: string; fingerprint: string } {
  if (!/^\S{1,80}$/.test(name)) throw new PluginError("키 이름은 빈칸 없이 80자까지입니다");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicLine: `${name} ${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`,
    fingerprint: fingerprintOf(publicKey),
  };
}

/** 묶음을 만든다 — files의 해시를 manifest에 적고, 키가 있으면 서명한다 */
export function writePackage(meta: Omit<PluginManifest, "files" | "format" | "api">, files: ReadonlyMap<string, Buffer>, signer?: { name: string; privatePem: string }): Buffer {
  const manifest: PluginManifest = { format: PLUGIN_FORMAT, api: PLUGIN_API, ...meta, files: Object.fromEntries([...files].map(([p, b]) => [p, sha256(b)])) };
  manifestOf(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const zip = new AdmZip();
  zip.addFile("manifest.json", manifestBytes);
  if (signer) {
    const key = createPrivateKey(signer.privatePem);
    const pub = createPublicKey(key);
    const sig: PluginSignature = { key: signer.name, fingerprint: fingerprintOf(pub), sig: sign(null, manifestBytes, key).toString("base64") };
    zip.addFile("signature.json", Buffer.from(`${JSON.stringify(sig, null, 2)}\n`));
  }
  for (const [p, b] of files) zip.addFile(p, b);
  return zip.toBuffer();
}

// ─── 풀기 · 싣기 ───────────────────────────────────────────────────

/** dir에 푼다 — 다 쓴 뒤에 이름을 바꿔 반쯤 풀린 폴더가 남지 않게 */
export function extractPackage(pkg: PluginPackage, dir: string): void {
  if (existsSync(join(dir, "manifest.json"))) return;
  const tmp = `${dir}.part-${process.pid}-${Date.now()}`;
  rmSync(tmp, { recursive: true, force: true });
  for (const [p, b] of pkg.files) { mkdirSync(dirname(join(tmp, p)), { recursive: true }); writeFileSync(join(tmp, p), b); }
  writeFileSync(join(tmp, "manifest.json"), pkg.manifestBytes);
  mkdirSync(dirname(dir), { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
}

/** 풀어 둔 폴더의 manifest */
export function readExtracted(dir: string): PluginManifest {
  return manifestOf(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
}

/** 이 프로그램이 내주는 모듈 — 플러그인 묶음에 넣지 않고 여기 것을 쓴다(같은 Playwright · 같은 엔진) */
export const HOST_MODULES = ["@flowsmith/engine", "@flowsmith/core", "playwright"] as const;
const MARK = "flowsmith-plugin=";
let hooked = false;

/** 플러그인이 HOST_MODULES를 부르면 이 프로그램의 것으로 잇는다 — 플러그인 폴더에는 node_modules가 없다 */
export function installHostHooks(): void {
  if (hooked) return;
  hooked = true;
  const parent = import.meta.resolve("@flowsmith/engine");
  const isHost = (s: string) => HOST_MODULES.some((h) => s === h || s.startsWith(`${h}/`));
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes(MARK) && isHost(specifier)) return nextResolve(specifier, { ...context, parentURL: parent });
      return nextResolve(specifier, context);
    },
  });
}

/**
 * 풀어 둔 플러그인을 싣는다 — 버전마다 주소가 달라 새 버전은 새 모듈로 뜬다(재시작 없이).
 * ★옛 버전의 모듈은 프로세스에 남는다(ESM은 내릴 수 없다) — 돌던 실행은 그것으로 끝까지 간다
 */
export async function loadPlugin(dir: string, manifest: PluginManifest, tag: string): Promise<Extension[]> {
  installHostHooks();
  const url = `${pathToFileURL(join(dir, manifest.main)).href}?${MARK}${encodeURIComponent(`${manifest.id}@${manifest.version}`)}&h=${tag.slice(0, 16)}`;
  let mod: { extensions?: unknown };
  try { mod = (await import(url)) as { extensions?: unknown }; } catch (e) {
    throw new PluginError(`플러그인 «${manifest.name}» ${manifest.version}을 불러올 수 없습니다 — ${(e as Error).message.split("\n")[0]}`);
  }
  if (!Array.isArray(mod.extensions)) throw new PluginError(`플러그인 «${manifest.name}»에 extensions 목록이 없습니다`);
  const exts = mod.extensions as Extension[];
  for (const e of exts) {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.run !== "function") throw new PluginError(`플러그인 «${manifest.name}»의 확장 하나가 모양이 틀렸습니다(id · run)`);
    if (!manifest.nodes.includes(e.id)) throw new PluginError(`플러그인 «${manifest.name}»의 확장 «${e.id}»가 manifest의 nodes에 없습니다`);
  }
  const missing = manifest.nodes.filter((n) => !exts.some((e) => e.id === n));
  if (missing.length) throw new PluginError(`플러그인 «${manifest.name}»에 manifest가 말한 노드 ${missing.join(", ")}가 없습니다`);
  return exts;
}
