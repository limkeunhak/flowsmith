/**
 * 여기서부터 다시(POST /api/runs/:id/rerun { from }) — 앞 단계는 그 실행의 출력(돌지 않음) · 그 단계부터 진짜로 ·
 * 미리 보기 · 끝나지 않은 앞 단계면 409 · 다른 버전으로는 못 함 · «게시된 버전으로» 다시.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);
let app: App;
let dir: string;
const pos = { x: 0, y: 0 };
/** 앞(a — 돌 때마다 다른 값) → 가운데(b) → 끝(c — 고치기 전엔 실패) */
const flow = (cCode: string) => ({
  schemaVersion: 1, id: "pipe", name: "줄", params: [{ name: "n", label: "수", type: "number", default: "1" }],
  nodes: [
    { id: "a", type: "custom", name: "앞", position: pos, config: { code: "return { n: Number(ctx.params.n), r: Math.random() };", outputs: ["n", "r"] } },
    { id: "b", type: "custom", name: "가운데", position: pos, config: { code: "return { n: input.n * 10, r: input.r };", outputs: ["n", "r"] } },
    { id: "c", type: "custom", name: "끝", position: pos, config: { code: cCode, outputs: ["m", "r"] } },
  ],
  edges: [{ id: "e1", from: { node: "a", port: "out" }, to: { node: "b" } }, { id: "e2", from: { node: "b", port: "out" }, to: { node: "c" } }],
});
const runOf = async (runId: string) => (await call("GET", `/api/runs/${runId}`)).body;
const node = (r: { result: { nodes: { id: string }[] } }, id: string) => r.result.nodes.find((n) => n.id === id) as unknown as { status: string; output: Record<string, unknown> | null; pinned?: boolean };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-resume-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false });
  expect((await call("POST", "/api/flows", { draft: flow("throw new Error('아직 못 만든 끝');") })).status).toBe(201);
}, 30_000);
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("여기서부터 다시", () => {
  it("★실패 → 초안을 고치고 그 단계부터 — 앞 단계는 그 실행의 출력(돌지 않음) · 입력 그대로 · 기록에 어디서부터", async () => {
    const first = (await call("POST", "/api/flows/pipe/runs", { version: "draft", params: { n: "4" } })).body.runId as string;
    await app.runs.wait(first);
    const r1 = await runOf(first);
    expect(r1.status).toBe("failure");
    const was = node(r1, "b").output!;

    // 미리 보기 — 앞 둘은 지난 출력
    expect((await call("GET", `/api/runs/${first}/resume-plan?from=c`)).body).toEqual({ from: "c", reused: ["a", "b"], again: [] });
    // 끝나지 않은 앞 단계 뒤부터는 못 한다
    expect((await call("GET", `/api/runs/${first}/resume-plan?from=없음`)).body.error).toMatch(/없습니다/);

    await call("PUT", "/api/flows/pipe/draft", { draft: flow("return { m: input.n + 1, r: input.r };") });
    const again = await call("POST", `/api/runs/${first}/rerun`, { from: "c" });
    expect(again).toMatchObject({ status: 202, body: { version: null } });
    await app.runs.wait(again.body.runId);
    const r2 = await runOf(again.body.runId);
    expect(r2).toMatchObject({ status: "success", params: { n: "4" }, resumedFrom: { runId: first, nodeId: "c", nodeName: "끝" } });
    expect(node(r2, "a").pinned).toBe(true);
    expect(node(r2, "b")).toMatchObject({ pinned: true, output: was });
    // 그 단계는 진짜로 — 지난 b의 r(무작위)을 그대로 받았다
    expect(r2.result.output).toEqual({ m: 41, r: was["r"] });
    expect(r1.resumedFrom).toBeNull();
  });

  it("앞 단계가 끝나지 않았으면 409(시작하지 않음) · 다른 버전으로는 400 · 게시된 버전으로 다시는 처음부터", async () => {
    await call("PUT", "/api/flows/pipe/draft", { draft: flow("throw new Error('또 실패');") });
    const bad = (await call("POST", "/api/flows/pipe/runs", { version: "draft" })).body.runId as string;
    await app.runs.wait(bad);
    await call("PUT", "/api/flows/pipe/draft", { draft: { ...flow("return { m: 1, r: 0 };"), edges: [...flow("").edges, { id: "e3", from: { node: "c", port: "out" }, to: { node: "d" } }],
      nodes: [...flow("return { m: 1, r: 0 };").nodes, { id: "d", type: "custom", name: "뒤의 뒤", position: pos, config: { code: "return {};", outputs: [] } }] } });
    const before = (await call("GET", "/api/flows/pipe/runs")).body.length;
    const r = await call("POST", `/api/runs/${bad}/rerun`, { from: "d" });
    expect(r.status).toBe(409);
    expect(r.body.error ?? r.body.message).toMatch(/앞 단계 «끝»가 그 실행에서 끝나지 않아/);
    expect((await call("GET", "/api/flows/pipe/runs")).body.length).toBe(before);
    expect((await call("POST", `/api/runs/${bad}/rerun`, { from: "c", version: 1 })).status).toBe(400);

    // 게시된 버전으로 — 같은 입력 · 그 버전
    await call("POST", "/api/flows/pipe/versions", { note: "" });
    await call("POST", "/api/flows/pipe/deploy", { version: 1 });
    const pub = await call("POST", `/api/runs/${bad}/rerun`, { version: 1 });
    expect(pub.body.version).toBe(1);
    await app.runs.wait(pub.body.runId);
    expect(await runOf(pub.body.runId)).toMatchObject({ status: "success", version: 1, resumedFrom: null });
  });
});
