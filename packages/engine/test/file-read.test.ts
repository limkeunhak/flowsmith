/**
 * 파일 읽기 · 다른 플로우 실행 — 브라우저 없이.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkFlow, parseFlow,
  type FileReadConfig, type FileReadNode, type FileStoreTarget, type FileWriteNode, type FlowCallConfig, type FlowCallNode, type Scope,
} from "@flowsmith/core";
import { runFileReadNode, runFileWriteNode, runFlowCallNode, type CallFlowRequest } from "../src/index.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "flowsmith-read-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const WRITER = "aaaaaaaa-0000-4000-8000-000000000001";
const READER = "bbbbbbbb-0000-4000-8000-000000000002";
const at = (y: number, mo: number, d: number, h = 9) => new Date(y, mo - 1, d, h, 0, 0);
const D14 = at(2026, 10, 14), D15 = at(2026, 10, 15), D16 = at(2026, 10, 16);
const scope = (input: Record<string, unknown> = {}): Scope => ({ input, nodes: {}, params: {}, vars: {}, secrets: {} });
const logs: string[] = [];

const write = (t: Partial<FileStoreTarget>, rows: unknown[], now: Date, uid = WRITER) => {
  const node: FileWriteNode = { id: "w", name: "쓰기", type: "fileWrite", position: { x: 0, y: 0 }, config: { data: "{{ $input.rows }}", target: {
    kind: "file", scope: "flow", dir: "", name: "orders", format: "csv", mode: "append", rolling: { kind: "time", unit: "day" },
    csv: { header: true, bom: true, columns: null }, dedupeKey: null, stampColumn: null, keepDays: null, ...t,
  } } };
  return runFileWriteNode(node, scope({ rows }), { root, flowUid: uid }, () => undefined, now);
};
const readNode = (src: Partial<FileReadConfig["source"]>, extra: Partial<FileReadConfig> = {}): FileReadNode => ({
  id: "r", name: "읽기", type: "fileRead", position: { x: 0, y: 0 }, config: {
    source: { scope: "otherFlow", flowId: "writer", dir: "", name: "orders", format: "csv", pick: { kind: "latest" }, csv: { header: true }, ...src },
    missing: "fail", maxRows: null, ...extra,
  },
});
const read = (n: FileReadNode, now = D16) => runFileReadNode(n, { root, flowUid: READER, flowUids: { writer: WRITER } }, (s) => logs.push(s), now);

describe("파일 읽기", () => {
  it("★다른 워크플로우가 날마다 쓴 파일 — 가장 최근 · 어제 · 날짜로", async () => {
    await write({}, [{ orderNo: "A-1", 상태: "새" }], D14);
    await write({}, [{ orderNo: "A-2", 상태: "새" }, { orderNo: "A-3", 상태: "새, 급함" }], D15);
    expect(await read(readNode({}))).toEqual({
      file: `${WRITER}/orders-20261015.csv`, count: 2,
      rows: [{ orderNo: "A-2", 상태: "새" }, { orderNo: "A-3", 상태: "새, 급함" }],
    });
    // 16일에 «어제 파일»은 15일 것 · «이번 날»은 아직 없다
    expect((await read(readNode({ pick: { kind: "time", unit: "day", offset: -1 } }))).file).toBe(`${WRITER}/orders-20261015.csv`);
    expect((await read(readNode({ pick: { kind: "time", unit: "day", offset: -2 } }))).count).toBe(1);
    await expect(read(readNode({ pick: { kind: "time", unit: "day", offset: 0 } }))).rejects.toThrow(/읽을 파일이 없습니다 — 워크플로우 「writer」의 폴더의 orders-20261016\.csv/);
  });

  it("번호 롤링은 가장 큰 번호 · 롤링 없음은 이름 그대로", async () => {
    for (let i = 0; i < 3; i++) await write({ rolling: { kind: "sequence", every: "run", limit: null } }, [{ n: i }], D15);
    expect(await read(readNode({ format: "csv" }))).toMatchObject({ file: `${WRITER}/orders-0003.csv`, rows: [{ n: "2" }] });
    await write({ rolling: { kind: "none" }, name: "fixed", format: "jsonl" }, [{ n: 1 }, { n: 2 }], D15);
    expect(await read(readNode({ name: "fixed", format: "jsonl", pick: { kind: "fixed" } }))).toMatchObject({ file: `${WRITER}/fixed.jsonl`, rows: [{ n: 1 }, { n: 2 }] });
  });

  it("형식 — JSON 배열 · 텍스트 · 머리줄 없는 CSV · 최대 줄 수", async () => {
    await write({ format: "json", rolling: { kind: "none" } }, [{ a: 1 }, { a: 2 }, { a: 3 }], D15);
    expect(await read(readNode({ format: "json", pick: { kind: "fixed" } }, { maxRows: 2 }))).toMatchObject({ count: 2, rows: [{ a: 1 }, { a: 2 }] });
    expect(logs.at(-2)).toMatch(/3줄 중 앞 2줄만/);
    await write({ format: "text", rolling: { kind: "none" } }, ["첫 줄", "둘째 줄"], D15);
    expect((await read(readNode({ format: "text", pick: { kind: "fixed" } }))).rows).toEqual(["첫 줄", "둘째 줄"]);
    await write({ rolling: { kind: "none" }, name: "nohead", csv: { header: false, bom: false, columns: null } }, [{ a: "x", b: "y" }], D15);
    expect((await read(readNode({ name: "nohead", pick: { kind: "fixed" }, csv: { header: false } }))).rows).toEqual([{ 열1: "x", 열2: "y" }]);
  });

  it("공유 폴더 · 이 워크플로우 폴더 · 없으면 빈 목록으로", async () => {
    await write({ scope: "shared", name: "common" }, [{ a: 1 }], D15, WRITER);
    expect(await read(readNode({ scope: "shared", flowId: null, name: "common" }))).toMatchObject({ file: "shared/common-20261015.csv", count: 1 });
    await write({ name: "mine" }, [{ a: 1 }], D15, READER);
    expect((await read(readNode({ scope: "flow", flowId: null, name: "mine" }))).file).toBe(`${READER}/mine-20261015.csv`);
    expect(await read(readNode({ name: "none" }, { missing: "empty" }))).toEqual({ rows: [], file: null, count: 0 });
  });

  it("★모르는 워크플로우 · 뿌리 밖은 못 읽는다", async () => {
    await expect(read(readNode({ flowId: "nobody" }))).rejects.toThrow(/워크플로우 「nobody」를 찾지 못했습니다/);
    await expect(runFileReadNode(readNode({}), { root, flowUids: { writer: "../etc" } }, () => undefined, D15)).rejects.toThrow(/찾지 못했습니다/);
    await expect(read(readNode({ dir: "../x" }))).rejects.toThrow(/「\.\.」/);
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(join(root, "outside", "orders.csv"), "a\n1\n");
    await expect(read(readNode({ flowId: "writer", dir: "../outside", pick: { kind: "fixed" } }))).rejects.toThrow();
  });
});

describe("다른 워크플로우 실행", () => {
  const callNode = (c: Partial<FlowCallConfig>): FlowCallNode => ({ id: "c", name: "부르기", type: "flowCall", position: { x: 0, y: 0 }, config: {
    flowId: "one", version: "active", items: "{{ $input.rows }}", params: { orderNo: "{{ $item.orderNo }}", note: "{{ $input.note }}-{{ $item.orderNo }}" },
    concurrency: 1, onError: "stop", ...c,
  } });
  const rows = [{ orderNo: "A-1" }, { orderNo: "A-2" }, { orderNo: "BAD" }, { orderNo: "A-4" }];

  it("★행마다 한 번씩 — $item으로 그 행의 값을 실행 입력에", async () => {
    const calls: CallFlowRequest[] = [];
    const out = await runFlowCallNode(callNode({ onError: "continue" }), scope({ rows, note: "n" }), async (r) => {
      calls.push(r);
      return r.params["orderNo"] === "BAD"
        ? { runId: `run-${r.index}`, status: "failure", message: "취소된 주문입니다", output: {} }
        : { runId: `run-${r.index}`, status: "success", message: "", output: { got: r.params["orderNo"] } };
    }, (s) => logs.push(s));
    expect(calls.map((c) => [c.index, c.flowId, c.version, c.params])).toEqual([
      [0, "one", "active", { orderNo: "A-1", note: "n-A-1" }], [1, "one", "active", { orderNo: "A-2", note: "n-A-2" }],
      [2, "one", "active", { orderNo: "BAD", note: "n-BAD" }], [3, "one", "active", { orderNo: "A-4", note: "n-A-4" }],
    ]);
    expect(out).toMatchObject({ succeeded: 3, failed: 1 });
    expect((out["results"] as any[]).map((r) => [r.index, r.status, r.output])).toEqual([[0, "success", { got: "A-1" }], [1, "success", { got: "A-2" }], [2, "failure", {}], [3, "success", { got: "A-4" }]]);
  });

  it("★실패하면 멈춘다 — 남은 행은 부르지 않고, 몇 번째 행인지 말한다", async () => {
    const seen: string[] = [];
    await expect(runFlowCallNode(callNode({}), scope({ rows, note: "n" }), async (r) => {
      seen.push(r.params["orderNo"]!);
      return r.params["orderNo"] === "BAD" ? { runId: "x", status: "failure", message: "취소된 주문입니다", output: {} } : { runId: "y", status: "success", message: "", output: {} };
    }, () => undefined)).rejects.toThrow(/3번째 행에서 one 실행이 실패해 멈췄습니다 — 취소된 주문입니다 \(남은 1개는 부르지 않음\)/);
    expect(seen).toEqual(["A-1", "A-2", "BAD"]);
  });

  it("동시에 n개까지 · 한 번만 · 빈 목록", async () => {
    let inflight = 0, peak = 0;
    const slow = async () => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 20)); inflight--; return { runId: "r", status: "success" as const, message: "", output: {} }; };
    const many = Array.from({ length: 7 }, (_, i) => ({ orderNo: `A-${i}` }));
    expect(await runFlowCallNode(callNode({ concurrency: 3 }), scope({ rows: many, note: "" }), slow, () => undefined)).toMatchObject({ succeeded: 7 });
    expect(peak).toBe(3);
    const once: CallFlowRequest[] = [];
    await runFlowCallNode(callNode({ items: "", params: { orderNo: "{{ $input.no }}" } }), scope({ no: "Z-1" }), async (r) => { once.push(r); return { runId: "r", status: "success", message: "", output: {} }; }, () => undefined);
    expect(once.map((r) => r.params)).toEqual([{ orderNo: "Z-1" }]);
    expect(await runFlowCallNode(callNode({}), scope({ rows: [], note: "" }), slow, () => undefined)).toEqual({ results: [], succeeded: 0, failed: 0 });
    await expect(runFlowCallNode(callNode({}), scope({ rows }), undefined, () => undefined)).rejects.toThrow(/서버에서 돌리세요/);
  });

  it("검문소 — $item은 행마다 도는 실행 입력에서만 · 자기 자신은 못 부른다 · 옛 이름 store는 fileWrite로", () => {
    const flow = (call: Partial<FlowCallConfig>, extra: unknown[] = []) => ({
      schemaVersion: 1, id: "me", name: "me", params: [],
      nodes: [
        { id: "r", type: "fileRead", name: "읽기", position: { x: 0, y: 0 }, config: { source: { scope: "otherFlow", flowId: "writer", name: "orders" } } },
        { id: "c", type: "flowCall", name: "부르기", position: { x: 0, y: 0 }, config: { flowId: "one", items: "{{ $input.rows }}", params: { orderNo: "{{ $item.orderNo }}" }, ...call } },
        ...extra,
      ],
      edges: [{ id: "e", from: { node: "r", port: "out" }, to: { node: "c" } }],
    });
    expect(checkFlow(flow({}))).toEqual([]);
    expect(checkFlow(flow({ items: "" })).join()).toMatch(/\$item은 «다른 워크플로우 실행»이 행마다 돌 때/);
    expect(checkFlow(flow({ flowId: "me" })).join()).toMatch(/자기 자신을 부를 수 없습니다/);
    expect(checkFlow(flow({ items: "{{ $input.nope }}" })).join()).toMatch(/"nope"를 내놓지 않습니다 \(들어오는 것: rows · file · count\)/);
    const old = parseFlow(flow({}, [{ id: "w", type: "store", name: "저장", position: { x: 0, y: 0 }, config: { data: "x", target: { kind: "file", name: "out" } } }]) as any);
    expect(old.nodes.find((n) => n.id === "w")!.type).toBe("fileWrite");
  });
});
