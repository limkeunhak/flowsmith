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
const KEY = generateKey();

const example = (): any => {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
  j.vars.baseUrl = site.url;
  return j;
};


/** SSE를 끝(run:end)까지 읽어 이벤트 이름들을 돌려준다 */
async function watch(runId: string): Promise<{ kinds: string[]; raw: string }> {
  const r = await fetch(`${app.url}/api/runs/${runId}/events`);
  const raw = await r.text();   // 서버가 run:end 뒤에 닫는다
  return { kinds: [...raw.matchAll(/^event: (.+)$/gm)].map((m) => m[1]!), raw };
}

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(KEY), worker: new InProcessWorker() });
});
afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("API — 만들기 · 시크릿 · 버전 · 배포 · 실행", () => {
  it("한 바퀴 — 그리고 ★DB 파일 어디에도 비밀번호 평문이 없다", async () => {
    expect((await call("POST", "/api/flows", { draft: example() })).status).toBe(201);

    // 배포 전에는 돌릴 수 없다
    expect((await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "A-1001" } })).status).toBe(409);

    // 시크릿이 없으면 시작 전에 막힌다 — 실행 기록도 안 남는다
    const noSecret = await call("POST", "/api/flows/login-and-read/runs", { version: "draft", params: { orderNo: "A-1001" } });
    expect(noSecret.status).toBe(400);
    expect(noSecret.body.problems).toEqual(["시크릿 'shop'의 값이 저장되지 않았습니다"]);

    const put = await call("PUT", "/api/flows/login-and-read/secrets/shop", { value: { username: "kim", password: "p@ss" } });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain("p@ss");
    const listed = await call("GET", "/api/flows/login-and-read/secrets");
    expect(listed.body).toEqual([expect.objectContaining({ name: "shop", stored: true })]);
    expect(JSON.stringify(listed.body)).not.toContain("p@ss");

    expect((await call("POST", "/api/flows/login-and-read/versions", { note: "처음" })).body).toEqual({ version: 1 });
    expect((await call("POST", "/api/flows/login-and-read/deploy", { version: 1 })).body).toEqual({ activeVersion: 1 });

    const started = await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "A-1001" } });
    expect(started.status).toBe(202);
    const { kinds, raw } = await watch(started.body.runId);
    expect(kinds[0]).toBe("node:start");
    expect(kinds.at(-1)).toBe("run:end");
    expect(kinds).toContain("step");
    expect(raw).not.toContain("p@ss");

    const run = (await call("GET", `/api/runs/${started.body.runId}`)).body;
    expect(run).toMatchObject({ status: "success", version: 1, params: { orderNo: "A-1001" } });
    expect(run.result.output).toEqual({ amountNumber: 12500, status: "배송중" });
    expect(JSON.stringify(run)).not.toContain("p@ss");

    const runs = (await call("GET", "/api/flows/login-and-read/runs")).body;
    expect(runs).toHaveLength(1);
    expect(runs[0].result).toBeUndefined();

    // ★DB 파일(+ WAL)을 바이트로 훑는다
    for (const f of readdirSync(dir)) {
      const bytes = readFileSync(join(dir, f));
      expect(bytes.includes(Buffer.from("p@ss")), f).toBe(false);
    }
  });

  it("끝난 실행에 늦게 붙어도 처음부터 다시 받는다", async () => {
    const started = await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "A-1001" } });
    await app.runs.wait(started.body.runId);
    const { kinds } = await watch(started.body.runId);
    expect(kinds[0]).toBe("node:start");
    expect(kinds.at(-1)).toBe("run:end");
  });

  it("실패한 실행도 기록된다 — 어느 동작에서 왜", async () => {
    const started = await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "없는주문" } });
    await app.runs.wait(started.body.runId);
    const run = (await call("GET", `/api/runs/${started.body.runId}`)).body;
    expect(run.status).toBe("failure");
    const search = run.result.nodes.find((n: any) => n.id === "search");
    expect(search.failure).toMatchObject({ problem: "missing", label: "주문 상태" });
  }, 40_000);

  it("틀린 초안은 저장되지만 버전은 못 만들고, 초안 시험 실행도 거부된다", async () => {
    const bad = example();
    bad.nodes[1].config.actions[1].value = "{{ $params.nope }}";
    const saved = await call("PUT", "/api/flows/login-and-read/draft", { draft: bad });
    expect(saved.status).toBe(200);
    expect(saved.body.problems[0]).toMatch(/nope/);
    const v = await call("POST", "/api/flows/login-and-read/versions", {});
    expect(v.status).toBe(422);
    expect(v.body.problems[0]).toMatch(/nope/);
    expect((await call("POST", "/api/flows/login-and-read/runs", { version: "draft", params: { orderNo: "A-1001" } })).status).toBe(422);
    // 배포된 버전 1은 그대로 돈다
    expect((await call("POST", "/api/flows/login-and-read/runs", { params: { orderNo: "A-1001" } })).status).toBe(202);
    await app.runs.drain();
    await call("PUT", "/api/flows/login-and-read/draft", { draft: example() });
  });

  it("입력이 없으면 400과 문제 목록", async () => {
    const r = await call("POST", "/api/flows/login-and-read/runs", {});
    expect(r.status).toBe(400);
    expect(r.body.problems[0]).toMatch(/주문번호/);
  });

  it("★다른 출처에서 온 상태 변경 요청은 거부한다 — 읽기는 된다", async () => {
    const evil = await fetch(`${app.url}/api/flows/login-and-read/runs`, {
      method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: JSON.stringify({ params: { orderNo: "A-1001" } }),
    });
    expect(evil.status).toBe(403);
    const ok = await fetch(`${app.url}/api/flows`, { headers: { origin: "https://evil.example" } });
    expect(ok.status).toBe(200);
    const same = await fetch(`${app.url}/api/flows/login-and-read/deploy`, { method: "POST", headers: { origin: app.url }, body: JSON.stringify({ version: 1 }) });
    expect(same.status).toBe(200);
  });

  it("잘못된 요청들", async () => {
    expect((await call("GET", "/api/flows/nope")).status).toBe(404);
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("PATCH", "/api/flows")).status).toBe(405);
    expect((await call("POST", "/api/flows/login-and-read/deploy", { version: "1" })).status).toBe(400);
    expect((await call("PUT", "/api/flows/login-and-read/secrets/bank", { value: "x" })).body.error).toMatch(/정의되어 있지 않습니다/);
    const r = await fetch(`${app.url}/api/flows`, { method: "POST", body: "{not json" });
    expect(r.status).toBe(400);
  });
});

describe("마스터 키가 바뀌면", () => {
  it("★시크릿을 풀 수 없다고 말하고 실행하지 않는다", async () => {
    await app.runs.drain();
    const other = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker() });
    try {
      const r = await fetch(`${other.url}/api/flows/login-and-read/runs`, { method: "POST", body: JSON.stringify({ params: { orderNo: "A-1001" } }) });
      expect(r.status).toBe(500);
      expect(((await r.json()) as { error: string }).error).toMatch(/마스터 키가 바뀌었거나/);
    } finally {
      await other.close();
    }
  });
});
