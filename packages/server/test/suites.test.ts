/**
 * Suite — 웹 e2e 테스트 묶음(2026-10-19, PLAN §39): 시나리오를 차례로 · 판정(통과 · 불통과 · 오류) · 단건 · 멈추기 · 일정 · 요약 알림 · 불통과 스크린샷.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
let site: Server;
let siteUrl: string;
const posted: { url: string; body: any }[] = [];
const pos = { x: 0, y: 0 };
const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });

const custom = (id: string, code: string, outputs: string[]) => ({ id, type: "custom", name: id, position: pos, config: { code, outputs } });
const check = (items: unknown[]) => ({ id: "k", type: "check", name: "검사", position: pos, config: { items } });
const line = (id: string, nodes: unknown[], more: Record<string, unknown> = {}) => ({
  schemaVersion: 1, id, name: id, nodes, ...more,
  edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: { node: (nodes[i] as { id: string }).id, port: "out" }, to: { node: (n as { id: string }).id } })),
});
async function publish(f: Record<string, unknown>): Promise<void> {
  expect((await call("POST", "/api/flows", { draft: f })).status).toBe(201);
  const v = await call("POST", `/api/flows/${f["id"]}/versions`, { note: "" });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  await call("POST", `/api/flows/${f["id"]}/deploy`, { version: v.body.version });
}
const runOf = async (id: string) => (await call("GET", `/api/suite-runs/${id}`)).body;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-suites-"));
  site = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><b id="price">651,170원</b>`); });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  app = await startApp({
    dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false,
    notifyFetch: (async (url: string, init: RequestInit) => { posted.push({ url, body: JSON.parse(String(init.body)) }); return new Response("ok"); }) as typeof fetch,
  });
  const qty = { params: [{ name: "n", label: "수", type: "number", default: "3" }] };
  await publish(line("ok", [custom("a", "return { n: Number(ctx.params.n) };", ["n"]), check([{ id: "k1", label: "수", actual: "{{ $input.n }}", op: "gte", expected: "3" }])], qty));
  await publish(line("boom", [custom("a", "throw new Error('사이트가 죽었다');", [])]));
  await publish(line("slow", [custom("a", "await new Promise((r) => setTimeout(r, 3000)); return {};", [])]));
  await publish(line("web-fail", [
    { id: "w", type: "web", name: "읽기", position: pos, config: { start: { kind: "url", url: siteUrl }, actions: [{ id: "a1", kind: "read", output: "price", target: target("금액", "#price") }] } },
    check([{ id: "k1", label: "금액", actual: "{{ $input.price }}", op: "lt", expected: "500000" }]),
  ]));
  expect((await call("POST", "/api/flows", { draft: line("draft-only", [custom("a", "return {};", [])]) })).status).toBe(201);
}, 60_000);
afterAll(async () => {
  await app?.close();
  await new Promise((r) => site?.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe("Suite", () => {
  let suiteId: string;

  it("★만들고 · 시나리오(입력 · 켜고 끄기) · 알림 — 없는 워크플로우는 저장 못 함", async () => {
    const made = await call("POST", "/api/suites", { name: "주문 회귀" });
    expect(made.status).toBe(201);
    suiteId = made.body.id;
    const bad = await call("PUT", `/api/suites/${suiteId}`, { items: [{ id: "x", flowId: "없는워크플로우" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.problems.join()).toMatch(/없는워크플로우.*없습니다/);
    const put = await call("PUT", `/api/suites/${suiteId}`, {
      items: [
        { id: "ok", flowId: "ok", label: "수 3", params: { n: "3" } },
        { id: "low", flowId: "ok", label: "수 1(불통과)", params: { n: "1" } },
        { id: "boom", flowId: "boom", label: "사이트 죽음" },
        { id: "draft", flowId: "draft-only", label: "게시 안 됨" },
        { id: "off", flowId: "ok", label: "꺼 둠", enabled: false },
      ],
      notify: [{ id: "n1", channel: "webhook", url: "https://hooks.example/x", on: ["failure", "recovered"] }],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.items).toHaveLength(5);
  });

  it("★전체 — 차례로 다 돌고(하나가 실패해도) 시나리오마다 판정 · 요약 알림 한 건", async () => {
    const r = await call("POST", `/api/suites/${suiteId}/runs`, {});
    expect(r.status).toBe(202);
    await app.suites.wait(r.body.suiteRunId);
    const run = await runOf(r.body.suiteRunId);
    expect(run.status).toBe("fail");
    expect(run.items.map((i: any) => [i.itemId, i.verdict])).toEqual([["ok", "pass"], ["low", "fail"], ["boom", "error"], ["draft", "error"]]);
    expect(run.items[0].checks).toEqual({ passed: 1, failed: 0 });
    expect(run.items[1].checks).toEqual({ passed: 0, failed: 1 });
    expect(run.items[1].message).toMatch(/수: 기대 «3 이상이다», 실제 «1»/);
    expect(run.items[2].message).toMatch(/사이트가 죽었다/);
    expect(run.items[3].message).toMatch(/배포된 버전이 없습니다/);
    expect(run.items[3].runId).toBeNull();
    // 시나리오의 실행 — Suite로 돌았다
    expect((await call("GET", `/api/runs/${run.items[0].runId}`)).body.trigger).toBe("suite");
    await app.notifier.drain();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body.title).toMatch(/주문 회귀 — 4개 중 3개 불통과/);
    expect(posted[0]!.body.link).toMatch(new RegExp(`/#/tests/${suiteId}/runs/${r.body.suiteRunId}$`));
    // 목록 — 마지막 실행
    const list = (await call("GET", "/api/suites")).body;
    expect(list[0]).toMatchObject({ id: suiteId, running: false, lastRun: { status: "fail" } });
  }, 60_000);

  it("★단건 — 그 시나리오 하나만 · 회복 알림", async () => {
    const one = await call("POST", `/api/suites/${suiteId}/runs`, { item: "ok" });
    await app.suites.wait(one.body.suiteRunId);
    expect(await runOf(one.body.suiteRunId)).toMatchObject({ status: "pass", only: "ok", items: [{ itemId: "ok", verdict: "pass" }] });
    await app.notifier.drain();
    expect(posted).toHaveLength(1);   // 단건 통과는 회복이 아니다
    // 전체가 통과로 돌아오면 «회복»
    await call("PUT", `/api/suites/${suiteId}`, { items: [{ id: "ok", flowId: "ok", params: { n: "5" } }] });
    const all = await call("POST", `/api/suites/${suiteId}/runs`, {});
    await app.suites.wait(all.body.suiteRunId);
    expect((await runOf(all.body.suiteRunId)).status).toBe("pass");
    await app.notifier.drain();
    expect(posted).toHaveLength(2);
    expect(posted[1]!.body.event).toBe("recovered");
    expect((await call("POST", `/api/suites/${suiteId}/runs`, { item: "없음" })).status).toBe(404);
  }, 60_000);

  it("★멈추기 — 도는 시나리오를 멈추고 남은 것은 돌리지 않는다 · 도는 동안 다시 돌리면 409", async () => {
    await call("PUT", `/api/suites/${suiteId}`, { items: [{ id: "s1", flowId: "slow" }, { id: "s2", flowId: "ok" }] });
    const r = await call("POST", `/api/suites/${suiteId}/runs`, {});
    expect((await call("POST", `/api/suites/${suiteId}/runs`, {})).status).toBe(409);
    await new Promise((ok) => setTimeout(ok, 300));
    expect((await call("POST", `/api/suite-runs/${r.body.suiteRunId}/cancel`)).status).toBe(202);
    await app.suites.wait(r.body.suiteRunId);
    const run = await runOf(r.body.suiteRunId);
    expect(run.status).toBe("cancelled");
    expect(run.items.map((i: any) => i.verdict)).toEqual(["error", "skipped"]);
  }, 60_000);

  it("★일정 — 맞는 분에 한 번만", async () => {
    await call("PUT", `/api/suites/${suiteId}`, { items: [{ id: "ok", flowId: "ok" }], schedules: [{ id: "s1", cron: "* * * * *" }] });
    const at = new Date("2026-10-19T09:00:30");
    const started = app.suites.tick(at);
    expect(started).toHaveLength(1);
    await app.suites.wait(started[0]!);
    expect(app.suites.tick(at)).toEqual([]);
    expect((await runOf(started[0]!)).trigger).toBe("schedule");
    expect((await call("PUT", `/api/suites/${suiteId}`, { schedules: [{ cron: "매일" }] })).status).toBe(400);
  }, 30_000);

  it("★불통과면 그때의 페이지 한 장 — 실행 기록 본문에는 없고 /shot으로", async () => {
    await call("PUT", `/api/suites/${suiteId}`, { items: [{ id: "wf", flowId: "web-fail" }], schedules: [] });
    const r = await call("POST", `/api/suites/${suiteId}/runs`, {});
    await app.suites.wait(r.body.suiteRunId);
    const item = (await runOf(r.body.suiteRunId)).items[0];
    expect(item.verdict).toBe("fail");
    const shot = await call("GET", `/api/runs/${item.runId}/shot`);
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/jpeg");
    expect([...shot.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    const row = (await call("GET", `/api/runs/${item.runId}`)).body;
    expect(row.result.shot).toBeUndefined();
    expect(row.result.nodes[1].checks[0]).toMatchObject({ label: "금액", pass: false, actual: "651,170원" });
    // 통과한 실행에는 없다
    const okRun = (await call("GET", "/api/flows/ok/runs")).body[0].id;
    expect((await call("GET", `/api/runs/${okRun}/shot`)).status).toBe(404);
  }, 60_000);

  it("지우기 — 실행 기록도 함께", async () => {
    expect((await call("DELETE", `/api/suites/${suiteId}`)).status).toBe(204);
    expect((await call("GET", `/api/suites/${suiteId}`)).status).toBe(404);
  });
});
