/**
 * 알림 — 게시된 버전만 · 실패가 이어지면 처음만 · 회복 · Slack/Teams/웹훅 본문 · 주소는 시크릿 · 기록 · 시험 보내기 · 사이트가 바뀜 (2026-10-16).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseFlow, type ProbeReport } from "@flowsmith/core";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);

let app: App;
let dir: string;
/** 가로챈 알림들 */
let sent: { url: string; body: any }[] = [];
/** 다음 응답 상태들(비면 200) */
let replies: number[] = [];

const pos = { x: 0, y: 0 };
const SLACK = "https://hooks.slack.example/services/T000/B000/secret-token";
const flowOf = (id: string, notify: unknown[], withSecret = false) => ({
  schemaVersion: 1, id, name: `알림 시험 ${id}`,
  params: [{ name: "fail", label: "실패", required: false }],
  vars: { hook: "https://hooks.example/generic" },
  secrets: withSecret ? [{ name: "slack", kind: "text" }] : [],
  settings: { notify },
  nodes: [{ id: "c", type: "custom", name: "일하기", position: pos, config: { code: "if (ctx.params.fail === '1') throw new Error('일부러 실패'); return { done: 1 };", outputs: ["done"] } }],
  edges: [],
});
const runOnce = async (flowId: string, fail: boolean, version?: "draft") => {
  const { runId } = (await call("POST", `/api/flows/${flowId}/runs`, { params: { fail: fail ? "1" : "" }, ...(version ? { version } : {}) })).body;
  await app.runs.wait(runId);
  await app.notifier.drain();
  return runId as string;
};
const publish = async (id: string) => {
  const v = (await call("POST", `/api/flows/${id}/versions`, { note: "" })).body.version;
  await call("POST", `/api/flows/${id}/deploy`, { version: v });
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-notify-"));
  app = await startApp({
    dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker(), monitor: false, schedule: false, retention: false,
    publicUrl: "https://studio.example.com/",
    notifyFetch: (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("", { status: replies.shift() ?? 200 });
    }) as typeof fetch,
  });
  await call("POST", "/api/flows", { draft: flowOf("slackish", [{ id: "n1", on: ["failure", "recovered"], channel: "slack", url: "{{ $secrets.slack }}" }], true) });
  await call("PUT", "/api/flows/slackish/secrets/slack", { value: SLACK });
  await publish("slackish");
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => { sent = []; replies = []; });

describe("언제 알리나", () => {
  it("★초안 시험 실행은 알리지 않는다 — 게시된 버전만", async () => {
    await runOnce("slackish", true, "draft");
    expect(sent).toEqual([]);
  });

  it("★실패 → 알림 · 또 실패 → 처음만이라 조용 · 성공 → «다시 성공» · 또 성공 → 조용(성공은 안 고름)", async () => {
    const r1 = await runOnce("slackish", true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(SLACK);                                   // 시크릿으로 채운 주소
    const text: string = sent[0]!.body.text;
    expect(text).toMatch(/^\*❌ 알림 시험 slackish — 실패\*/);
    expect(text).toMatch(/멈춘 노드: 일하기 — .*일부러 실패/);
    expect(text).not.toContain("무엇:");                               // 노드 실패와 같은 말을 두 번 쓰지 않는다
    expect(text).toContain("손으로 실행 · 버전 1");
    expect(text).toContain(`<https://studio.example.com/#/flows/slackish/runs/${r1}|Flowsmith에서 열기>`);

    await runOnce("slackish", true);
    expect(sent).toHaveLength(1);
    await runOnce("slackish", false);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.text).toMatch(/✅ 알림 시험 slackish — 다시 성공\(회복\)/);
    await runOnce("slackish", false);
    expect(sent).toHaveLength(2);
  }, 30_000);

  it("★보낸 기록 — 됐나 · 무엇을. 주소(시크릿)는 남기지 않는다", async () => {
    const list = (await call("GET", "/api/flows/slackish/notices")).body;
    expect(list.map((n: any) => n.event)).toEqual(["recovered", "failure"]);
    expect(list.every((n: any) => n.ok && n.channel === "slack" && n.ruleId === "n1")).toBe(true);
    expect(JSON.stringify(list)).not.toContain("secret-token");
  });
});

