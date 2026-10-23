/**
 * 2순위(2026-10-18) — 서버 쪽:
 *   팀 공용 시크릿 · 변수 · 승인 기다리기 · 다른 플로우가 끝나면 실행 · 파일이 생기면 실행
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller, until } from "./helpers.ts";

const call = caller(() => app.url);
let app: App;
let dir: string;
let filesDir: string;
const c: Record<string, string> = {};
const team: Record<string, string> = {};
const pos = { x: 0, y: 0 };

const custom = (id: string, code: string, outputs: string[]) => ({ id, type: "custom", name: id, position: pos, config: { code, outputs } });
const flow = (id: string, nodes: unknown[], more: Record<string, unknown> = {}) => ({
  schemaVersion: 1, id, name: id, nodes, edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: { node: (nodes[i] as { id: string }).id, port: "out" }, to: { node: (n as { id: string }).id } })), ...more,
});
/** 만들고 · 버전 · 게시 */
async function publish(f: Record<string, unknown>, teamId: string | null, who = "admin"): Promise<void> {
  const made = await call("POST", "/api/flows", { draft: f, ...(teamId ? { team: teamId } : {}) }, c[who]);
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const v = await call("POST", `/api/flows/${f["id"]}/versions`, { note: "" }, c[who]);
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  expect((await call("POST", `/api/flows/${f["id"]}/deploy`, { version: v.body.version }, c[who])).status).toBe(200);
}
const runsOf = async (flowId: string) => (await call("GET", `/api/flows/${flowId}/runs`, undefined, c["admin"])).body as any[];
const runOf = async (runId: string) => (await call("GET", `/api/runs/${runId}`, undefined, c["admin"])).body;
const start = async (flowId: string, who = "admin", body: Record<string, unknown> = {}) => {
  const r = await call("POST", `/api/flows/${flowId}/runs`, body, c[who]);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return r.body.runId as string;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-p2-"));
  filesDir = join(dir, "files");
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker({ filesDir }), filesDir, monitor: false, schedule: false, retention: false, auth: { enabled: true } });
  c["admin"] = (await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "longpassword1" })).cookie!;
  team["A"] = (await call("POST", "/api/teams", { name: "주문팀" }, c["admin"])).body.id;
  team["B"] = (await call("POST", "/api/teams", { name: "영업팀" }, c["admin"])).body.id;
  for (const [who, role, t] of [["alice", "editor", "A"], ["rita", "runner", "A"], ["bob", "editor", "B"]] as const) {
    const r = (await call("POST", "/api/users", { email: `${who}@x.com`, name: who, role }, c["admin"])).body;
    await call("PUT", `/api/teams/${team[t]!}/members/${r.user.id}`, undefined, c["admin"]);
    c[who] = (await call("POST", "/api/auth/login", { email: `${who}@x.com`, password: r.tempPassword })).cookie!;
  }
}, 30_000);
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("팀 공용 시크릿 · 변수", () => {
  it("★관리자만 넣는다 · 보는 사람은 제 팀 · 공용만 · 시크릿 값은 나가지 않는다", async () => {
    expect((await call("PUT", "/api/shared/_/vars/portal", { value: "https://g.example", description: "포탈" }, c["admin"])).status).toBe(200);
    expect((await call("PUT", `/api/shared/${team["A"]!}/vars/portal`, { value: "https://a.example" }, c["admin"])).status).toBe(200);
    expect((await call("PUT", `/api/shared/${team["B"]!}/vars/only_b`, { value: "b" }, c["admin"])).status).toBe(200);
    expect((await call("PUT", "/api/shared/_/secrets/acct", { kind: "login", value: { username: "kim", password: "pw-shared-1" } }, c["admin"])).status).toBe(200);
    // 종류 · 값이 틀리면 400 · 없는 팀 404 · 관리자 아니면 403
    expect((await call("PUT", "/api/shared/_/secrets/bad", { kind: "login", value: "x" }, c["admin"])).status).toBe(400);
    expect((await call("PUT", "/api/shared/없는팀/vars/x", { value: "1" }, c["admin"])).status).toBe(404);
    expect((await call("PUT", "/api/shared/_/vars/x", { value: "1" }, c["alice"])).status).toBe(403);

    const mine = (await call("GET", "/api/shared", undefined, c["alice"])).body;
    expect(mine.teams).toEqual([{ id: team["A"]!, name: "주문팀" }]);
    expect(mine.values.map((v: any) => `${v.scope || "_"}/${v.kind}/${v.name}`).sort()).toEqual([`${team["A"]!}/var/portal`, "_/secret/acct", "_/var/portal"].sort());
    const acct = mine.values.find((v: any) => v.name === "acct");
    expect(acct).toMatchObject({ kind: "secret", secretKind: "login", value: null });
    expect(JSON.stringify(mine)).not.toContain("pw-shared-1");
  });

  it("★실행 — 제 팀 값이 공용을 이긴다 · 공용 시크릿이 풀린다 · 없으면 400(돌지 않음)", async () => {
    const uses = (id: string) => flow(id, [custom("c", "return { p: ctx.vars.portal };", ["p"])], { sharedVars: ["portal"], secrets: [{ name: "acct", kind: "login", description: "", shared: true }] });
    await publish(uses("sv-a"), team["A"]!);
    await publish(uses("sv-pub"), null);
    for (const [id, want] of [["sv-a", "https://a.example"], ["sv-pub", "https://g.example"]] as const) {
      const id1 = await start(id);
      await app.runs.wait(id1);
      const got = await runOf(id1);
      expect(got).toMatchObject({ status: "success", result: { output: { p: want } } });
    }
    // 플로우 화면 — 팀 공용 시크릿은 «있음»(어디서 찾았나) · 플로우에 따로 넣을 수는 없다
    const st = (await call("GET", "/api/flows/sv-a/secrets", undefined, c["alice"])).body as any[];
    expect(st).toEqual([expect.objectContaining({ name: "acct", shared: true, stored: true, sharedScope: "" })]);
    expect((await call("PUT", "/api/flows/sv-a/secrets/acct", { value: { username: "a", password: "b" } }, c["alice"])).status).toBe(400);
    // 없는 공용 변수 · 종류가 다른 공용 시크릿 — 시작하지 않는다
    await publish(flow("sv-miss", [custom("c", "return { p: 1 };", ["p"])], { sharedVars: ["nothing"], secrets: [{ name: "acct", kind: "text", description: "", shared: true }] }), team["A"]!);
    const bad = await call("POST", "/api/flows/sv-miss/runs", {}, c["admin"]);
    expect(bad.status).toBe(400);
    expect(bad.body.problems.join(" ")).toMatch(/팀 공용 변수 'nothing'가 없습니다/);
    expect(bad.body.problems.join(" ")).toMatch(/시크릿 'acct'의 값이 저장되지 않았습니다/);
  });

  it("★검문소 — 워크플로우 변수와 같은 이름의 공용 변수는 게시하지 못한다", async () => {
    const f = flow("sv-dup", [custom("c", "return { p: 1 };", ["p"])], { vars: { portal: "x" }, sharedVars: ["portal"] });
    expect((await call("POST", "/api/flows", { draft: f }, c["admin"])).status).toBe(201);
    const v = await call("POST", "/api/flows/sv-dup/versions", { note: "" }, c["admin"]);
    expect(v.status).toBe(422);
    expect(JSON.stringify(v.body)).toMatch(/portal/);
  });
});

