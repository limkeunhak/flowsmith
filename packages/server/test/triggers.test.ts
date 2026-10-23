/**
 * 트리거 — 일정(cron) · 웹훅.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

const example = (): any => {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
  j.vars.baseUrl = site.url;
  j.settings.monitorIntervalMin = null;
  j.settings.schedules = [{ id: "morning", cron: "0 9 * * 1-5", params: { orderNo: "A-1001" } }];
  return j;
};
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 7);

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-trig-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false });
  await call("POST", "/api/flows", { draft: example() });
  await call("PUT", "/api/flows/login-and-read/secrets/shop", { value: { username: "kim", password: "p@ss" } });
  await call("POST", "/api/flows/login-and-read/versions", {});
  await call("POST", "/api/flows/login-and-read/deploy", { version: 1 });
});
afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("일정", () => {
  it("★게시된 버전의 일정이 그 분에 돌고 — 같은 분에는 다시 안 돈다", async () => {
    const fired = app.scheduler.tick(local(2026, 10, 16, 9, 0));   // 금요일 9시
    expect(fired).toMatchObject([{ flowId: "login-and-read", scheduleId: "morning", started: true }]);
    await app.runs.wait(fired[0]!.runId);
    const run = (await call("GET", `/api/runs/${fired[0]!.runId}`)).body;
    expect(run).toMatchObject({ status: "success", trigger: "schedule", params: { orderNo: "A-1001" } });
    expect(app.scheduler.tick(local(2026, 10, 16, 9, 0))).toEqual([]);     // 같은 분
    expect(app.scheduler.tick(local(2026, 10, 16, 9, 1))).toEqual([]);     // 안 맞는 분
    expect(app.scheduler.tick(local(2026, 10, 17, 9, 0))).toEqual([]);     // 토요일
  });

  it("앞 실행이 아직 돌고 있으면 건너뛰고 — 건너뛴 것을 실행 기록에 남긴다", async () => {
    const manual = (await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "A-1001" } })).body.runId;
    const fired = app.scheduler.tick(local(2026, 10, 19, 9, 0));   // 월요일 — 수동 실행이 아직 돈다
    expect(fired).toMatchObject([{ started: false }]);
    expect((await call("GET", `/api/runs/${fired[0]!.runId}`)).body).toMatchObject({ status: "failure", trigger: "schedule", message: expect.stringMatching(/앞 실행이 아직 돌고 있어/) });
    await app.runs.wait(manual);
  });

  it("★시작할 수 없으면(시크릿 없음) 조용히 넘어가지 않고 실패로 적는다", async () => {
    await call("DELETE", "/api/flows/login-and-read/secrets/shop");
    try {
      const fired = app.scheduler.tick(local(2026, 10, 20, 9, 0));
      expect((await call("GET", `/api/runs/${fired[0]!.runId}`)).body.message).toMatch(/시작하지 못했습니다.*시크릿 'shop'/);
    } finally {
      await call("PUT", "/api/flows/login-and-read/secrets/shop", { value: { username: "kim", password: "p@ss" } });
    }
  });
});

describe("웹훅", () => {
  let token = "";

  it("켜기 전에는 404 · 켜면 토큰을 한 번만 준다", async () => {
    expect((await call("GET", "/api/flows/login-and-read/webhook")).body).toMatchObject({ enabled: false });
    expect((await call("POST", "/api/hooks/login-and-read", {}, { "x-flowsmith-token": "x" })).status).toBe(404);
    const on = await call("POST", "/api/flows/login-and-read/webhook");
    expect(on.status).toBe(201);
    token = on.body.token;
    expect(token).toMatch(/^fsk_/);
    const st = (await call("GET", "/api/flows/login-and-read/webhook")).body;
    expect(st).toMatchObject({ enabled: true, path: "/api/hooks/login-and-read" });
    expect(JSON.stringify(st)).not.toContain(token);
  });

  it("★토큰이 틀리면 401 · 맞으면 돌고 ?wait=1이면 결과까지 — 정의된 입력만 받는다", async () => {
    expect((await call("POST", "/api/hooks/login-and-read", { orderNo: "A-1001" }, { "x-flowsmith-token": "fsk_wrong" })).status).toBe(401);
    expect((await call("POST", "/api/hooks/login-and-read", { orderNo: "A-1001" })).status).toBe(401);
    const r = await call("POST", "/api/hooks/login-and-read?wait=1", { orderNo: "A-1001", hacker: "<script>" }, { authorization: `Bearer ${token}`, origin: "https://other-server.example" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "success", output: { amountNumber: 12500, status: "배송중" } });
    const run = (await call("GET", `/api/runs/${r.body.runId}`)).body;
    expect(run.trigger).toBe("webhook");
    expect(run.params).toEqual({ orderNo: "A-1001" });
  });

  it("기다리지 않으면 202와 실행 id", async () => {
    const r = await call("POST", `/api/hooks/login-and-read?token=${token}`, { orderNo: "A-1001" });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe(`/api/runs/${r.body.runId}`);
    await app.runs.wait(r.body.runId);
  });

  it("★토큰을 새로 만들면 옛 토큰은 그 순간 무효 · DB에는 토큰이 없다", async () => {
    const fresh = (await call("POST", "/api/flows/login-and-read/webhook")).body.token;
    expect((await call("POST", "/api/hooks/login-and-read", {}, { "x-flowsmith-token": token })).status).toBe(401);
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f)).includes(Buffer.from(fresh)), f).toBe(false);
    await call("DELETE", "/api/flows/login-and-read/webhook");
    expect((await call("POST", "/api/hooks/login-and-read", {}, { "x-flowsmith-token": fresh })).status).toBe(404);
  });
});
