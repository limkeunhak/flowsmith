/**
 * 실행 상태 — **다음에 무엇을 돌릴지**를 브라우저 없이 정한다 (PLAN §3.2).
 *
 * 실행기는 이렇게만 쓴다:
 *
 *   const st = new RunState(compiled);
 *   for (let job = st.next(); job; job = st.next()) {
 *     try   { st.succeed(job.nodeId, await run(job.node, job.input), 고른 갈래) }
 *     catch { st.fail(job.nodeId, 메시지) }
 *   }
 *   st.outcome
 *
 * 규칙:
 *   - 한 번에 하나씩, 위상 순서대로 (웹페이지 노드들이 브라우저 하나를 같이 쓴다)
 *   - 들어오는 엣지가 전부 건너뛰어졌으면 그 노드도 건너뛴다
 *   - 값을 받은 엣지들의 객체를 엣지 순서대로 얕게 합친 것이 입력이다
 *   - 조건 노드가 «종료» 갈래를 고르면 플로우가 그 상태로 끝난다
 *   - 노드 하나가 실패하면 플로우가 실패한다. 남은 노드는 `cancelled`
 *   - 노드가 **막히면**(고르면 안 되는 행 — `block`) 막힘 갈래로만 이어 가고, 끝까지 가면 플로우가 «막힘»으로 끝난다
 */
import type { CompiledFlow } from "./graph.ts";
import { BLOCKED_PORT } from "./flow.ts";
import type { FlowNode } from "./model.ts";

/** blocked — 고르면 안 되는 행에 걸려 막힘 갈래로 갔다(실패가 아니다 · 막힘 갈래를 이었을 때만) */
export type NodeStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled" | "blocked";

export type Output = Record<string, unknown>;

export interface Job {
  nodeId: string;
  node: FlowNode;
  input: Output;
}

export type Outcome =
  | { status: "running" }
  | { status: "success"; message: string; output: Output }
  | { status: "failure"; message: string; failedNode: string | null }
  /** 막힘 갈래로 끝까지 갔다 — 어느 노드가 · 왜 */
  | { status: "blocked"; message: string; blockedNode: string; output: Output };

type EdgeState = { kind: "pending" } | { kind: "delivered"; value: Output } | { kind: "skipped" };

export class RunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStateError";
  }
}

export class RunState {
  readonly #c: CompiledFlow;
  readonly #status = new Map<string, NodeStatus>();
  readonly #edges = new Map<string, EdgeState>();
  readonly #outputs = new Map<string, Output>();
  #outcome: Outcome = { status: "running" };
  /** 막힌 노드 · 까닭 — 끝나면 «막힘»으로 */
  #blocked: { nodeId: string; message: string } | null = null;

  constructor(compiled: CompiledFlow) {
    if (compiled.problems.length > 0) throw new RunStateError("문제가 있는 워크플로우는 돌릴 수 없습니다 — parseFlow를 먼저 통과시키세요");
    this.#c = compiled;
    for (const id of compiled.order) this.#status.set(id, "pending");
    for (const e of compiled.flow.edges) this.#edges.set(e.id, { kind: "pending" });
  }

  status(nodeId: string): NodeStatus {
    return this.#status.get(nodeId) ?? "pending";
  }

