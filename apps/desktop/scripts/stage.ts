/**
 * **설치본에 넣을 것을 모은다**(stage) — 저장소와 같은 모양으로(서버가 `../../../apps/studio/dist`를 찾는다).
 *
 *   node apps/desktop/scripts/stage.ts <나갈 폴더>          (먼저 pnpm studio:build)
 *
 *   <폴더>/packages/{core,engine,recorder,server,worker}/{src,package.json}   ★.ts 그대로 — node_modules 밖(Node는 node_modules 안의 .ts를 벗기지 않는다)
 *   <폴더>/apps/studio/dist · apps/desktop/src · build/icon.png(앱 아이콘)
 *   <폴더>/package.json   외부 의존성(위 패키지들의 것을 모은다 · 판이 다르면 멈춘다) + electron-builder 설정(NSIS · asar 끔)
 *
 * 그다음 Windows에서(★짧은 폴더 — 260자):  npm install  →  npx electron-builder --win nsis   → <폴더>/dist/Flowsmith-Setup-<판>.exe
 * macOS(5단계 · ★Mac에서만 — codesign이 있어야 한다):  npm install  →  npx electron-builder --mac --arm64 --x64
 *   → <폴더>/dist/Flowsmith-<판>-mac-{arm64,x64}.dmg  (apps/desktop/scripts/build-mac.sh · CI desktop-mac.yml)
 *   ☆인증서 서명 · 공증은 하지 않는다(사용자 결정 2026-10-24) — ad-hoc 서명(identity "-")만: Apple 실리콘은 서명이 아예 없으면 뜨지 않는다.
 *    그래서 받은 사람은 처음 한 번 «그래도 열기»(시스템 설정 › 개인정보 보호 및 보안)나 `xattr -cr`을 해야 한다
 * `@flowsmith/*`는 boot.ts가 packages/로 잇는다(설치본에는 워크스페이스 링크가 없다).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const out = process.argv[2] ? resolve(process.argv[2]) : join(repo, "apps", "desktop", "stage");
const PACKAGES = ["core", "engine", "recorder", "server", "worker"];
const ELECTRON = "44.9.3";
const BUILDER = "26.17.0";

const studio = join(repo, "apps", "studio", "dist", "index.html");
if (!existsSync(studio)) { console.error("편집 화면이 빌드돼 있지 않습니다 — 먼저 pnpm studio:build"); process.exit(1); }

const readJson = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Record<string, any>;
const desktop = readJson(join(repo, "apps", "desktop", "package.json"));

// 외부 의존성 — 워크스페이스(workspace:*)는 뺀다 · 같은 이름이 다른 판이면 멈춘다
const deps: Record<string, string> = {};
for (const p of PACKAGES) {
  for (const [name, ver] of Object.entries((readJson(join(repo, "packages", p, "package.json"))["dependencies"] ?? {}) as Record<string, string>)) {
    if (ver.startsWith("workspace:")) continue;
    if (deps[name] && deps[name] !== ver) { console.error(`의존성 판이 다릅니다 — ${name}: ${deps[name]} · ${ver}(${p})`); process.exit(1); }
    deps[name] = ver;
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of PACKAGES) {
  cpSync(join(repo, "packages", p, "src"), join(out, "packages", p, "src"), { recursive: true });
  cpSync(join(repo, "packages", p, "package.json"), join(out, "packages", p, "package.json"));
}
cpSync(join(repo, "apps", "studio", "dist"), join(out, "apps", "studio", "dist"), { recursive: true });
cpSync(join(repo, "apps", "desktop", "src"), join(out, "apps", "desktop", "src"), { recursive: true });
// 앱 아이콘 — electron-builder가 build/icon.png(1024) 하나로 Windows .ico · macOS .icns를 만든다(원본 그림은 build/icon.svg)
mkdirSync(join(out, "build"), { recursive: true });
cpSync(join(repo, "apps", "desktop", "build", "icon.png"), join(out, "build", "icon.png"));

writeFileSync(join(out, "package.json"), `${JSON.stringify({
  // ★설치 폴더 이름이 된다 — %LOCALAPPDATA%\Programs\flowsmith
  name: "flowsmith",
  productName: "Flowsmith",
  version: desktop["version"],
  description: "Flowsmith — 웹 자동화 플로우 편집기 · 이 PC의 서버 · 워커",
  author: "Flowsmith",
  private: true,
  type: "module",
  main: "apps/desktop/src/main.ts",
  dependencies: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))),
  devDependencies: { electron: ELECTRON, "electron-builder": BUILDER },
  build: {
    appId: "com.flowsmith.desktop",
    productName: "Flowsmith",
    electronVersion: ELECTRON,
    // ★asar 끔 — 서버 · 워커는 .ts를 그대로 읽고(타입만 벗긴다) 녹화 스크립트 · 편집 화면을 파일로 읽는다
    asar: false,
    npmRebuild: false,
    directories: { output: "dist", buildResources: "build" },
    files: ["**/*", "!dist/**", "!build/**"],
    win: { target: [{ target: "nsis", arch: ["x64"] }], artifactName: "Flowsmith-Setup-${version}.${ext}" },
    // 사람마다 설치(관리자 권한 없이) — %LOCALAPPDATA%\Programs\flowsmith(짧은 경로 · 이름은 위 name)
    nsis: { oneClick: true, perMachine: false, shortcutName: "Flowsmith", deleteAppDataOnUninstall: false },
    // macOS — dmg(끌어다 «응용 프로그램»에) · 인증서 서명 · 공증 없이 ad-hoc 서명만(Apple 실리콘은 서명이 아예 없으면 뜨지 않는다)
    mac: {
      target: [{ target: "dmg", arch: ["arm64", "x64"] }],
      category: "public.app-category.developer-tools",
      identity: "-", hardenedRuntime: false, gatekeeperAssess: false, notarize: false,
      artifactName: "Flowsmith-${version}-mac-${arch}.${ext}",
    },
    dmg: { title: "Flowsmith ${version}" },
  },
}, null, 2)}\n`);

console.log(`모았습니다 → ${out}`);
console.log(`외부 의존성: ${Object.entries(deps).map(([k, v]) => `${k}@${v}`).join(" · ")}`);
console.log("다음(Windows · 짧은 폴더): npm install → npx electron-builder --win nsis");