describe("채널 · 실패 기록 · 시험", () => {
  it("★Teams는 Adaptive Card · 웹훅은 JSON(실행 정보) — 변수로 쓴 주소", async () => {
    await call("POST", "/api/flows", { draft: flowOf("multi", [
      { id: "t", on: ["failure"], channel: "teams", url: "https://teams.example/workflows/abc", firstOnly: false },
      { id: "w", on: ["success", "failure"], channel: "webhook", url: "{{ $vars.hook }}" },
    ]) });
    await publish("multi");
    const runId = await runOnce("multi", true);
    expect(sent.map((s) => s.url).sort()).toEqual(["https://hooks.example/generic", "https://teams.example/workflows/abc"]);
    const teams = sent.find((s) => s.url.includes("teams"))!.body;
    expect(teams.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(teams.attachments[0].content.body[0].text).toBe("❌ 알림 시험 multi — 실패");
    expect(teams.attachments[0].content.actions[0].url).toContain(`/runs/${runId}`);
    const hook = sent.find((s) => s.url.includes("generic"))!.body;
    expect(hook).toMatchObject({ event: "failure", flow: { id: "multi", version: 1 }, run: { id: runId, status: "failure", trigger: "manual", failedNode: "c" } });
  }, 30_000);

  it("★못 보내면(5xx) 한 번 더 해 보고, 그래도 안 되면 기록에 «못 보냄»과 까닭", async () => {
    replies = [500, 502];
    await runOnce("multi", false);                                      // 웹훅(success)만
    expect(sent).toHaveLength(2);                                       // 처음 + 다시 한 번
    const last = (await call("GET", "/api/flows/multi/notices")).body[0];
    expect(last).toMatchObject({ event: "success", ok: false, status: 502, error: "HTTP 502" });
  }, 30_000);

  it("★시험 보내기 — 저장 안 한 규칙도 · 시크릿 주소를 채운다 · 없는 시크릿이면 까닭을", async () => {
    const ok = await call("POST", "/api/flows/slackish/notify/test", { rule: { id: "new", channel: "slack", url: "{{ $secrets.slack }}" } });
    expect(ok.body).toEqual({ ok: true, status: 200, error: "" });
    expect(sent[0]!.body.text).toMatch(/🔔 알림 시험 slackish — 시험 알림/);
    const bad = await call("POST", "/api/flows/slackish/notify/test", { rule: { id: "x", channel: "slack", url: "{{ $secrets.nope }}" } });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error).toMatch(/시크릿/);
    expect((await call("POST", "/api/flows/slackish/notify/test", { rule: { channel: "fax", url: "x" } })).status).toBe(400);
  });
});

describe("고치는 길", () => {
  it("★요소를 못 찾아 멈춘 실패 — «고치려면: [다시 지정]» · 입력 탓이면 «입력값 확인»", async () => {
    const flow = app.store.getVersion("slackish", 1);
    const result = (problem: string) => ({
      runId: "x", flowId: "slackish", status: "failure", message: "'조회' 버튼: 요소를 찾지 못했습니다", output: {}, startedAt: new Date().toISOString(), ms: 10,
      nodes: [{ id: "c", name: "조회", type: "web", status: "failed", input: {}, output: null, branch: null, steps: [], logs: [], ms: 1,
        failure: { problem, message: "'조회' 버튼: 요소를 찾지 못했습니다", action: { index: 1, id: "a1", kind: "click" }, label: "'조회' 버튼", locator: null, url: null, candidates: [] } }],
    }) as any;
    for (const [problem, want] of [["missing", /고치려면: 링크를 눌러 실패 카드의 \[다시 지정\]/], ["refused", /고치려면: 사이트 문제가 아니라 입력값의 문제입니다/]] as const) {
      sent = [];
      app.notifier.runFinished({ flow, version: 1, runId: crypto.randomUUID(), parentRunId: null, trigger: "schedule", status: "failure", message: "'조회' 버튼: 요소를 찾지 못했습니다", result: result(problem), ms: 10 });
      await app.notifier.drain();
      expect(sent[0]!.body.text).toMatch(want);
    }
  });
});