  /** 성공한 노드들의 출력 — 표현식의 `$node.x.y`가 여기서 꺼낸다 */
  get outputs(): Record<string, Output> {
    return Object.fromEntries(this.#outputs);
  }

  get outcome(): Outcome {
    return this.#outcome;
  }

  /** 다음에 돌릴 노드. 없으면 null이고, 그때 `outcome`이 정해져 있다 */
  next(): Job | null {
    if (this.#outcome.status !== "running") return null;
    if ([...this.#status.values()].includes("running")) throw new RunStateError("앞 노드가 아직 끝나지 않았습니다 — 한 번에 하나씩 돈다");

    for (const id of this.#c.order) {
      if (this.#status.get(id) !== "pending") continue;
      const inc = this.#c.incoming.get(id)!;
      const states = inc.map((e) => this.#edges.get(e.id)!);
      if (states.some((s) => s.kind === "pending")) {
        // 위상 순서대로 하나씩 돌리면 여기 올 수 없다 — 오면 위의 규칙이 깨진 것이다
        throw new RunStateError(`노드 ${id}의 앞 노드가 아직 끝나지 않았습니다`);
      }
      if (inc.length > 0 && states.every((s) => s.kind === "skipped")) {
        this.#status.set(id, "skipped");
        this.#skipOut(id);
        continue;
      }
      const input: Output = {};
      for (const s of states) if (s.kind === "delivered") Object.assign(input, s.value);
      this.#status.set(id, "running");
      return { nodeId: id, node: this.#c.node.get(id)!, input };
    }
    this.#finish();
    return null;
  }

  /**
   * 노드가 끝났다.
   * 조건 노드는 `port`(고른 갈래)를 꼭 준다. 그 갈래가 «종료»면 플로우가 끝난다.
   */
  succeed(nodeId: string, output: Output, port?: string): void {
    const n = this.#running(nodeId);
    this.#status.set(nodeId, "succeeded");
    this.#outputs.set(nodeId, output);

    if (n.type !== "condition") {
      // ★막힘 갈래는 막혔을 때만(block) — 성공하면 건너뛴다
      for (const e of this.#c.outgoing.get(nodeId)!) this.#edges.set(e.id, e.from.port === BLOCKED_PORT ? { kind: "skipped" } : { kind: "delivered", value: output });
      return;
    }
    const branch = n.config.cases.find((c) => c.id === port)?.then ?? (port === "else" ? n.config.else.then : undefined);
    if (branch === undefined) throw new RunStateError(`${nodeId}: 고른 갈래 "${port}"가 없습니다`);
    for (const e of this.#c.outgoing.get(nodeId)!) {
      this.#edges.set(e.id, e.from.port === port ? { kind: "delivered", value: output } : { kind: "skipped" });
    }
    if (branch.kind === "end") {
      this.#cancelRest();
      this.#outcome = branch.status === "success"
        ? { status: "success", message: branch.message, output }
        : { status: "failure", message: branch.message, failedNode: null };
    }
  }

  /**
   * 노드가 막혔다(고르면 안 되는 행) — 막힘 갈래로만 값을 넘기고 다른 갈래는 건너뛴다.
   * ★막힘 갈래가 이어져 있을 때만 부른다(아니면 fail) — 실행기가 정한다
   */
  block(nodeId: string, output: Output, port: string, message: string): void {
    this.#running(nodeId);
    this.#status.set(nodeId, "blocked");
    this.#outputs.set(nodeId, output);
    for (const e of this.#c.outgoing.get(nodeId)!) this.#edges.set(e.id, e.from.port === port ? { kind: "delivered", value: output } : { kind: "skipped" });
    this.#blocked ??= { nodeId, message };
  }

  fail(nodeId: string, message: string): void {
    this.#running(nodeId);
    this.#status.set(nodeId, "failed");
    this.#cancelRest();
    this.#outcome = { status: "failure", message, failedNode: nodeId };
  }

  #running(nodeId: string): FlowNode {
    if (this.#status.get(nodeId) !== "running") throw new RunStateError(`${nodeId}는 지금 돌고 있는 노드가 아닙니다`);
    return this.#c.node.get(nodeId)!;
  }

  #skipOut(nodeId: string): void {
    for (const e of this.#c.outgoing.get(nodeId)!) this.#edges.set(e.id, { kind: "skipped" });
  }

  #cancelRest(): void {
    for (const [id, s] of this.#status) if (s === "pending") this.#status.set(id, "cancelled");
  }

  /** 끝까지 왔다 — 결과는 «뒤로 값을 넘기지 않은» 성공 노드들의 출력을 순서대로 합친 것 */
  #finish(): void {
    const output: Output = {};
    for (const id of this.#c.order) {
      if (this.#status.get(id) !== "succeeded") continue;
      const passedOn = this.#c.outgoing.get(id)!.some((e) => this.#edges.get(e.id)!.kind === "delivered");
      if (!passedOn) Object.assign(output, this.#outputs.get(id));
    }
    this.#outcome = this.#blocked
      ? { status: "blocked", message: this.#blocked.message, blockedNode: this.#blocked.nodeId, output }
      : { status: "success", message: "", output };
  }
}
