/**
 * 사람 기다리기 — 서버 쪽 (2026-10-17).
 *   실행 화면은 기다리는 동안만 · 실행자 이상만 누를 수 있다(보는 사람은 눌러도 페이지에 가지 않는다) ·
 *   기다리기 시작하면 알린다(게시된 버전 · 그 실행으로 가는 링크) · 진행(SSE)에 «human»이 실린다
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller, until } from "./helpers.ts";

const call = caller(() => app.url);
let site: TestSite;
let app: App;
let dir: string;
let admin = "";
let viewer = "";
const sent: { url: string; body: any }[] = [];

const css = (label: string, value: string) => ({ label, locators: [{ kind: "css", value }], fingerprint: null, frames: [], verifiedAt: null });
const flow = () => ({
  schemaVersion: 1, id: "portal", name: "포털",
  settings: { notify: [{ id: "n1", on: ["human"], channel: "webhook", url: "https://hooks.example/human" }] },
  nodes: [{ id: "w", type: "web", name: "포털 읽기", position: { x: 0, y: 0 }, config: {
    start: { kind: "url", url: `${site.url}/home` },   // 로그인 안 했으면 /login으로 보낸다
    actions: [
      { id: "h1", kind: "human", prompt: "시험 사이트에 로그인해 주세요", appears: css("로그인 단추", "button[type=submit]"), done: { kind: "visible", target: css("사용자 이름", "[data-testid=user-name]") } },
      { id: "r1", kind: "read", target: css("사용자 이름", "[data-testid=user-name]"), output: "name", strategy: "auto" },
    ],
  } }],
  edges: [],
});

function screen(runId: string, cookie: string) {
  const ws = new WebSocket(`${app.url.replace("http", "ws")}/api/runs/${runId}/screen`, { headers: { cookie } });
  const msgs: any[] = [];
  let frames = 0;
  ws.on("message", (d, binary) => { if (binary) frames++; else msgs.push(JSON.parse(String(d))); });
  const open = new Promise<void>((r) => ws.on("open", () => r()));
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  /** 키보드로만 로그인한다 — Tab으로 아이디 칸 · 글자 · Tab · 글자 · Enter(좌표를 몰라도 된다) */
  const login = async (id: string, pw: string) => {
    const key = (k: string) => { send({ t: "key", type: "down", key: k }); send({ t: "key", type: "up", key: k }); };
    key("Tab"); send({ t: "text", text: id }); key("Tab"); send({ t: "text", text: pw }); key("Enter");
  };
  return { ws, msgs, open, login, frames: () => frames, human: () => msgs.filter((m) => m.t === "human").at(-1) };
}

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-human-"));
  app = await startApp({
    dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false, auth: { enabled: true },
    publicUrl: "https://studio.example.com/",
    notifyFetch: (async (url: string | URL | Request, init?: RequestInit) => { sent.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response("", { status: 200 }); }) as typeof fetch,
  });
  admin = (await call("POST", "/api/auth/setup", { token: app.auth.setupToken, email: "boss@x.com", name: "대표", password: "longpassword1" })).cookie!;
  const u = (await call("POST", "/api/users", { email: "see@x.com", name: "보기", role: "viewer" }, admin)).body;
  viewer = (await call("POST", "/api/auth/login", { email: "see@x.com", password: u.tempPassword })).cookie!;
  expect((await call("POST", "/api/flows", { draft: flow() }, admin)).status).toBe(201);
  await call("POST", "/api/flows/portal/versions", { note: "" }, admin);
  await call("POST", "/api/flows/portal/deploy", { version: 1 }, admin);
}, 60_000);
afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("사람 기다리기 — 서버", () => {
  it("★기다리는 동안만 · 실행자 이상만 실행 화면을 누른다 — 사람이 로그인하면 이어 간다 · 알림이 간다", async () => {
    const { runId } = (await call("POST", "/api/flows/portal/runs", {}, admin)).body;
    await until(() => app.screens.waiting(runId), 20_000, "사람 기다리기가 시작되지 않았습니다");

    // 알림 — 기다리는 동안 · 그 실행으로 가는 링크
    await until(() => sent.length > 0);
    expect(sent[0]!.body).toMatchObject({ event: "human", link: `https://studio.example.com/#/flows/portal/runs/${runId}`, run: { status: "running" } });
    expect(sent[0]!.body.facts.find((f: any) => f.name === "무엇").value).toBe("시험 사이트에 로그인해 주세요");

    const see = screen(runId, viewer);
    const boss = screen(runId, admin);
    await Promise.all([see.open, boss.open]);
    await until(() => see.human() !== undefined && boss.human() !== undefined);
    expect(see.human()).toMatchObject({ prompt: "시험 사이트에 로그인해 주세요", control: false });
    expect(boss.human()).toMatchObject({ prompt: "시험 사이트에 로그인해 주세요", control: true });

    // ★나중에 붙은 사람도 바로 크기 · 주소 · 지금 화면을 받는다(화면이 바뀌지 않아도) — 크기를 모르면 누른 자리가 어긋난다
    await until(() => boss.frames() > 0, 10_000, "화면이 오지 않았습니다");
    await new Promise((r) => setTimeout(r, 500));
    const late = screen(runId, admin);
    await late.open;
    await until(() => late.frames() > 0 && late.msgs.some((m) => m.t === "viewport") && late.msgs.some((m) => m.t === "page"), 3_000, "나중에 붙은 사람이 크기 · 화면을 못 받았습니다");
    expect(late.msgs.find((m) => m.t === "viewport")).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    late.ws.close();

    // 보는 사람이 쳐도 페이지에 가지 않는다 — 여전히 기다린다
    await see.login("kim", "p@ss");
    await new Promise((r) => setTimeout(r, 1500));
    expect(app.screens.waiting(runId)).toBe(true);

    // 실행자(여기서는 관리자)가 화면에서 로그인 — 이어 간다
    await boss.login("kim", "p@ss");
    await app.runs.wait(runId);
    const row = (await call("GET", `/api/runs/${runId}`, undefined, admin)).body;
    expect(row.status, row.message).toBe("success");
    expect(row.result.output.name).toBeTruthy();
    expect(boss.msgs.filter((m) => m.t === "human").map((m) => m.prompt)).toEqual(["시험 사이트에 로그인해 주세요", null]);
    // ★넣은 비밀번호는 실행 기록 어디에도 없다
    expect(JSON.stringify(row)).not.toContain("p@ss");
    see.ws.close(); boss.ws.close();
  }, 60_000);

  it("진행(SSE)에 «human» — 기다림 · 끝", async () => {
    const { runId } = (await call("POST", "/api/flows/portal/runs", {}, admin)).body;
    await until(() => app.screens.waiting(runId), 20_000);
    const boss = screen(runId, admin);
    await boss.open;
    await until(() => boss.human()?.control === true);
    await boss.login("kim", "p@ss");
    await app.runs.wait(runId);
    const res = await fetch(`${app.url}/api/runs/${runId}/events`, { headers: { cookie: admin } });
    const text = await res.text();
    expect(text).toMatch(/event: human\ndata: .*"state":"waiting"/);
    expect(text).toMatch(/event: human\ndata: .*"state":"done"/);
    boss.ws.close();
  }, 60_000);
});
