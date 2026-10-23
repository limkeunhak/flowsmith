/**
 * 게시된 버전 한 번에(GET /api/flows/:id/published) — 밖의 시스템이 받아 간다 (2026-10-17).
 * ETag/304 · 되돌려 게시 · 내리면 not-deployed · 남의 팀 것은 404 · 보는 사람 토큰 · 초안은 오지 않는다 · 언제 · 누가 게시했나.
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
const pos = { x: 0, y: 0 };
const flow = (id: string, n: number) => ({ schemaVersion: 1, id, name: `계산 ${n}`, nodes: [{ id: "c", type: "custom", name: "c", position: pos, config: { code: `return { n: ${n} };`, outputs: ["n"] } }], edges: [] });

let app: App;
let dir: string;
let admin = "";
let viewerToken = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-pub-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  admin = (await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "longpassword1" })).cookie!;
  const u = (await call("POST", "/api/users", { email: "see@x.com", name: "보기", role: "viewer" }, admin)).body;
  const see = (await call("POST", "/api/auth/login", { email: "see@x.com", password: u.tempPassword })).cookie!;
  viewerToken = (await call("POST", "/api/tokens", { name: "외부 시스템", role: "viewer" }, see)).body.token;
  // 공용 플로우 — 버전 1 · 2
  await call("POST", "/api/flows", { draft: flow("order", 1) }, admin);
  await call("POST", "/api/flows/order/versions", { note: "처음" }, admin);
  await call("PUT", "/api/flows/order/draft", { draft: flow("order", 2) }, admin);
  await call("POST", "/api/flows/order/versions", { note: "둘째" }, admin);
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (id: string, etag?: string) => call("GET", `/api/flows/${id}/published`, undefined, { authorization: `Bearer ${viewerToken}`, ...(etag ? { "if-none-match": etag } : {}) });

describe("게시된 버전 한 번에", () => {
  it("★게시하지 않았으면 404 not-deployed", async () => {
    const r = await get("order");
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ reason: "not-deployed" });
    // 없는 플로우는 reason이 없다
    const none = await get("nothing");
    expect(none.status).toBe(404);
    expect(none.body.reason).toBeUndefined();
  });

  it("★게시하면 버전 · 메모 · 언제 · 누가 · 검문소를 통과한 매니페스트 — 초안이 아니다 · ETag", async () => {
    await call("POST", "/api/flows/order/deploy", { version: 1 }, admin);
    await call("PUT", "/api/flows/order/draft", { draft: flow("order", 99) }, admin);   // 초안을 고쳐도
    const r = await get("order");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ flowId: "order", version: 1, note: "처음", createdBy: "boss@x.com", deployedBy: "boss@x.com" });
    expect(r.body.deployedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(r.body.manifest.nodes[0].config.code).toBe("return { n: 1 };");
    expect(r.body.manifest.name).toBe("계산 1");
    expect(r.headers.get("etag")).toBe(`"${r.body.uid}.1"`);
    // 플로우 화면에도 언제 · 누가
    expect((await call("GET", "/api/flows/order", undefined, admin)).body).toMatchObject({ activeVersion: 1, deployedBy: "boss@x.com" });
  });

  it("★같은 ETag면 304(본문 없음) · 여러 값 · 약한 표시도 받는다", async () => {
    const etag = (await get("order")).headers.get("etag")!;
    const r = await get("order", etag);
    expect(r.status).toBe(304);
    expect(r.text).toBe("");
    expect((await get("order", `"other", W/${etag}`)).status).toBe(304);
    expect((await get("order", `"x.9"`)).status).toBe(200);
  });

  it("★다른 버전을 게시하면 ETag가 바뀐다 — 옛 버전으로 되돌려도", async () => {
    const e1 = (await get("order")).headers.get("etag")!;
    await call("POST", "/api/flows/order/deploy", { version: 2 }, admin);
    const r2 = await get("order", e1);
    expect(r2.status).toBe(200);
    expect(r2.body.version).toBe(2);
    await call("POST", "/api/flows/order/deploy", { version: 1 }, admin);
    const back = await get("order", r2.headers.get("etag")!);
    expect(back.status).toBe(200);
    expect(back.body.version).toBe(1);
    expect(back.headers.get("etag")).toBe(e1);
  });

  it("★내리면 받아 둔 ETag가 있어도 404 not-deployed — 304가 아니다", async () => {
    const e = (await get("order")).headers.get("etag")!;
    await call("POST", "/api/flows/order/deploy", { version: null }, admin);
    const r = await get("order", e);
    expect(r.status).toBe(404);
    expect(r.body.reason).toBe("not-deployed");
    expect((await call("GET", "/api/flows/order", undefined, admin)).body).toMatchObject({ activeVersion: null, deployedBy: "boss@x.com" });
  });

  it("★남의 팀 워크플로우는 없는 것처럼 · 토큰이 없거나 틀리면 401", async () => {
    const team = (await call("POST", "/api/teams", { name: "영업팀" }, admin)).body;
    await call("POST", "/api/flows", { draft: flow("secret-order", 1), team: team.id }, admin);
    await call("POST", "/api/flows/secret-order/versions", { note: "" }, admin);
    await call("POST", "/api/flows/secret-order/deploy", { version: 1 }, admin);
    expect((await call("GET", "/api/flows/secret-order/published", undefined, admin)).status).toBe(200);
    const hidden = await get("secret-order");
    expect(hidden.status).toBe(404);
    expect(hidden.body.reason).toBeUndefined();
    expect((await call("GET", "/api/flows/order/published")).status).toBe(401);
    expect((await call("GET", "/api/flows/order/published", undefined, { authorization: "Bearer fsa_wrong" })).status).toBe(401);
  });

  it("명세에 ETag · If-None-Match · 304가 보인다", async () => {
    const op = (await call("GET", "/api/openapi.json")).body.paths["/api/flows/{id}/published"].get;
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: "If-None-Match", in: "header" }));
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(["200", "304", "404"]));
    expect(op.description).toMatch(/not-deployed/);
  });
});
