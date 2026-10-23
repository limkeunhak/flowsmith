/**
 * 팀 — 내 팀 플로우와 공용만 보인다 · 남의 팀 것은 없는 것처럼(404) · 실행 · 점검 · 파일 · WebSocket까지 · 만들기 · 옮기기 (2026-10-17).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);

let app: App;
let dir: string;
const c: Record<string, string> = {};
const team: Record<string, string> = {};

const pos = { x: 0, y: 0 };
const flowOf = (id: string) => ({ schemaVersion: 1, id, name: id, nodes: [{ id: "c", type: "custom", name: "c", position: pos, config: { code: "return { n: 1 };", outputs: ["n"] } }], edges: [] });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-teams-"));
  const filesDir = join(dir, "files");
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker({ filesDir }), filesDir, monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  c["admin"] = (await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "longpassword1" })).cookie!;
  team["A"] = (await call("POST", "/api/teams", { name: "주문팀" }, c["admin"])).body.id;
  team["B"] = (await call("POST", "/api/teams", { name: "영업팀" }, c["admin"])).body.id;
  for (const [who, role, t] of [["alice", "editor", "A"], ["bob", "editor", "B"], ["carol", "viewer", null]] as const) {
    const r = (await call("POST", "/api/users", { email: `${who}@x.com`, name: who, role }, c["admin"])).body;
    if (t) await call("PUT", `/api/teams/${team[t]}/members/${r.user.id}`, undefined, c["admin"]);
    c[who] = (await call("POST", "/api/auth/login", { email: `${who}@x.com`, password: r.tempPassword })).cookie!;
  }
  expect((await call("POST", "/api/flows", { draft: flowOf("a1"), team: team["A"] }, c["alice"])).status).toBe(201);
  expect((await call("POST", "/api/flows", { draft: flowOf("b1"), team: team["B"] }, c["bob"])).status).toBe(201);
  expect((await call("POST", "/api/flows", { draft: flowOf("pub") }, c["alice"])).status).toBe(201);
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

const ids = async (who: string) => ((await call("GET", "/api/flows", undefined, c[who])).body as any[]).map((f) => f.id).sort();

describe("보이는 것", () => {
  it("★내 팀 워크플로우와 공용만 — 관리자는 전부 · 팀 없는 사람은 공용만", async () => {
    expect(await ids("alice")).toEqual(["a1", "pub"]);
    expect(await ids("bob")).toEqual(["b1", "pub"]);
    expect(await ids("carol")).toEqual(["pub"]);
    expect(await ids("admin")).toEqual(["a1", "b1", "pub"]);
    const a1 = ((await call("GET", "/api/flows", undefined, c["alice"])).body as any[]).find((f) => f.id === "a1");
    expect(a1.team).toEqual({ id: team["A"], name: "주문팀" });
    expect((await call("GET", "/api/auth/me", undefined, c["alice"])).body.teams).toEqual([{ id: team["A"], name: "주문팀" }]);
  });

  it("★남의 팀 워크플로우는 없는 것처럼 — 초안 · 고치기 · 실행 · 실행 기록 · 점검까지", async () => {
    expect((await call("GET", "/api/flows/a1", undefined, c["bob"])).status).toBe(404);
    expect((await call("PUT", "/api/flows/a1/draft", { draft: flowOf("a1") }, c["bob"])).status).toBe(404);
    expect((await call("POST", "/api/flows/a1/runs", { version: "draft" }, c["bob"])).status).toBe(404);
    const { runId } = (await call("POST", "/api/flows/a1/runs", { version: "draft" }, c["alice"])).body;
    await app.runs.wait(runId);
    expect((await call("GET", `/api/runs/${runId}`, undefined, c["alice"])).status).toBe(200);
    expect((await call("GET", `/api/runs/${runId}`, undefined, c["bob"])).status).toBe(404);
    expect((await call("GET", `/api/runs/${runId}`, undefined, c["admin"])).status).toBe(200);
    expect((await call("GET", "/api/flows/pub", undefined, c["carol"])).status).toBe(200);
  }, 30_000);

  it("★파일 — 남의 팀 폴더는 못 본다 · 공유는 모두 · 뿌리 전체는 관리자만", async () => {
    const uid = (await call("GET", "/api/flows/a1", undefined, c["alice"])).body.uid;
    mkdirSync(join(dir, "files", uid), { recursive: true });
    mkdirSync(join(dir, "files", "shared"), { recursive: true });
    writeFileSync(join(dir, "files", uid, "a.csv"), "x\n1\n");
    writeFileSync(join(dir, "files", "shared", "s.csv"), "y\n2\n");
    expect((await call("GET", `/api/files/preview?path=${uid}/a.csv`, undefined, c["alice"])).status).toBe(200);
    expect((await call("GET", `/api/files/preview?path=${uid}/a.csv`, undefined, c["bob"])).status).toBe(404);
    expect((await call("GET", `/api/files?flow=a1&scope=flow&dir=`, undefined, c["bob"])).status).toBe(404);
    expect((await call("GET", "/api/files/preview?path=shared/s.csv", undefined, c["bob"])).status).toBe(200);
    expect((await call("GET", "/api/files?dir=", undefined, c["bob"])).status).toBe(404);
    expect((await call("GET", "/api/files?dir=", undefined, c["admin"])).status).toBe(200);
  });

  it("★녹화 · 실행 화면 — 남의 팀 것은 열리지 않는다", async () => {
    const recordOpen = (cookie: string, flowId: string) => new Promise<string>((ok) => {
      const ws = new WebSocket(app.url.replace("http", "ws") + "/api/live", { headers: { cookie } });
      ws.on("open", () => ws.send(JSON.stringify({ t: "open", flowId, nodeId: "c", draft: flowOf(flowId), params: {}, replay: false, replayExisting: false })));
      ws.on("message", (d) => { const m = JSON.parse(String(d)); if (m.t === "notice") { ok(m.text); ws.close(); } });
      setTimeout(() => { ok("열림"); ws.close(); }, 3000);
    });
    expect(await recordOpen(c["bob"]!, "a1")).toBe("없는 워크플로우입니다");
    const runs = (await call("GET", "/api/flows/a1/runs", undefined, c["alice"])).body as any[];
    const screen = (cookie: string) => new Promise<string>((ok) => {
      const ws = new WebSocket(app.url.replace("http", "ws") + `/api/runs/${runs[0].id}/screen`, { headers: { cookie } });
      ws.on("open", () => { ws.close(); ok("open"); });
      ws.on("error", () => ok("denied"));
      ws.on("unexpected-response", () => ok("denied"));
    });
    expect(await screen(c["bob"]!)).toBe("denied");
    expect(await screen(c["alice"]!)).toBe("open");
  }, 20_000);
});

describe("만들기 · 옮기기 · 팀 관리", () => {
  it("★내 팀에만 만들고 옮긴다 — 관리자는 어디든 · 공용은 누구나", async () => {
    expect((await call("POST", "/api/flows", { draft: flowOf("a2"), team: team["B"] }, c["alice"])).body.error).toMatch(/내가 속한 팀에만/);
    expect((await call("PUT", "/api/flows/a1/team", { team: team["B"] }, c["alice"])).status).toBe(403);
    expect((await call("PUT", "/api/flows/a1/team", { team: null }, c["alice"])).body.team).toBeNull();          // 공용으로
    expect(await ids("bob")).toContain("a1");
    expect((await call("PUT", "/api/flows/a1/team", { team: team["A"] }, c["admin"])).body.team).toMatchObject({ name: "주문팀" });
    expect(await ids("bob")).not.toContain("a1");
  });

  it("팀 관리는 관리자만 · 워크플로우가 남은 팀은 지우지 않는다 · 이름 겹침", async () => {
    expect((await call("POST", "/api/teams", { name: "새 팀" }, c["alice"])).status).toBe(403);
    expect((await call("DELETE", `/api/teams/${team["A"]}`, undefined, c["admin"])).status).toBe(409);
    expect((await call("POST", "/api/teams", { name: "영업팀" }, c["admin"])).status).toBe(409);
    const list = (await call("GET", "/api/teams", undefined, c["admin"])).body as any[];
    expect(list.find((t) => t.name === "주문팀")).toMatchObject({ flows: 1, members: [expect.any(String)] });
  });
});

describe("팀을 넘는 부르기 · 읽기", () => {
  it("★다른 팀의 워크플로우는 부를 수 없다 — 공용은 된다", async () => {
    const caller = (id: string, target: string) => ({ schemaVersion: 1, id, name: id,
      nodes: [{ id: "call", type: "flowCall", name: "부르기", position: pos, config: { flowId: target, version: "draft", items: "", params: {} } }], edges: [] });
    await call("POST", "/api/flows", { draft: caller("callB", "b1"), team: team["A"] }, c["alice"]);
    await call("POST", "/api/flows", { draft: caller("callPub", "pub"), team: team["A"] }, c["alice"]);
    const run = async (id: string) => { const { runId } = (await call("POST", `/api/flows/${id}/runs`, { version: "draft" }, c["alice"])).body; await app.runs.wait(runId); return (await call("GET", `/api/runs/${runId}`, undefined, c["alice"])).body; };
    expect((await run("callB")).message).toMatch(/다른 팀의 워크플로우는 부를 수 없습니다/);
    expect((await run("callPub")).status).toBe("success");
  }, 30_000);
});
