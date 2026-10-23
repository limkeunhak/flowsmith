/**
 * **앞 단계 재생** — 녹화하려는 노드의 시작 지점까지 가려고 앞 노드들만 돌리는 플로우를 만든다.
 */
import type { Flow } from "@flowsmith/core";

/**
 * 재생용 플로우 — 녹화할 노드의 **뒤쪽은 빼고**, 그 노드는 `keep`이면 그대로, 아니면 자리만 남긴다.
 * ★녹화하려는 노드는 대개 비어 있거나 덜 만들어져 있다. 그 때문에 앞 단계 재생까지 막히면 안 된다 —
 *  재생에 필요한 건 앞 노드들뿐이다.
 */
export function replayDraft(draft: Flow, nodeId: string, keep: boolean): Flow {
  const after = new Set<string>();
  const stack = draft.edges.filter((e) => e.from.node === nodeId).map((e) => e.to.node);
  while (stack.length) {
    const id = stack.pop()!;
    if (after.has(id) || id === nodeId) continue;
    after.add(id);
    for (const e of draft.edges) if (e.from.node === id) stack.push(e.to.node);
  }
  const placeholder = (n: Flow["nodes"][number]) => ({
    ...n, type: "web" as const,
    config: { start: { kind: "url" as const, url: "about:blank" }, actions: [{ id: "noop", kind: "wait" as const, wait: { kind: "fixed" as const, ms: 1 }, risk: "safe" as const, timeoutMs: null, optional: false }] },
  });
  return {
    ...draft,
    nodes: draft.nodes.filter((n) => !after.has(n.id)).map((n) => (n.id === nodeId && !keep ? placeholder(n) : n)),
    edges: draft.edges.filter((e) => !after.has(e.from.node) && !after.has(e.to.node) && e.from.node !== nodeId),
  };
}
