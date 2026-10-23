/**
 * **flowsmith-ext** — 확장을 플러그인 묶음(.fspkg)으로(PLAN §41). 형식은 @flowsmith/worker의 plugins.ts.
 *
 *   buildPlugin(폴더)   package.json의 «flowsmith»를 읽어 src를 JS 하나로 묶고(rolldown) · 노드 목록을 실제로 불러 확인하고 · 묶음을 만든다
 *   indexOf(폴더)        사내 저장소 — 그 폴더의 .fspkg들로 index.json(서버의 «새 버전 확인»이 읽는다)
 *
 * ★엔진 · 코어 · Playwright는 묶지 않는다 — 서버 · 워커의 것을 쓴다(plugins.ts HOST_MODULES)
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HOST_MODULES, installHostHooks, PLUGIN_ID_RE, readPackage, VERSION_RE, writePackage, type PluginManifest } from "@flowsmith/worker";

export interface BuildOptions {
  /** 서명 — 이름과 비밀키(PEM). 없으면 서명 없는 묶음(서버가 서명을 요구하면 받지 않는다) */
  signer?: { name: string; privatePem: string };
  /** 함께 넣을 파일 — 폴더 기준 경로(예: README.md) */
  extra?: string[];
}

export interface Built { file: Buffer; manifest: PluginManifest; name: string }

interface FlowsmithField { id?: unknown; name?: unknown; main?: unknown; files?: unknown }

const isExternal = (id: string): boolean =>
  id.startsWith("node:") || builtinModules.includes(id) || builtinModules.includes(id.split("/")[0]!) ||
  HOST_MODULES.some((h) => id === h || id.startsWith(`${h}/`));

export async function buildPlugin(dir: string, opts: BuildOptions = {}): Promise<Built> {
  const root = resolve(dir);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string; description?: string; flowsmith?: FlowsmithField };
  const wf = pkg.flowsmith;
  if (!wf || typeof wf !== "object") throw new Error(`${root}/package.json에 «flowsmith» 칸이 없습니다 — { "flowsmith": { "id": "shop", "name": "사내 주문 시스템", "main": "src/index.ts" } }`);
  const id = String(wf.id ?? "");
  if (!PLUGIN_ID_RE.test(id)) throw new Error(`flowsmith.id «${id}» — 영문 소문자로 시작하고 소문자 · 숫자 · -만(2~40자)`);
  const version = String(pkg.version ?? "");
  if (!VERSION_RE.test(version)) throw new Error(`version «${version}» — 1.2.3 꼴로 적으세요(package.json의 version)`);
  const name = typeof wf.name === "string" && wf.name.trim() ? wf.name.trim() : id;
  const main = typeof wf.main === "string" ? wf.main : "src/index.ts";

  const { rolldown } = await import("rolldown");
  const bundle = await rolldown({ input: join(root, main), platform: "node", cwd: root, external: isExternal, logLevel: "silent" });
  let code: string;
  try {
    const out = await bundle.generate({
      format: "esm", codeSplitting: false, minify: false,
      // CJS 의존성(adm-zip 등)이 require를 부른다 — ESM 묶음에 require를 하나 둔다
      banner: 'import { createRequire as __flowsmithRequire } from "node:module"; const require = __flowsmithRequire(import.meta.url);',
    });
    const chunks = out.output.filter((o) => o.type === "chunk");
    if (chunks.length !== 1) throw new Error(`JS가 ${chunks.length}개로 나뉘었습니다 — 하나여야 합니다`);
    code = chunks[0]!.code;
  } finally {
    await bundle.close();
  }

  const files = new Map<string, Buffer>([["index.mjs", Buffer.from(code)]]);
  for (const x of [...(Array.isArray(wf.files) ? wf.files.map(String) : []), ...(opts.extra ?? [])]) files.set(x, readFileSync(join(root, x)));

  // 실제로 불러 노드 목록을 얻는다 — 묶음이 뜨지 않으면 여기서 안다
  const tmp = mkdtempSync(join(tmpdir(), "flowsmith-ext-"));
  let nodes: string[];
  try {
    writeFileSync(join(tmp, "index.mjs"), code);
    installHostHooks();
    const mod = (await import(`${pathToFileURL(join(tmp, "index.mjs")).href}?flowsmith-plugin=build&h=${Date.now()}`)) as { extensions?: { id?: unknown; run?: unknown }[] };
    if (!Array.isArray(mod.extensions) || mod.extensions.length === 0) throw new Error(`${main}이 extensions 목록을 내지 않습니다 — export const extensions: Extension[]`);
    nodes = mod.extensions.map((e) => {
      if (typeof e?.id !== "string" || typeof e.run !== "function") throw new Error("확장 하나가 모양이 틀렸습니다(id · run)");
      if (!e.id.startsWith(`${id}.`)) throw new Error(`확장 «${e.id}» — 노드 id는 «${id}.»로 시작해야 합니다(다른 플러그인과 겹치지 않게)`);
      return e.id;
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const file = writePackage({ id, name, version, description: String(pkg.description ?? ""), main: "index.mjs", nodes, builtAt: new Date().toISOString() }, files, opts.signer);
  return { file, manifest: readPackage(file).manifest, name: `${id}-${version}.fspkg` };
}

/** 사내 저장소의 목록 — 그 폴더의 .fspkg마다 한 줄 */
export interface IndexEntry { id: string; name: string; version: string; description: string; nodes: string[]; file: string; sha256: string; size: number; signer: string | null }
export interface PluginIndex { format: 1; generatedAt: string; plugins: IndexEntry[] }

export function indexOf(dir: string): PluginIndex {
  const plugins = readdirSync(dir).filter((f) => f.endsWith(".fspkg")).sort().map((f): IndexEntry => {
    const p = readPackage(readFileSync(join(dir, f)));
    const m = p.manifest;
    return { id: m.id, name: m.name, version: m.version, description: m.description, nodes: m.nodes, file: basename(f), sha256: p.sha256, size: p.size, signer: p.signature?.key ?? null };
  });
  return { format: 1, generatedAt: new Date().toISOString(), plugins };
}
