/**
 * 확장 플러그인(run/plugins.ts · PLAN §41) — 올리기 · 재시작 없이 바꾸기 · 되돌리기 · 끄기 · 서명 · 사내 저장소 · 다시 켜도 남는다.
 * ★돌던 실행은 시작할 때의 버전으로 끝까지 간다 · 서명 없는 · 모르는 키 · 같은 버전 다른 내용은 받지 않는다.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSigningKey, InProcessWorker, parseTrustedKeys, sha256, writePackage } from "@flowsmith/worker";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { caller, until } from "./helpers.ts";

const key = generateSigningKey("사내배포");
const keys = parseTrustedKeys(key.publicLine);
const signer = { name: "사내배포", privatePem: key.privatePem };
const box = new SecretBox(generateKey());

/** 데모 플러그인 — 버전마다 v가 다르다. gate가 있으면 그 약속을 기다린다(돌던 실행 시험) */
const code = (v: string, gate = false) => `
export const extensions = [{
  id: "demo.hello", title: "인사 ${v}", description: "시험", options: [{ name: "who", label: "누구", required: false, default: "" }], outputs: ["v", "who"], browser: "none", risk: "safe",
  async run(ctx) { ${gate ? "globalThis.__demoStarted = true; await globalThis.__demoGate;" : ""} return { v: "${v}", who: ctx.options.who ?? "" }; },
}];`;
const pkg = (version: string, v = version, opts: { gate?: boolean; sign?: false | typeof signer; id?: string } = {}) =>
  writePackage({ id: opts.id ?? "demo", name: "데모", version, description: "시험용", main: "index.mjs", nodes: [`${opts.id ?? "demo"}.hello`] },
    new Map([["index.mjs", Buffer.from(code(v, opts.gate))]]), opts.sign === false ? undefined : opts.sign ?? signer);

const flow = (id = "hi") => ({
  schemaVersion: 1, id, name: "인사 워크플로우",
  nodes: [{ id: "x", type: "extension", name: "인사", position: { x: 0, y: 0 }, config: { extension: "demo.hello", options: { who: "김" }, outputs: ["v", "who"] } }],
  edges: [],
});

