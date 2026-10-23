/**
 * 열린 API — OpenAPI 명세(길과 설명이 어긋나지 않나) · API 토큰(Bearer fsa_ · 역할 상한 · 끝 · 지우기 · 다른 출처) (2026-10-17).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { apiRoutes, type ApiDeps } from "../src/http/api.ts";
import { drift } from "../src/http/openapi.ts";
import { hashToken } from "../src/auth/tokens.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);
const bearer = (t: string, more: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...more });

let app: App;
let dir: string;
let admin = "";
let editor = "";
let editorId = "";

const flow = { schemaVersion: 1, id: "f1", name: "계산", nodes: [{ id: "c", type: "custom", name: "c", position: { x: 0, y: 0 }, config: { code: "return { n: 1 };", outputs: ["n"] } }], edges: [] };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-api-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  admin = (await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "longpassword1" })).cookie!;
  const u = (await call("POST", "/api/users", { email: "ed@x.com", name: "편집", role: "editor" }, admin)).body;
  editorId = u.user.id;
  editor = (await call("POST", "/api/auth/login", { email: "ed@x.com", password: u.tempPassword })).cookie!;
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("OpenAPI 명세", () => {
  it("★모든 길에 설명이 있고, 설명마다 길이 있다", () => {
    const routes = apiRoutes({ store: app.store, runs: app.runs, monitor: app.monitor, notifier: app.notifier, auth: app.auth, workers: app.workers } as unknown as ApiDeps);
    expect(drift(routes)).toEqual({ undocumented: [], stale: [] });
  });

  it("로그인 없이 받는다 — 길 · 필요한 역할 · 인증 방식", async () => {
    const r = await call("GET", "/api/openapi.json");
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe("3.0.3");
    const run = r.body.paths["/api/flows/{id}/runs"].post;
    expect(run.parameters).toContainEqual(expect.objectContaining({ name: "id", in: "path", required: true }));
    expect(run.description).toMatch(/실행자 이상/);
    expect(run.security).toEqual([{ apiToken: [] }, { session: [] }]);
    expect(r.body.paths["/api/hooks/{flowId}"]?.post.security ?? r.body.paths["/api/hooks/{id}"]?.post.security).toEqual([{ webhookToken: [] }]);
    expect(r.body.paths["/api/tokens"].post.requestBody.content["application/json"].schema.required).toEqual(["name"]);
    expect(Object.keys(r.body.components.securitySchemes)).toEqual(["apiToken", "session", "webhookToken"]);
  });
});

describe("API 토큰", () => {
  let tok = "";
  let tokId = "";

  it("★만들 때 한 번만 보인다 — 목록에는 값이 없다", async () => {
    const r = await call("POST", "/api/tokens", { name: "사내 대시보드" }, editor);
    expect(r.status).toBe(201);
    expect(r.body.token).toMatch(/^fsa_[\w-]{40,}$/);
    expect(r.body.row).toMatchObject({ name: "사내 대시보드", role: "editor", expiresAt: null, lastUsedAt: null });
    tok = r.body.token; tokId = r.body.row.id;
    const list = await call("GET", "/api/tokens", undefined, editor);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(tok);
    expect(JSON.stringify(list.body)).not.toContain(hashToken(tok));
    expect((await call("GET", "/api/tokens", undefined, admin)).body).toHaveLength(0);   // 남의 것은 안 보인다
  });

  it("★토큰으로 부른다 — 다른 출처여도(쿠키가 아니라 머리글) · 누가 했는지 남는다", async () => {
    expect((await call("GET", "/api/flows", undefined, bearer(tok))).status).toBe(200);
    const made = await call("POST", "/api/flows", { draft: flow }, bearer(tok, { origin: "https://elsewhere.example" }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await call("PUT", "/api/flows/f1/draft", { draft: { ...flow, name: "계산 2" } }, bearer(tok, { origin: "https://elsewhere.example" }))).status).toBe(200);
    expect((await call("GET", "/api/flows/f1", undefined, bearer(tok))).body.updatedBy).toBe("ed@x.com");
    // 쿠키는 여전히 같은 출처만
    expect((await call("PUT", "/api/flows/f1/draft", { draft: flow }, { cookie: editor, origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await call("GET", "/api/tokens", undefined, editor)).body[0].lastUsedAt).not.toBeNull();
  });

  it("★역할은 내 역할 이하 — 그 사람의 역할이 내려가면 토큰도", async () => {
    expect((await call("POST", "/api/tokens", { name: "x", role: "admin" }, editor)).status).toBe(403);
    const seer = (await call("POST", "/api/tokens", { name: "보기만", role: "viewer" }, editor)).body.token;
    expect((await call("GET", "/api/flows", undefined, bearer(seer))).status).toBe(200);
    expect((await call("PUT", "/api/flows/f1/draft", { draft: flow }, bearer(seer))).status).toBe(403);
    expect((await call("PUT", "/api/flows/f1/draft", { draft: flow }, bearer(tok))).status).toBe(200);
    await call("PUT", `/api/users/${editorId}`, { role: "viewer" }, admin);
    expect((await call("PUT", "/api/flows/f1/draft", { draft: flow }, bearer(tok))).status).toBe(403);
    await call("PUT", `/api/users/${editorId}`, { role: "editor" }, admin);
    expect((await call("PUT", "/api/flows/f1/draft", { draft: flow }, bearer(tok))).status).toBe(200);
  });

  it("★토큰으로는 토큰을 못 만들고 비밀번호도 못 바꾼다", async () => {
    expect((await call("POST", "/api/tokens", { name: "더" }, bearer(tok))).status).toBe(403);
    expect((await call("POST", "/api/auth/password", { current: "x", next: "longpassword2" }, bearer(tok))).status).toBe(403);
  });

  it("끝난 토큰 · 지운 토큰 · 끈 사람 · 틀린 토큰은 401", async () => {
    const short = (await call("POST", "/api/tokens", { name: "잠깐", days: 1 }, editor)).body;
    expect(short.row.expiresAt).not.toBeNull();
    expect(app.store.apiTokenUser(hashToken(short.token))).not.toBeNull();
    expect(app.store.apiTokenUser(hashToken(short.token), new Date(Date.now() + 2 * 86_400_000).toISOString())).toBeNull();
    expect((await call("POST", "/api/tokens", { name: "x", days: 0 }, editor)).status).toBe(400);
    expect((await call("GET", "/api/flows", undefined, bearer("fsa_wrong"))).status).toBe(401);
    // 지우기 — 남의 것은 못 지운다(관리자는 된다)
    const other = (await call("POST", "/api/tokens", { name: "관리자 것" }, admin)).body;
    expect((await call("DELETE", `/api/tokens/${other.row.id}`, undefined, editor)).status).toBe(404);
    expect((await call("DELETE", `/api/tokens/${short.row.id}`, undefined, admin)).status).toBe(204);
    expect((await call("GET", "/api/flows", undefined, bearer(short.token))).status).toBe(401);
    // 끈 사람(그 사람의 로그인도 끊긴다)
    await call("PUT", `/api/users/${editorId}`, { disabled: true }, admin);
    expect((await call("GET", "/api/flows", undefined, bearer(tok))).status).toBe(401);
    await call("PUT", `/api/users/${editorId}`, { disabled: false }, admin);
    expect((await call("GET", "/api/flows", undefined, bearer(tok))).status).toBe(200);
    expect((await call("DELETE", `/api/tokens/${tokId}`, undefined, admin)).status).toBe(204);
    expect((await call("GET", "/api/flows", undefined, bearer(tok))).status).toBe(401);
  });
});

describe("로그인을 끈 서버", () => {
  it("토큰이 없어도 부른다 — 토큰 길은 400으로 알려 준다 · 명세에 인증이 없다", async () => {
    const d = mkdtempSync(join(tmpdir(), "flowsmith-api-off-"));
    const off = await startApp({ dbPath: join(d, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false });
    try {
      const c = caller(() => off.url);
      expect((await c("GET", "/api/tokens")).body.error).toMatch(/로그인을 끈 서버/);
      const spec = (await c("GET", "/api/openapi.json")).body;
      expect(spec.paths["/api/flows"].get.security).toEqual([]);
    } finally {
      await off.close();
      rmSync(d, { recursive: true, force: true });
    }
  });
});
