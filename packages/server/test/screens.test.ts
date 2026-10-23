/**
 * 실행 화면 보기 — 보는 사람이 있을 때만 화면을 보내고, 페이지가 바뀌면 따라가고, 끝나면 알린다.
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
import { until } from "./helpers.ts";

let site: TestSite;
let app: App;
let dir: string;

// ★페이지마다 3초 — 바쁜 PC(전체 시험)에서 브라우저가 늦게 떠도 보는 사람이 붙기 전에 지나가 버리지 않게(1.5초일 때 흔들렸다)
const flow = () => ({
  schemaVersion: 1, id: "slow", name: "천천히",
  nodes: [{ id: "w", type: "web", name: "둘러보기", position: { x: 0, y: 0 }, config: {
    start: { kind: "url", url: `${site.url}/login` },
    actions: [
      { id: "a1", kind: "wait", wait: { kind: "fixed", ms: 3000 } },
      { id: "a2", kind: "goto", url: `${site.url}/news` },
      { id: "a3", kind: "wait", wait: { kind: "fixed", ms: 3000 } },
    ],
  } }],
  edges: [],
});

function watch(runId: string, origin?: string) {
  const ws = new WebSocket(`${app.url.replace("http", "ws")}/api/runs/${runId}/screen`, origin ? { origin } : {});
  const msgs: any[] = [];
  let frames = 0;
  ws.on("message", (d, binary) => { if (binary) frames++; else msgs.push(JSON.parse(String(d))); });
  const closed = new Promise<void>((r) => ws.on("close", () => r()));
  return { ws, msgs, frames: () => frames, closed };
}

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-screen-"));
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false });
  await fetch(`${app.url}/api/flows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: flow() }) });
});
afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("실행 화면 보기", () => {
  it("★보는 사람이 있을 때만 화면을 보내고 · 페이지를 따라가고 · 끝나면 알린다", async () => {
    const { runId } = await (await fetch(`${app.url}/api/flows/slow/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "draft" }) })).json() as { runId: string };
    await new Promise((r) => setTimeout(r, 600));
    expect(app.screens.stats(runId)).toEqual({ viewers: 0, casting: false });   // ★아무도 안 보면 보내지 않는다

    const v = watch(runId);
    const seen = () => `받은 것: ${JSON.stringify(v.msgs)} · 화면 ${v.frames()}장 · 도는 중 ${app.runs.isRunning("slow")}`;
    await until(() => v.frames() > 0, 20_000, `화면이 오지 않았습니다 — ${seen()}`);
    expect(app.screens.stats(runId)).toEqual({ viewers: 1, casting: true });
    // 막 붙으면 첫 화면이 about:blank일 수 있다(탭을 연 직후) — 로그인 화면이 올 때까지
    await until(() => v.msgs.some((m) => m.t === "page" && m.url.includes("/login")), 20_000, `로그인 화면이 오지 않았습니다 — ${seen()}`);
    await until(() => v.msgs.some((m) => m.t === "page" && m.url.includes("/news")), 20_000, `이동을 따라가지 않았습니다 — ${seen()}`);   // 이동을 따라간다

    v.ws.close();
    await v.closed;
    await until(() => app.screens.stats(runId)?.casting === false);   // ★다 떠나면 멈춘다

    const again = watch(runId);
    await app.runs.wait(runId);
    await again.closed;
    expect(again.msgs.at(-1)).toMatchObject({ t: "end", status: "success" });
  }, 60_000);

  it("끝난 실행 · 모르는 실행 · 다른 출처", async () => {
    const unknown = watch("nope");
    await unknown.closed;
    expect(unknown.msgs).toEqual([{ t: "end", status: "unknown", message: expect.stringMatching(/돌고 있는 실행이 아닙니다/) }]);

    const other = new WebSocket(`${app.url.replace("http", "ws")}/api/runs/nope/screen`, { origin: "https://evil.example" });
    const code = await new Promise<number>((r) => { other.on("unexpected-response", (_q, res) => r(res.statusCode ?? 0)); other.on("error", () => r(-1)); });
    expect(code).toBe(403);
  });
});