describe("승인 기다리기", () => {
  const approvalFlow = (id: string) => flow(id, [
    custom("c1", "return { n: Number(ctx.params.n ?? 1) };", ["n"]),
    { id: "ok", type: "approval", name: "결재", position: pos, config: { message: "{{ $input.n }}번을 제출할까요?", minRole: "editor", timeoutMin: 5 } },
    custom("c2", "return { m: input.n + 1, who: input.by, said: input.comment };", ["m", "who", "said"]),
  ], { params: [{ name: "n", label: "번호", type: "number", required: false }] });

  it("★실행자가 돌리고 · 편집자가 승인하면 이어 간다(받은 값 + 누가 · 한마디) · 실행자는 승인 못 한다", async () => {
    await publish(approvalFlow("ap"), team["A"]!);
    const id = await start("ap", "rita");
    await until(async () => (await call("GET", `/api/runs/${id}/approval`, undefined, c["rita"])).body !== null);
    const wait = (await call("GET", `/api/runs/${id}/approval`, undefined, c["rita"])).body;
    expect(wait).toMatchObject({ runId: id, flowId: "ap", nodeId: "ok", nodeName: "결재", message: "1번을 제출할까요?", minRole: "editor" });
    // 승인 목록 — 같은 팀만
    expect(((await call("GET", "/api/approvals", undefined, c["alice"])).body as any[]).map((a) => a.runId)).toContain(id);
    expect((await call("GET", "/api/approvals", undefined, c["bob"])).body).toEqual([]);
    expect((await call("POST", `/api/runs/${id}/approval`, { approved: true }, c["bob"])).status).toBe(404);   // 남의 팀 — 없는 것처럼
    const no = await call("POST", `/api/runs/${id}/approval`, { approved: true }, c["rita"]);
    expect(no.status).toBe(403);
    expect(no.body.error).toMatch(/편집자 이상/);
    expect((await call("POST", `/api/runs/${id}/approval`, { approved: true, comment: "확인했습니다" }, c["alice"])).status).toBe(200);
    await app.runs.wait(id);
    expect(await runOf(id)).toMatchObject({ status: "success", result: { output: { m: 2, who: "alice@x.com", said: "확인했습니다" } } });
    // 이미 답했다
    expect((await call("POST", `/api/runs/${id}/approval`, { approved: true }, c["alice"])).status).toBe(409);
  });

  it("★거절하면 그 노드가 실패해 멈춘다 · 멈추기로 그만두면 기다림이 걷힌다", async () => {
    const id = await start("ap", "rita");
    await until(async () => app.runs.approvalOf(id) !== null);
    expect((await call("POST", `/api/runs/${id}/approval`, { approved: false, comment: "금액이 틀립니다" }, c["alice"])).status).toBe(200);
    await app.runs.wait(id);
    const r = await runOf(id);
    expect(r.status).toBe("failure");
    expect(r.result.nodes.find((n: any) => n.id === "ok").failure.message).toMatch(/alice@x.com이\(가\) 거절했습니다 — 금액이 틀립니다/);
    expect(r.result.nodes.find((n: any) => n.id === "c2").status).not.toBe("succeeded");

    const id2 = await start("ap", "rita");
    await until(async () => app.runs.approvalOf(id2) !== null);
    expect((await call("POST", `/api/runs/${id2}/cancel`, undefined, c["rita"])).status).toBe(202);
    await app.runs.wait(id2);
    expect((await runOf(id2)).status).toBe("cancelled");
    expect(app.runs.approvalOf(id2)).toBeNull();
  });

  it("★점검은 승인 앞에서 멈춘다(사람에게 묻지 않는다)", async () => {
    const pid = (await call("POST", "/api/flows/ap/probes", { version: 1 }, c["admin"])).body.probeId as string;
    await until(async () => (await call("GET", `/api/probes/${pid}`, undefined, c["admin"])).body.status !== "running", 20_000);
    const p = (await call("GET", `/api/probes/${pid}`, undefined, c["admin"])).body;
    expect(JSON.stringify(p.report)).toMatch(/승인 기다리기 앞에서 멈췄습니다/);
    expect(app.runs.pendingApprovals()).toEqual([]);
  });
});

