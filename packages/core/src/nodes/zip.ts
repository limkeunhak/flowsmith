/**
 * **압축(zip) 노드**(PLAN §52) — 이 워크플로우(또는 공유) 폴더의 파일들을 zip 하나로 묶는다.
 * 앞 노드가 모은 PDF · 캡처 · CSV를 한 번에 내려받게. 압축은 파일이 있는 서버에서 한다(엔진 FileOps.zip).
 *
 *   from   묶을 폴더(표현식) · 포함 규칙(glob — `**` 폴더 넘어 · `*` 한 마디 · `?` 한 글자, 비우면 모두)
 *   to     결과 폴더 · 이름(표현식 · .zip은 붙여 준다)
 *   ifExists  이미 있으면 덮어쓰기 · 멈추기
 *
 * ★결과 zip 자신 · 쓰다 만 파일(.part)은 묶지 않는다. ZIP64는 쓰지 않는다 — 65,535개 · 4GB를 넘으면 멈춘다.
 */
import type { StoreScope } from "./file.ts";

export interface ZipConfig {
  from: { scope: StoreScope; dir: string; include: string[] };
  to: { scope: StoreScope; dir: string; name: string };
  ifExists: "overwrite" | "fail";
}

export const ZIP_IF_EXISTS = ["overwrite", "fail"] as const;
export const ZIP_OUTPUTS = ["file", "count", "bytes"] as const;
/** ZIP64 없이 담을 수 있는 한도 */
export const ZIP_LIMITS = { maxEntries: 65_535, maxBytes: 0xffff_ffff } as const;

export function withZipDefaults(c: Partial<ZipConfig> | undefined): ZipConfig {
  return {
    from: { scope: c?.from?.scope ?? "flow", dir: c?.from?.dir ?? "", include: c?.from?.include ?? [] },
    to: { scope: c?.to?.scope ?? "flow", dir: c?.to?.dir ?? "", name: c?.to?.name ?? "묶음" },
    ifExists: c?.ifExists ?? "overwrite",
  };
}

/** 결과 파일 이름 — .zip을 붙인다(이미 있으면 그대로) */
export const zipFileName = (name: string): string => (/\.zip$/iu.test(name) ? name : `${name}.zip`);

/** glob → 정규식(묶을 폴더 기준 상대 경로에) — `**`는 폴더를 넘고 `*` · `?`는 한 마디 안 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  const g = glob.trim().replace(/^\.\//u, "");
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!;
    if (ch === "*" && g[i + 1] === "*") {
      // «**/»는 0개 이상의 폴더 · 끝의 «**»는 무엇이든
      if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${re}$`, "u");
}

/** 그 파일을 묶나 — 규칙이 없으면 모두 · 하나라도 맞으면. 대소문자는 가리지 않는다(.PDF · .pdf) */
export function zipIncludes(include: readonly string[], rel: string): boolean {
  const pats = include.map((p) => p.trim()).filter((p) => p !== "");
  if (pats.length === 0) return true;
  return pats.some((p) => new RegExp(globToRegExp(p).source, "iu").test(rel));
}
