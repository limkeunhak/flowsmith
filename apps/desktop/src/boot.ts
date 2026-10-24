/**
 * **서버(또는 워커)를 띄우는 입구**(Electron utilityProcess) — 앱이 `FLOWSMITH_APP_ROOT`(저장소 · 설치본의 뿌리)를 준다.
 * `FLOWSMITH_BOOT=agent`면 회사 서버의 워커(agent.ts) · 아니면 이 PC의 서버(로컬 모드).
 *
 * ★설치본에는 `node_modules/@flowsmith/*` 링크가 없다 — 워크스페이스 패키지를 `packages/*`에 그대로 싣고(.ts — Node가 타입만 벗긴다),
 *  `@flowsmith/<이름>[/길]`을 그 package.json의 exports로 잇는다. ☆node_modules 안의 .ts는 Node가 타입을 벗기지 않는다 — 그래서 밖에 둔다.
 *  개발(pnpm)에서는 링크가 있으니 잇지 않는다.
 */
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env["FLOWSMITH_APP_ROOT"];
if (!root) throw new Error("FLOWSMITH_APP_ROOT가 없습니다 — 데스크톱 앱이 띄워야 합니다");

if (!existsSync(join(root, "node_modules", "@flowsmith"))) {
  const exportsOf = new Map<string, Record<string, string>>();
  const lookup = (name: string, sub: string): string | null => {
    let ex = exportsOf.get(name);
    if (!ex) {
      const file = join(root, "packages", name, "package.json");
      if (!existsSync(file)) return null;
      const raw = (JSON.parse(readFileSync(file, "utf8")) as { exports?: string | Record<string, string> }).exports ?? "./src/index.ts";
      ex = typeof raw === "string" ? { ".": raw } : raw;
      exportsOf.set(name, ex);
    }
    const target = ex[sub];
    return target ? pathToFileURL(join(root, "packages", name, target)).href : null;
  };
  registerHooks({
    resolve(specifier, context, next) {
      const m = /^@flowsmith\/([a-z0-9-]+)(\/.+)?$/.exec(specifier);
      if (m) { const url = lookup(m[1]!, m[2] ? `.${m[2]}` : "."); if (url) return { url, shortCircuit: true }; }
      return next(specifier, context);
    },
  });
}

// 로컬 모드면 이 PC의 서버 · 회사 서버 모드면 그 서버의 워커(agent.ts)
await import(process.env["FLOWSMITH_BOOT"] === "agent"
  ? new URL("./agent.ts", import.meta.url).href
  : pathToFileURL(join(root, "packages", "server", "src", "main.ts")).href);