describe("다른 워크플로우가 끝나면 실행", () => {
  it("★앞이 성공하면 뒤가 돈다 — 앞의 결과가 실행 입력으로 · 초안 시험 · 남의 팀 · 꺼 둔 것은 깨우지 않는다", async () => {
    await publish(flow("up", [custom("c", "return { n: Number(ctx.params.n ?? 5) };", ["n"])], { params: [{ name: "n", label: "n", type: "number", required: false }] }), team["A"]!);
    const after = (id: string, on: string[], enabled = true) => flow(id, [custom("c", "return { y: Number(ctx.params.x) * 2 };", ["y"])], {
      params: [{ name: "x", label: "x", type: "number", required: true }],
      settings: { after: [{ id: "t1", flowId: "up", on, params: { x: "{{ $input.n }}" }, enabled }] },
    });
    await publish(after("down", ["success"]), team["A"]!);
    await publish(after("down-off", ["success"], false), team["A"]!);
    await publish(after("down-fail", ["failure"]), team["A"]!);
    await publish(after("down-b", ["success"]), team["B"]!);

    const id = await start("up", "admin", { params: { n: "21" } });
    await app.runs.wait(id);
    await until(async () => (await runsOf("down")).length > 0);
    const [d] = await runsOf("down");
    expect(d).toMatchObject({ trigger: "after", params: { x: "21" } });
    await app.runs.wait(d.id);
    expect(await runOf(d.id)).toMatchObject({ status: "success", result: { output: { y: 42 } } });
    for (const quiet of ["down-off", "down-fail", "down-b"]) expect(await runsOf(quiet)).toEqual([]);

    // 초안 시험은 뒤를 깨우지 않는다
    const draft = await start("up", "admin", { version: "draft" });
    await app.runs.wait(draft);
    await app.runs.drain();
    expect(await runsOf("down")).toHaveLength(1);
  });

  it("★검문소 — 자기 자신 · 정의 안 된 입력 · 채우지 않은 꼭 필요한 입력은 게시하지 못한다", async () => {
    const f = flow("self", [custom("c", "return {};", [])], {
      params: [{ name: "x", label: "x", type: "text", required: true }],
      settings: { after: [{ id: "t1", flowId: "self", on: ["success"], params: { y: "1" }, enabled: true }] },
    });
    expect((await call("POST", "/api/flows", { draft: f }, c["admin"])).status).toBe(201);
    const v = await call("POST", "/api/flows/self/versions", { note: "" }, c["admin"]);
    expect(v.status).toBe(422);
    const text = JSON.stringify(v.body);
    expect(text).toMatch(/자기/);
    expect(text).toMatch(/y/);
  });

  it("★순환 — 서로를 기다리면 한 바퀴에서 멈추고 «실패»로 남긴다", async () => {
    const ring = (id: string, other: string) => flow(id, [custom("c", "return { n: 1 };", ["n"])], { settings: { after: [{ id: "t1", flowId: other, on: ["success"], params: {}, enabled: true }] } });
    await publish(ring("r1", "r2"), team["A"]!);
    await publish(ring("r2", "r1"), team["A"]!);
    const id = await start("r1");
    await until(async () => (await runsOf("r1")).length >= 2, 15_000);
    await app.runs.drain();
    const r1 = await runsOf("r1");
    expect(r1).toHaveLength(2);
    expect(r1.find((r) => r.id !== id)).toMatchObject({ trigger: "after", status: "failure" });
    expect(r1.find((r) => r.id !== id).message).toMatch(/순환 — r1 → r2 → r1/);
    expect(await runsOf("r2")).toHaveLength(1);
  });
});