let app: App;
let dir: string;
const call = caller(() => app.url);
const upload = (buf: Buffer) => fetch(`${app.url}/api/plugins`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(buf) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) as any }));
const run = async (flowId = "hi") => {
  const r = await call("POST", `/api/flows/${flowId}/runs`, { version: "draft" });
  expect(r.status).toBe(202);
  await app.runs.wait(r.body.runId);
  return (await call("GET", `/api/runs/${r.body.runId}`)).body;
};
const start = (more: Record<string, unknown> = {}) => startApp({ dbPath: join(dir, "t.db"), box, worker: new InProcessWorker(), monitor: false, schedule: false, plugins: { dir: join(dir, "plugins"), requireSigned: true, keys }, ...more });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-plugins-"));
  app = await start();
  expect((await call("POST", "/api/flows", { draft: flow() })).status).toBe(201);
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("올리기 · 바꾸기 · 되돌리기", () => {
  it("★없을 때는 «확장이 없습니다» → 올리면 바로(재시작 없이) 노드 목록 · 실행에", async () => {
    expect((await run()).status).toBe("failure");
    const r = await upload(pkg("1.0.0", "1"));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: "demo", version: "1.0.0", enabled: true, loaded: true, signer: "사내배포", nodes: [{ id: "demo.hello", title: "인사 1" }] });
    const exts = (await call("GET", "/api/extensions")).body;
    expect(exts).toEqual([expect.objectContaining({ id: "demo.hello", title: "인사 1", plugin: { id: "demo", name: "데모", version: "1.0.0" } })]);
    const done = await run();
    expect(done.status).toBe("success");
    expect(done.result.nodes[0].output).toEqual({ v: "1", who: "김" });
    expect(existsSync(join(dir, "plugins", "demo", "1.0.0.fspkg"))).toBe(true);
  });

  it("★새 버전 — 돌던 실행은 옛 버전으로 끝까지 · 새로 시작한 실행부터 새 버전", async () => {
    let open!: () => void;
    (globalThis as { __demoGate?: Promise<void> }).__demoGate = new Promise<void>((r) => { open = r; });
    expect((await upload(pkg("1.1.0", "1.1", { gate: true }))).status).toBe(201);
    const slow = (await call("POST", "/api/flows/hi/runs", { version: "draft" })).body.runId as string;
    await until(() => (globalThis as { __demoStarted?: boolean }).__demoStarted === true);   // 1.1.0의 노드가 돌기 시작했다
    expect((await upload(pkg("2.0.0", "2"))).status).toBe(201);
    open();
    await app.runs.wait(slow);
    expect((await call("GET", `/api/runs/${slow}`)).body.result.nodes[0].output.v).toBe("1.1");
    expect((await run()).result.nodes[0].output.v).toBe("2");
  });

  it("★되돌리기 — 남겨 둔 버전을 고르면 바로 · 기록에 남는다", async () => {
    const r = await call("PUT", "/api/plugins/demo", { version: "1.0.0" });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe("1.0.0");
    expect(r.body.versions.map((v: { version: string }) => v.version)).toEqual(["2.0.0", "1.1.0", "1.0.0"]);
    expect((await run()).result.nodes[0].output.v).toBe("1");
    const list = (await call("GET", "/api/plugins")).body;
    expect(list.events.slice(0, 2).map((e: { action: string }) => e.action)).toEqual(["rollback", "install"]);
    expect(list.signing).toEqual({ required: true, keys: [{ name: "사내배포", fingerprint: key.fingerprint }] });
    await call("PUT", "/api/plugins/demo", { version: "2.0.0" });
  });

  it("★버전을 만들면 그때의 플러그인 버전을 적어 둔다", async () => {
    expect((await call("POST", "/api/flows/hi/versions", { note: "" })).status).toBe(201);
    const d = (await call("GET", "/api/flows/hi")).body;
    expect(d.versions[0].plugins).toEqual({ demo: "2.0.0" });
  });

  it("끄면 «확장이 없습니다» · 켜면 다시", async () => {
    expect((await call("PUT", "/api/plugins/demo", { enabled: false })).body).toMatchObject({ enabled: false, loaded: false });
    expect((await call("GET", "/api/extensions")).body).toEqual([]);
    const off = await run();
    expect(off.status).toBe("failure");
    expect(off.result.nodes[0].failure.message).toMatch(/demo\.hello/);
    await call("PUT", "/api/plugins/demo", { enabled: true });
    expect((await run()).result.nodes[0].output.v).toBe("2");
  });
});

describe("받지 않는 것", () => {
  it("★서명 없음 · 모르는 키 · 같은 버전인데 다른 내용 · 망가진 묶음", async () => {
    const unsigned = await upload(pkg("3.0.0", "3", { sign: false }));
    expect(unsigned.status).toBe(422);
    expect(unsigned.body.error).toMatch(/서명 없는 묶음은 받지 않습니다/);
    const other = generateSigningKey("남");
    const stranger = await upload(pkg("3.0.0", "3", { sign: { name: "남", privatePem: other.privatePem } }));
    expect(stranger.status).toBe(422);
    expect(stranger.body.error).toMatch(/모르는 키로 서명됐습니다/);
    const same = await upload(pkg("2.0.0", "다른 내용"));
    expect(same.status).toBe(409);
    expect(same.body.error).toMatch(/이미 있는데 내용이 다릅니다/);
    expect((await upload(Buffer.from("zip 아님"))).status).toBe(422);
    // 못 뜨는 코드 — 불러 보기에서 걸리고 남기지 않는다
    const broken = writePackage({ id: "bad", name: "망가짐", version: "1.0.0", description: "", main: "index.mjs", nodes: ["bad.x"] }, new Map([["index.mjs", Buffer.from("export const extensions = [];")]]), signer);
    const b = await upload(broken);
    expect(b.status).toBe(422);
    expect(b.body.error).toMatch(/bad\.x가 없습니다/);
    expect((await call("GET", "/api/plugins")).body.plugins.map((p: { id: string }) => p.id)).toEqual(["demo"]);
  });

  it("★쓰는 워크플로우가 있으면 지우지 않는다(끄기는 된다)", async () => {
    const r = await call("DELETE", "/api/plugins/demo");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/인사 워크플로우/);
  });
});

