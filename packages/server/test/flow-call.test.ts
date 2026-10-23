/**
 * 파일 읽기 → 다른 플로우 실행 — 한 플로우가 쓴 주문 목록을 다른 플로우가 읽어, 행마다 «주문 조회» 플로우를 돌린다.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);

let site: TestSite;
let app: App;
let dir: string;

const pos = { x: 0, y: 0 };
const run = async (flowId: string) => {
  const { runId } = (await call("POST", `/api/flows/${flowId}/runs`, { version: "draft" })).body;
  await app.runs.wait(runId);
  return (await call("GET", `/api/runs/${runId}`)).body;
};

/** 주문 목록을 날짜 파일에 쓰는 플로우 */
const writer = {
  schemaVersion: 1, id: "orders-writer", name: "주문 목록 쓰기",
  nodes: [
    { id: "make", type: "custom", name: "목록", position: pos, config: { code: "return { orders: [{ orderNo: 'A-1001', 메모: '첫째' }, { orderNo: 'A-1002', 메모: '둘째' }] };", outputs: ["orders"] } },
    { id: "save", type: "fileWrite", name: "파일 쓰기", position: pos, config: { data: "{{ $input.orders }}", target: { kind: "file", scope: "flow", name: "orders", rolling: { kind: "time", unit: "day" } } } },
  ],
  edges: [{ id: "e1", from: { node: "make", port: "out" }, to: { node: "save" } }],
};
/** 그 파일을 읽어 행마다 «주문 조회»를 돌리는 플로우 */
const reader = (onError: "stop" | "continue") => ({
  schemaVersion: 1, id: `orders-reader-${onError}`, name: "주문마다 조회",
  nodes: [
    { id: "read", type: "fileRead", name: "파일 읽기", position: pos, config: { source: { scope: "otherFlow", flowId: "orders-writer", name: "orders", format: "csv", pick: { kind: "latest" } } } },
    { id: "each", type: "flowCall", name: "주문마다", position: pos, config: { flowId: "login-and-read", version: "active", items: "{{ $input.rows }}", params: { orderNo: "{{ $item.orderNo }}" }, onError } },
  ],
  edges: [{ id: "e1", from: { node: "read", port: "out" }, to: { node: "each" } }],
});

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-call-"));
  const filesDir = join(dir, "files");
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker({ filesDir }), filesDir, monitor: false, schedule: false });
  const example = JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
  example.vars.baseUrl = site.url;
  example.settings.monitorIntervalMin = null;
  await call("POST", "/api/flows", { draft: example });
  await call("PUT", "/api/flows/login-and-read/secrets/shop", { value: { username: "kim", password: "p@ss" } });
  for (const f of [writer, reader("stop"), reader("continue")]) expect((await call("POST", "/api/flows", { draft: f })).status).toBe(201);
});
afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("파일 읽기 → 다른 워크플로우 실행", () => {
  it("게시하지 않은 워크플로우를 «게시된 버전»으로 부르면 그 이유로 실패한다", async () => {
    expect((await run("orders-writer")).status).toBe("success");
    const r = await run("orders-reader-stop");
    expect(r.status).toBe("failure");
    expect(r.result.nodes.find((n: any) => n.id === "each").failure.message).toMatch(/1번째 행에서 login-and-read 실행이 실패해 멈췄습니다 — .*배포된 버전이 없습니다/);
  }, 60_000);

  it("★다른 워크플로우가 쓴 파일을 읽어 행마다 돌린다 — 행마다 실행 기록이 «다른 워크플로우»로, 부른 실행과 이어져 남는다", async () => {
    await call("POST", "/api/flows/login-and-read/versions", {});
    await call("POST", "/api/flows/login-and-read/deploy", { version: 1 });

    const r = await run("orders-reader-continue");
    expect(r.status, r.message).toBe("success");
    const read = r.result.nodes.find((n: any) => n.id === "read");
    const writerUid = (await call("GET", "/api/flows/orders-writer")).body.uid;
    expect(read.output.file).toMatch(new RegExp(`^${writerUid}/orders-\\d{8}\\.csv$`));
    expect(read.output.rows).toEqual([{ orderNo: "A-1001", 메모: "첫째" }, { orderNo: "A-1002", 메모: "둘째" }]);

    const each = r.result.nodes.find((n: any) => n.id === "each").output;
    expect(each).toMatchObject({ succeeded: 1, failed: 1 });
    expect(each.results.map((x: any) => [x.index, x.status, x.message, x.output])).toEqual([
      [0, "success", expect.any(String), { amountNumber: 12500, status: "배송중" }],
      [1, "failure", expect.stringMatching(/.+/), expect.any(Object)],   // 실패한 행도 이유와 함께 남는다
    ]);
    const child = (await call("GET", `/api/runs/${each.results[0].runId}`)).body;
    expect(child).toMatchObject({ flowId: "login-and-read", trigger: "flow", parentRunId: r.id, params: { orderNo: "A-1001" }, version: 1 });
  }, 90_000);

  it("★서로 부르는 워크플로우(순환)는 멈춘다", async () => {
    const caller = (id: string, other: string) => ({
      schemaVersion: 1, id, name: id,
      nodes: [{ id: "c", type: "flowCall", name: "부르기", position: pos, config: { flowId: other, version: "draft", items: "", params: {} } }], edges: [],
    });
    await call("POST", "/api/flows", { draft: caller("cyc-a", "cyc-b") });
    await call("POST", "/api/flows", { draft: caller("cyc-b", "cyc-a") });
    const r = await run("cyc-a");
    expect(r.status).toBe("failure");
    expect(r.message + JSON.stringify(r.result.nodes)).toMatch(/순환 — cyc-a → cyc-b → cyc-a/);
  }, 30_000);
});