describe("파일이 생기면 실행", () => {
  it("★켜기 전 파일은 건너뛰고 · 새 파일이 다 써지면(크기가 두 번 같으면) 한 번만 · 이름이 맞는 것만", async () => {
    const inbox = join(filesDir, "shared", "inbox");
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "old.csv"), "a,b\n");
    await publish(flow("on-file", [custom("c", "return { f: ctx.params.file };", ["f"])], {
      params: [{ name: "file", label: "파일", type: "text", required: true }],
      settings: { fileTriggers: [{ id: "w1", dir: "inbox", pattern: "*.csv", param: "file", enabled: true }] },
    }), null);
    const fw = app.fileWatcher!;
    expect(fw.tick()).toEqual([]);                 // 처음 — 있던 것은 «본 것»으로
    writeFileSync(join(inbox, "new.CSV"), "1,2\n");
    writeFileSync(join(inbox, "note.txt"), "x");
    expect(fw.tick()).toEqual([]);                 // 아직 쓰는 중일 수 있다
    const started = fw.tick();
    expect(started).toHaveLength(1);
    await app.runs.wait(started[0]!);
    expect(await runOf(started[0]!)).toMatchObject({ trigger: "file", params: { file: "new.CSV" }, status: "success", result: { output: { f: "new.CSV" } } });
    expect(fw.tick()).toEqual([]);                 // 같은 파일로 두 번 돌지 않는다
    expect(await runsOf("on-file")).toHaveLength(1);
  });

  it("★검문소 — 공유 폴더 밖 · 경로가 든 꼴은 게시하지 못한다", async () => {
    const f = flow("bad-file", [custom("c", "return {};", [])], { settings: { fileTriggers: [{ id: "w1", dir: "../etc", pattern: "a/b", param: null, enabled: true }] } });
    const made = await call("POST", "/api/flows", { draft: f }, c["admin"]);
    const v = made.status === 201 ? await call("POST", "/api/flows/bad-file/versions", { note: "" }, c["admin"]) : made;
    expect(v.status).toBe(422);
  });
});
