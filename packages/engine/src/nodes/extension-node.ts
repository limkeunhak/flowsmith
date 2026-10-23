/**
 * **확장 노드** — 워커에 설치된 코드 모듈(확장)을 부른다 (PLAN 결정 8 · extensions.ts가 레지스트리).
 */
import { evaluate, type ExtensionNode, type Output, type Scope } from "@flowsmith/core";
import type { ExtensionRegistry } from "../extensions.ts";

/**
 * 확장 노드 — 등록된 확장을 찾아 값을 채워 부른다.
 * ★확장이 돌려준 것 중 **노드에 적힌 이름만** 내보낸다(뒤 노드의 `$input.x` 검사가 그걸 보고 했다). 없으면 null.
 */
export async function runExtensionNode(node: ExtensionNode, scope: Scope, opts: { extensions?: ExtensionRegistry }, cdpUrl: string, log: (t: string) => void, pii: (key: string) => void): Promise<Output> {
  const ext = opts.extensions?.get(node.config.extension);
  if (!ext) throw new Error(`이 워커에 확장 '${node.config.extension}'가 설치돼 있지 않습니다`);
  for (const k of ext.pii ?? []) pii(k);
  const noSecrets: Scope = { ...scope, secrets: {} };
  const options: Record<string, string> = {};
  for (const o of ext.options) {
    const raw = node.config.options[o.name] ?? o.default ?? "";
    const v = raw === "" ? "" : evaluate(raw, noSecrets).value;
    const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (o.required && s.trim() === "") throw new Error(`확장 값 '${o.label}'(${o.name})이 비었습니다`);
    options[o.name] = s;
  }
  const result = await ext.run({
    input: scope.input, options, params: scope.params as Record<string, string>, vars: scope.vars, cdpUrl, log,
  });
  if (result === null || typeof result !== "object" || Array.isArray(result)) throw new Error(`확장 '${ext.id}'가 객체를 돌려주지 않았습니다`);
  const picked = Object.fromEntries(node.config.outputs.map((k) => [k, (result as Output)[k] ?? null]));
  return JSON.parse(JSON.stringify(picked)) as Output;
}