describe("사이트가 바뀜 · 검문소", () => {
  it("★깨짐을 찾으면 알린다 — 이어지면 처음만 · 초안 점검은 알리지 않는다", async () => {
    await call("POST", "/api/flows", { draft: flowOf("drifty", [{ id: "d", on: ["drift"], channel: "webhook", url: "https://hooks.example/drift" }]) });
    await publish("drifty");
    const flow = app.store.getVersion("drifty", 1);
    const report: ProbeReport = {
      status: "broken", stop: { nodeId: null, actionId: null, reason: "끝까지" }, checked: 1, message: "",
      findings: [{ nodeId: "c", actionId: "a1", label: "'조회' 버튼", status: "missing", locator: { kind: "css", value: "#q" }, count: 0, differences: [], before: null, now: null, candidates: [] }],
    };
    const probe = (version: number | null) => {
      const id = crypto.randomUUID();
      app.store.insertProbe({ id, flowId: "drifty", version, source: "probe", status: "running", report: null });
      app.store.finishProbe(id, "broken", report);
      app.notifier.probeFinished({ flow, version, probeId: id, source: "probe", report });
    };
    probe(null);
    await app.notifier.drain();
    expect(sent).toEqual([]);
    probe(1);
    await app.notifier.drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ event: "drift", title: "⚠️ 알림 시험 drifty — 사이트가 바뀜", probe: { status: "broken" } });
    expect(sent[0]!.body.facts.map((f: any) => f.name)).toContain("'조회' 버튼");
    // ★고치는 길 — 링크는 변경 감시를 열고, 무엇을 하면 되는지 적는다
    expect(sent[0]!.body.link).toMatch(/\/#\/flows\/drifty\/monitor$/);
    expect(sent[0]!.body.facts.find((f: any) => f.name === "고치려면")?.value).toMatch(/\[다시 지정\]/);
    await new Promise((r) => setTimeout(r, 5));
    probe(1);
    await app.notifier.drain();
    expect(sent).toHaveLength(1);
  });

  it("알림 주소 — 변수 · 시크릿만 · http(s) · 언제가 비면 안 된다", () => {
    const bad = (notify: unknown[]) => () => parseFlow(flowOf("x", notify));
    expect(() => parseFlow(flowOf("x", [{ id: "a", on: ["failure"], channel: "slack", url: "{{ $secrets.slack }}" }], true))).not.toThrow();
    expect(bad([{ id: "a", on: ["failure"], channel: "slack", url: "{{ $params.fail }}" }])).toThrow(/변수\(\$vars\) · 시크릿\(\$secrets\)만/);
    expect(bad([{ id: "a", on: ["failure"], channel: "slack", url: "{{ $secrets.none }}" }])).toThrow(/시크릿 "none"가 정의되지 않았습니다/);
    expect(bad([{ id: "a", on: ["failure"], channel: "slack", url: "hooks.slack.com" }])).toThrow(/http:\/\/ 또는 https:\/\//);
    expect(bad([{ id: "a", on: [], channel: "slack", url: "https://x" }])).toThrow(/하나 이상/);
    expect(bad([{ id: "a", on: ["sometimes"], channel: "slack", url: "https://x" }])).toThrow(/모르는 때/);
    expect(parseFlow(flowOf("x", [{ id: "a", on: ["failure"], channel: "slack", url: "https://x" }])).settings.notify[0]).toMatchObject({ firstOnly: true, enabled: true });
  });
});
