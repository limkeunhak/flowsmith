/**
 * 사내 서버형 — 첫 관리자(설정 토큰) · 로그인 · 역할마다 권한 · 누가 했나 · 비밀번호 · 잠시 막기 · 마지막 관리자 · WebSocket ·
 * 바깥 로그인 자리(signIn) (2026-10-17).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { needOf } from "../src/auth/auth.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);

let app: App;
let dir: string;

const pos = { x: 0, y: 0 };
const flow = { schemaVersion: 1, id: "f1", name: "계산", nodes: [{ id: "c", type: "custom", name: "c", position: pos, config: { code: "return { n: 1 };", outputs: ["n"] } }], edges: [] };
const cookies: Record<string, string> = {};
const login = async (email: string, password: string) => { const r = await call("POST", "/api/auth/login", { email, password }); return r; };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-auth-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, auth: { enabled: true } });
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("첫 관리자 · 로그인", () => {
  it("★사람이 없으면 아무것도 못 한다 — 설정 토큰으로만 첫 관리자", async () => {
    expect((await call("GET", "/api/auth/me")).body).toEqual({ auth: "on", user: null, setup: true, teams: [] });
    expect((await call("GET", "/api/flows")).status).toBe(401);
    expect(app.auth.setupToken).toMatch(/^[\w-]{20,}$/);
    expect((await call("POST", "/api/auth/setup", { token: "틀림", email: "boss@x.com", name: "대표", password: "longpassword1" })).status).toBe(403);
    expect((await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "short" })).body.error).toMatch(/8자 이상/);
    const ok = await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "Boss@X.com", name: "대표", password: "longpassword1" });
    expect(ok.body.user).toMatchObject({ email: "boss@x.com", role: "admin" });
    expect(ok.cookie).toMatch(/^flowsmith_session=/);
    cookies["admin"] = ok.cookie!;
    // 한 번뿐
    expect(app.auth.setupToken).toBeNull();
    expect((await call("POST", "/api/auth/setup", { token: "x", email: "a@x.com", password: "longpassword1" })).status).toBe(409);
    expect((await call("GET", "/api/auth/me", undefined, cookies["admin"])).body.user.email).toBe("boss@x.com");
  });

  it("★관리자가 사람을 들인다 — 임시 비밀번호는 그때만 · 처음 들어오면 바꾸게", async () => {
    for (const [role, email] of [["editor", "ed@x.com"], ["runner", "run@x.com"], ["viewer", "see@x.com"]] as const) {
      const r = await call("POST", "/api/users", { email, name: role, role }, cookies["admin"]);
      expect(r.status).toBe(201);
      expect(r.body.user).toMatchObject({ email, role, mustChange: true });
      expect(r.body.tempPassword).toMatch(/^[\w]{4}-[\w]{4}-[\w]{4}$/);
      const l = await login(email, r.body.tempPassword);
      expect(l.status, JSON.stringify(l.body)).toBe(200);
      cookies[role] = l.cookie!;
    }
    expect((await call("GET", "/api/users", undefined, cookies["admin"])).body).toHaveLength(4);
    expect((await call("GET", "/api/users", undefined, cookies["editor"])).status).toBe(403);
    expect(JSON.stringify((await call("GET", "/api/users", undefined, cookies["admin"])).body)).not.toMatch(/pwHash|scrypt/);
  });
});

describe("역할마다", () => {
  it("★편집자는 만들고 게시 · 실행자는 게시된 버전만 돌린다 · 보는 사람은 보기만 — 누가 했는지 남는다", async () => {
    expect((await call("POST", "/api/flows", { draft: flow }, cookies["viewer"])).status).toBe(403);
    expect((await call("POST", "/api/flows", { draft: flow }, cookies["runner"])).status).toBe(403);
    expect((await call("POST", "/api/flows", { draft: flow }, cookies["editor"])).status).toBe(201);
    await call("PUT", "/api/flows/f1/draft", { draft: { ...flow, name: "계산 2" } }, cookies["editor"]);
    expect((await call("POST", "/api/flows/f1/versions", { note: "" }, cookies["editor"])).status).toBe(201);
    await call("POST", "/api/flows/f1/deploy", { version: 1 }, cookies["editor"]);
    const d = (await call("GET", "/api/flows/f1", undefined, cookies["viewer"])).body;
    expect(d).toMatchObject({ updatedBy: "ed@x.com", versions: [{ version: 1, createdBy: "ed@x.com" }] });
    // 실행자 — 초안은 안 되고 게시된 버전은 된다
    expect((await call("POST", "/api/flows/f1/runs", { version: "draft" }, cookies["runner"])).body.error).toMatch(/게시된 버전만/);
    const { runId } = (await call("POST", "/api/flows/f1/runs", {}, cookies["runner"])).body;
    await app.runs.wait(runId);
    expect((await call("GET", `/api/runs/${runId}`, undefined, cookies["viewer"])).body).toMatchObject({ status: "success", startedBy: "run@x.com" });
    expect((await call("POST", "/api/flows/f1/runs", {}, cookies["viewer"])).status).toBe(403);
    expect((await call("PUT", "/api/flows/f1/secrets/x", { value: "1" }, cookies["runner"])).status).toBe(403);
    // 로그인 안 했으면 아무것도
    expect((await call("GET", "/api/flows/f1")).status).toBe(401);
  }, 30_000);

  it("웹훅은 로그인 없이 — 토큰으로 막는다 · 다른 출처는 여전히 막는다", async () => {
    expect((await call("POST", "/api/hooks/f1", {})).status).toBe(404);              // 웹훅이 꺼져 있다(401이 아니다)
    const r = await fetch(app.url + "/api/flows", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: cookies["editor"]! }, body: "{}" });
    expect(r.status).toBe(403);
  });

  it("권한 표 — 한 곳에서", () => {
    expect(needOf("GET", "/")).toBe("public");
    expect(needOf("GET", "/api/flows")).toBe("viewer");
    expect(needOf("POST", "/api/flows/a/runs")).toBe("runner");
    expect(needOf("POST", "/api/runs/x/cancel")).toBe("runner");
    expect(needOf("PUT", "/api/flows/a/draft")).toBe("editor");
    expect(needOf("POST", "/api/flows/a/새로운길")).toBe("editor");                   // ★모르는 길은 닫힌 쪽(편집자)
    expect(needOf("GET", "/api/users")).toBe("admin");
    expect(needOf("POST", "/api/hooks/a")).toBe("public");
  });
});

describe("비밀번호 · 잠시 막기 · 끄기", () => {
  it("★내 비밀번호 바꾸기 — 지금 것을 알아야 · 옛 것으로는 못 들어온다", async () => {
    expect((await call("POST", "/api/auth/password", { current: "틀림", next: "newpassword9" }, cookies["viewer"])).status).toBe(403);
    const users = (await call("GET", "/api/users", undefined, cookies["admin"])).body as any[];
    const see = users.find((u) => u.email === "see@x.com");
    const reset = (await call("POST", `/api/users/${see.id}/reset`, undefined, cookies["admin"])).body.tempPassword;
    expect((await call("GET", "/api/flows", undefined, cookies["viewer"])).status).toBe(401);   // 초기화하면 로그인이 끊긴다
    const l = await login("see@x.com", reset);
    cookies["viewer"] = l.cookie!;
    expect((await call("POST", "/api/auth/password", { current: reset, next: "newpassword9" }, cookies["viewer"])).body).toEqual({ ok: true });
    expect((await login("see@x.com", reset)).status).toBe(401);
    expect((await login("see@x.com", "newpassword9")).status).toBe(200);
  });

  it("★틀린 비밀번호가 5번이면 잠시 막는다", async () => {
    for (let i = 0; i < 5; i++) expect((await login("ed@x.com", "wrong-" + i)).status).toBe(401);
    expect((await login("ed@x.com", "아무거나")).status).toBe(429);
  });

  it("★마지막 관리자는 내리거나 끌 수 없다 · 끈 사람은 들어오지 못하고 로그인도 끊긴다", async () => {
    const users = (await call("GET", "/api/users", undefined, cookies["admin"])).body as any[];
    const boss = users.find((u) => u.role === "admin");
    expect((await call("PUT", `/api/users/${boss.id}`, { role: "editor" }, cookies["admin"])).status).toBe(409);
    const run = users.find((u) => u.email === "run@x.com");
    expect((await call("PUT", `/api/users/${run.id}`, { disabled: true }, cookies["admin"])).body.disabled).toBe(true);
    expect((await call("GET", "/api/flows", undefined, cookies["runner"])).status).toBe(401);
  });

  it("★녹화 · 실행 화면 WebSocket도 같은 쿠키로 — 녹화는 편집자 이상", async () => {
    const tryWs = (path: string, cookie?: string) => new Promise<"open" | "denied">((ok) => {
      const ws = new WebSocket(app.url.replace("http", "ws") + path, { headers: cookie ? { cookie } : {} });
      ws.on("open", () => { ws.close(); ok("open"); });
      ws.on("error", () => ok("denied"));
      ws.on("unexpected-response", () => ok("denied"));
    });
    expect(await tryWs("/api/live")).toBe("denied");
    expect(await tryWs("/api/live", cookies["viewer"])).toBe("denied");
    expect(await tryWs("/api/live", cookies["admin"])).toBe("open");
    expect(await tryWs("/api/runs/x/screen")).toBe("denied");
    expect(await tryWs("/api/runs/x/screen", cookies["viewer"])).toBe("open");
  });

  it("★바깥 로그인 자리 — 처음 온 사람은 «보는 사람» · 비밀번호로는 못 들어온다", () => {
    const u = app.auth.signIn({ email: "sso@x.com", name: "사내 로그인" });
    expect(u).toMatchObject({ email: "sso@x.com", role: "viewer" });
    expect(app.auth.signIn({ email: "SSO@x.com", name: "" }).id).toBe(u.id);
    return expect(app.auth.login("sso@x.com", "external", "t")).rejects.toThrow(/맞지 않습니다/);
  });
});
