import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 예시 플로우를 새로 읽는다 — 시험마다 고쳐 쓰므로 매번 새 사본 */
export function example(): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
}

export const target = (label = "버튼", css = "#b") => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });

/** 최소 노드들 — 그래프 모양 시험용 */
export const web = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: "web", name: id, position: { x: 0, y: 0 },
  config: { start: { kind: "url", url: "http://x" }, actions: [{ id: "r", kind: "read", output: `${id}Out`, target: target() }] },
  ...extra,
});

export const custom = (id: string, outputs: string[] = [`${id}Out`]) => ({
  id, type: "custom", name: id, position: { x: 0, y: 0 },
  config: { code: "return {}", outputs },
});

export const cond = (id: string, cases: { id: string; then?: unknown }[], elseThen: unknown = { kind: "next" }) => ({
  id, type: "condition", name: id, position: { x: 0, y: 0 },
  config: {
    cases: cases.map((c) => ({ id: c.id, label: c.id, rules: [{ left: "{{ $input.v }}", op: "eq", right: c.id }], then: c.then ?? { kind: "next" } })),
    else: { then: elseThen },
  },
});

export const edge = (id: string, from: string, to: string, port = "out") => ({ id, from: { node: from, port }, to: { node: to } });

export const flow = (nodes: unknown[], edges: unknown[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, id: "f", name: "f", nodes, edges, ...extra,
});
