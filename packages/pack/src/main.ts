#!/usr/bin/env node
/**
 * flowsmith-ext — 확장을 플러그인 묶음(.fspkg)으로 (PLAN §41)
 *
 *   flowsmith-ext keygen <키 이름> [--out 폴더]                  서명 키 한 벌 — <이름>.key(비밀 · 만드는 쪽만) · <이름>.pub(서버의 믿는 키 목록에 한 줄)
 *   flowsmith-ext build <확장 폴더> [--out 폴더] [--key x.key]    묶음을 만든다(키가 있으면 서명). 이름은 <id>-<version>.fspkg
 *   flowsmith-ext index <폴더>                                    사내 저장소 — 그 폴더의 .fspkg들로 index.json
 *   flowsmith-ext inspect <x.fspkg> [--keys 믿는 키 파일]           묶음 안 — id · 버전 · 노드 · 서명
 *
 * 키 이름은 .key 파일 첫 줄의 «# flowsmith-ext key <이름>»에서 읽는다.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { generateSigningKey, parseTrustedKeys, readPackage, verifySignature } from "@flowsmith/worker";
import { buildPlugin, indexOf } from "./index.ts";

const argv = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (t: string): never => { console.error(t); process.exit(1); };
const [cmd, arg] = argv;

const KEY_HEAD = "# flowsmith-ext key ";

try {
  if (cmd === "keygen") {
    const name = arg ?? die("키 이름을 주세요 — flowsmith-ext keygen 사내배포");
    const out = resolve(opt("--out") ?? ".");
    mkdirSync(out, { recursive: true });
    const k = generateSigningKey(name);
    const keyFile = join(out, `${name}.key`), pubFile = join(out, `${name}.pub`);
    writeFileSync(keyFile, `${KEY_HEAD}${name}\n${k.privatePem}`, { mode: 0o600 });
    chmodSync(keyFile, 0o600);
    writeFileSync(pubFile, `${k.publicLine}\n`);
    console.log(`비밀키: ${keyFile}  ★만드는 쪽만 — 저장소에 올리지 마세요`);
    console.log(`공개키: ${pubFile}  (지문 ${k.fingerprint}) — 서버의 믿는 키 파일(FLOWSMITH_PLUGIN_KEYS)에 이 줄을 더하세요:`);
    console.log(k.publicLine);
  } else if (cmd === "build") {
    const dir = arg ?? die("확장 폴더를 주세요 — flowsmith-ext build extensions/shop");
    const keyPath = opt("--key");
    let signer: { name: string; privatePem: string } | undefined;
    if (keyPath) {
      const text = readFileSync(keyPath, "utf8");
      const first = text.split("\n")[0] ?? "";
      const name = first.startsWith(KEY_HEAD) ? first.slice(KEY_HEAD.length).trim() : basename(keyPath).replace(/\.key$/, "");
      signer = { name, privatePem: text.split("\n").filter((l) => !l.startsWith("#")).join("\n") };
    }
    const built = await buildPlugin(dir, signer ? { signer } : {});
    const out = resolve(opt("--out") ?? join(dir, "dist"));
    mkdirSync(out, { recursive: true });
    const file = join(out, built.name);
    writeFileSync(file, built.file);
    console.log(`${file} — ${built.manifest.name} ${built.manifest.version} · 노드 ${built.manifest.nodes.join(", ")} · ${(built.file.length / 1024).toFixed(0)}KB · ${signer ? `서명 «${signer.name}»` : "서명 없음"}`);
  } else if (cmd === "index") {
    const dir = resolve(arg ?? die("폴더를 주세요 — flowsmith-ext index /srv/flowsmith-plugins"));
    const idx = indexOf(dir);
    writeFileSync(join(dir, "index.json"), `${JSON.stringify(idx, null, 2)}\n`);
    console.log(`${join(dir, "index.json")} — 묶음 ${idx.plugins.length}개`);
  } else if (cmd === "inspect") {
    const p = readPackage(readFileSync(arg ?? die("묶음을 주세요 — flowsmith-ext inspect x.fspkg")));
    const m = p.manifest;
    console.log(`${m.name} (${m.id}) ${m.version} · API ${m.api} · 노드 ${m.nodes.join(", ")} · 파일 ${Object.keys(m.files).length}개 · sha256 ${p.sha256}`);
    const keys = opt("--keys");
    if (!p.signature) console.log("서명 없음");
    else if (keys) console.log(`서명 맞음 — «${verifySignature(p, parseTrustedKeys(readFileSync(keys, "utf8")))!.name}»`);
    else console.log(`서명 «${p.signature.key}» · 지문 ${p.signature.fingerprint} (믿는지 보려면 --keys)`);
  } else {
    die("flowsmith-ext keygen <키 이름> · build <확장 폴더> [--key x.key] · index <폴더> · inspect <x.fspkg>");
  }
} catch (e) {
  die((e as Error).message);
}