describe("사내 저장소", () => {
  let repo: Server;
  let base: string;
  const served = new Map<string, Buffer>();
  beforeAll(async () => {
    repo = createServer((q, res) => {
      const b = served.get(q.url ?? "");
      if (!b) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": q.url!.endsWith(".json") ? "application/json" : "application/octet-stream" });
      res.end(b);
    });
    await new Promise<void>((r) => repo.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(repo.address() as AddressInfo).port}`;
    const fspkg = pkg("2.1.0", "2.1");
    served.set("/p/demo-2.1.0.fspkg", fspkg);
    served.set("/p/index.json", Buffer.from(JSON.stringify({ format: 1, plugins: [
      { id: "demo", name: "데모", version: "2.1.0", description: "", nodes: ["demo.hello"], file: "demo-2.1.0.fspkg", sha256: sha256(fspkg), size: fspkg.length, signer: "사내배포" },
      { id: "demo", name: "데모", version: "2.0.0", description: "", nodes: ["demo.hello"], file: "demo-2.0.0.fspkg", sha256: "0".repeat(64), size: 1, signer: null },
    ] })));
  });
  afterAll(() => new Promise<void>((r) => repo.close(() => r())));

  it("★새 버전 확인 → 받기 — 받은 것도 해시 · 서명을 똑같이 본다", async () => {
    expect((await call("POST", "/api/plugins-source/check")).status).toBe(400);
    expect((await call("PUT", "/api/plugins-source", { url: `${base}/p/index.json` })).body.source).toBe(`${base}/p/index.json`);
    const c = (await call("POST", "/api/plugins-source/check")).body;
    expect(c.plugins.map((p: { version: string; newer: boolean; have: boolean }) => [p.version, p.newer, p.have])).toEqual([["2.1.0", true, false], ["2.0.0", false, true]]);
    const r = await call("POST", "/api/plugins-source/install", { id: "demo", version: "2.1.0" });
    expect(r.status).toBe(201);
    expect(r.body.version).toBe("2.1.0");
    expect(r.body.versions[0].source).toBe(`${base}/p/index.json`);
    expect((await run()).result.nodes[0].output.v).toBe("2.1");
    // index의 해시와 다르면 받지 않는다
    served.set("/p/demo-2.1.0.fspkg", pkg("2.1.0", "바꿔치기"));
    expect((await call("POST", "/api/plugins-source/install", { id: "demo", version: "2.1.0" })).body.error).toMatch(/해시와 다릅니다/);
  });
});

describe("다시 켜도", () => {
  it("★서버를 다시 켜면 켜 둔 버전을 싣는다", async () => {
    await app.close();
    app = await start();
    expect((await call("GET", "/api/extensions")).body.map((e: { title: string }) => e.title)).toEqual(["인사 2.1"]);
    expect((await run()).result.nodes[0].output.v).toBe("2.1");
  });

  it("믿는 키가 없으면 받지 않는다(서명 필수) · 서명을 끄면 서명 없는 것도", async () => {
    await app.close();
    app = await start({ plugins: { dir: join(dir, "plugins"), requireSigned: true, keys: [] } });
    expect((await upload(pkg("9.0.0", "9"))).body.error).toMatch(/믿는 서명 키가 정해져 있지 않아/);
    await app.close();
    app = await start({ plugins: { dir: join(dir, "plugins"), requireSigned: false, keys: [] } });
    const r = await upload(pkg("9.0.0", "9", { sign: false }));
    expect(r.status).toBe(201);
    expect(r.body.signer).toBeNull();
  });
});
