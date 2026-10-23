/**
 * 변경 감시 — 주기 점검 · 실행 중 발견 · API. 시험 사이트를 «바뀐 척»(배치 2) 시킨다.
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

const example = (): any => {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
  j.vars.baseUrl = site.url;
  j.settings.defaultTimeoutMs = 2000;
  return j;
};

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-mon-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false });
  await call("POST", "/api/flows", { draft: example() });
  await call("PUT", "/api/flows/login-and-read/secrets/shop", { value: { username: "kim", password: "p@ss" } });
  await call("POST", "/api/flows/login-and-read/versions", {});
  await call("POST", "/api/flows/login-and-read/deploy", { version: 1 });
});
afterAll(async () => {
  site?.setLayout(1);
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("변경 감시", () => {
  it("★주기가 된 게시 워크플로우를 점검하고 — 같으면 ok, 주기 안에는 다시 안 한다", async () => {
    const t0 = Date.now();
    expect(await app.monitor.tick(t0)).toHaveLength(1);
    await app.monitor.drain();
    const latest = app.store.latestProbe("login-and-read")!;
    expect(latest.status, JSON.stringify(latest.report)).toBe("ok");
    expect(latest.source).toBe("probe");
    expect((latest.report as any).stop.reason).toBe("끝까지 살펴봤습니다");
    expect(await app.monitor.tick(t0 + 60_000)).toHaveLength(0);              // 주기(360분) 안
    expect(await app.monitor.tick(t0 + 361 * 60_000)).toHaveLength(1);        // 지나면 다시
    await app.monitor.drain();
  });

  it("★사이트가 바뀌면 «깨짐»이 적히고 목록에도 보인다", async () => {
    site.setLayout(2);
    try {
      const started = await call("POST", "/api/flows/login-and-read/probes", {});
      expect(started.status).toBe(202);
      await app.monitor.drain();
      const p = (await call("GET", `/api/probes/${started.body.probeId}`)).body;
      expect(p.status).toBe("broken");
      // 예시는 「조회」 단추를 역할 · 이름으로 찾는다 — 「검색」이 되면 단추가 먼저 «없음»이다
      expect(p.report.findings.find((f: any) => f.status === "missing").label).toBe("'조회' 버튼");
      const list = (await call("GET", "/api/flows")).body;
      expect(list[0].monitor).toMatchObject({ status: "broken", source: "probe" });
    } finally {
      site.setLayout(1);
    }
  });

  it("★실제 실행이 요소를 못 찾으면 확인 점검을 돈다 — 사이트가 바뀐 것이면 «깨짐»", async () => {
    site.setLayout(2);
    try {
      const run = await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "A-1001" } });
      await app.runs.wait(run.body.runId);
      await app.monitor.drain();
      const probes = (await call("GET", "/api/flows/login-and-read/probes")).body;
      const fromRun = probes.find((p: any) => p.source === "run");
      expect(fromRun.status).toBe("broken");
      expect(fromRun.report.findings.find((f: any) => f.status === "missing")).toMatchObject({ nodeId: "search", actionId: "b2", label: "'조회' 버튼" });
    } finally {
      site.setLayout(1);
    }
  }, 30_000);

  it("★입력 탓(없는 주문번호)이면 확인 점검이 «정상» — 헛경보를 내지 않는다", async () => {
    const run = await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "없는주문" } });
    await app.runs.wait(run.body.runId);
    expect((await call("GET", `/api/runs/${run.body.runId}`)).body.status).toBe("failure");
    await app.monitor.drain();
    const latest = (await call("GET", "/api/flows/login-and-read/probes")).body[0];
    expect(latest).toMatchObject({ source: "run", status: "ok" });
    expect((await call("GET", "/api/flows")).body.find((f: any) => f.id === "login-and-read").monitor.status).toBe("ok");
  }, 30_000);

  it("점검용 입력값이 없으면 «error»와 무엇을 채울지 남긴다", async () => {
    const j = example();
    j.id = "no-probe-params";
    j.settings.probeParams = {};
    await call("POST", "/api/flows", { draft: j });
    await call("PUT", "/api/flows/no-probe-params/secrets/shop", { value: { username: "kim", password: "p@ss" } });
    const s = await call("POST", "/api/flows/no-probe-params/probes", { version: "draft" });
    await app.monitor.drain();
    const p = (await call("GET", `/api/probes/${s.body.probeId}`)).body;
    expect(p.status).toBe("error");
    expect(p.report.message).toMatch(/점검용 입력값/);
  });

  it("사람의 크롬에 붙는 워크플로우는 주기 감시에서 뺀다", async () => {
    const j = example();
    j.id = "attach-flow";
    j.settings.browser = "attach";
    j.nodes[0].config.start = { kind: "tab", match: "x" };
    await call("POST", "/api/flows", { draft: j });
    await call("POST", "/api/flows/attach-flow/versions", {});
    await call("POST", "/api/flows/attach-flow/deploy", { version: 1 });
    const started = await app.monitor.tick(Date.now() + 10 * 360 * 60_000);
    expect(started).toHaveLength(1);    // login-and-read 하나뿐 — attach-flow는 빠졌다
    await app.monitor.drain();
  });
});
