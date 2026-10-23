/**
 * 메일 알림 · 엑셀 — 결과를 엑셀로 붙이기 · 받는 사람 검사 · 메일 서버가 없을 때 · 진짜 nodemailer로 SMTP까지 ·
 * 파일 쓰기 노드가 쓴 CSV를 엑셀로 받기 (2026-10-16).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseFlow } from "@flowsmith/core";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { SmtpMailer, type MailMessage } from "../src/run/mailer.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);

let app: App;
let dir: string;
let mails: MailMessage[] = [];
let failNext: { responseCode?: number; code?: string } | null = null;

const pos = { x: 0, y: 0 };
const flowOf = (id: string, notify: unknown[]) => ({
  schemaVersion: 1, id, name: `메일 시험 ${id}`,
  params: [{ name: "fail", label: "실패", required: false }],
  vars: { team: "team@example.com" },
  settings: { notify },
  nodes: [{ id: "c", type: "custom", name: "모으기", position: pos, config: { code: "if (ctx.params.fail === '1') throw new Error('일부러 실패'); return { rows: [{ 제목: '오늘 날씨', 조회: 12 }, { 제목: '내일 비', 조회: 3 }], count: 2 };", outputs: ["rows", "count"] } }],
  edges: [],
});
const runOnce = async (flowId: string, fail: boolean) => {
  const { runId } = (await call("POST", `/api/flows/${flowId}/runs`, { params: { fail: fail ? "1" : "" } })).body;
  await app.runs.wait(runId);
  await app.notifier.drain();
};
const publish = async (id: string) => {
  const v = (await call("POST", `/api/flows/${id}/versions`, { note: "" })).body.version;
  await call("POST", `/api/flows/${id}/deploy`, { version: v });
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flowsmith-mail-"));
  const filesDir = join(dir, "files");
  app = await startApp({
    dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker({ filesDir }), filesDir, monitor: false, schedule: false, retention: false,
    notifyFetch: (async () => new Response("", { status: 200 })) as typeof fetch,
    mailer: { from: "Flowsmith <robot@example.com>", send: async (m) => { if (failNext) { const e = Object.assign(new Error("거절"), failNext); failNext = null; throw e; } mails.push(m); } },
  });
  await call("POST", "/api/flows", { draft: flowOf("mailer", [{ id: "m", on: ["failure", "success"], channel: "email", url: "kim@example.com, {{ $vars.team }}", attach: true }]) });
  await publish("mailer");
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => { mails = []; failNext = null; });

describe("메일 알림", () => {
  it("★성공 — 받는 사람(변수 포함)에게 · 결과 목록을 엑셀로 붙여서 · 글자판과 HTML판", async () => {
    await runOnce("mailer", false);
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.to).toEqual(["kim@example.com", "team@example.com"]);
    expect(m.subject).toBe("✅ 메일 시험 mailer — 성공");
    expect(m.text).toContain("어떻게: 손으로 실행 · 버전 1");
    expect(m.html).toContain("<a href=\"http://127.0.0.1:");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0]!.filename).toMatch(/^메일 시험 mailer-결과-\d{8}-\d{4}\.xlsx$/);
    expect([...m.attachments![0]!.content.slice(0, 2)]).toEqual([0x50, 0x4b]);           // PK — ZIP
    expect(new TextDecoder().decode(m.attachments![0]!.content)).toContain("오늘 날씨");
  }, 30_000);

  it("실패에는 결과가 없다 — 붙이지 않는다 · 기록에 «보냄»", async () => {
    await runOnce("mailer", true);
    expect(mails[0]!.subject).toBe("❌ 메일 시험 mailer — 실패");
    expect(mails[0]!.attachments).toBeUndefined();
    expect((await call("GET", "/api/flows/mailer/notices")).body[0]).toMatchObject({ event: "failure", channel: "email", ok: true });
  }, 30_000);

  it("★메일 서버가 거절하면(5xx) 다시 하지 않고 까닭을 · 연결이 안 되면 한 번 더", async () => {
    failNext = { responseCode: 550 };
    await runOnce("mailer", false);
    expect(mails).toHaveLength(0);
    expect((await call("GET", "/api/flows/mailer/notices")).body[0]).toMatchObject({ ok: false, status: 550, error: expect.stringMatching(/메일 서버가 거절했습니다\(550\)/) });
    failNext = { code: "ECONNREFUSED" };
    await runOnce("mailer", false);
    expect(mails).toHaveLength(1);                                   // 두 번째에 됐다
  }, 30_000);

  it("시험 보내기 · 설정 — 이 서버는 메일을 보낼 수 있다", async () => {
    expect((await call("GET", "/api/notify/config")).body).toEqual({ email: true, from: "Flowsmith <robot@example.com>" });
    const r = await call("POST", "/api/flows/mailer/notify/test", { rule: { channel: "email", url: "lee@example.com" } });
    expect(r.body).toEqual({ ok: true, status: null, error: "" });
    expect(mails[0]!.subject).toBe("🔔 메일 시험 mailer — 시험 알림");
    const bad = await call("POST", "/api/flows/mailer/notify/test", { rule: { channel: "email", url: "누구, lee@" } });
    expect(bad.body.error).toMatch(/메일 주소를 읽을 수 없습니다 — 누구, lee@/);
  });

  it("검문소 — 받는 사람이 메일 주소가 아니면 들어오지 못한다(표현식은 실행 때 본다)", () => {
    expect(() => parseFlow(flowOf("x", [{ id: "m", on: ["failure"], channel: "email", url: "kim@example.com; 아무개" }]))).toThrow(/메일 주소를 읽을 수 없습니다 — 아무개/);
    expect(parseFlow(flowOf("x", [{ id: "m", on: ["failure"], channel: "email", url: "kim@example.com {{ $vars.team }}" }])).settings.notify[0]).toMatchObject({ attach: false });
  });
});

describe("진짜 nodemailer → SMTP", () => {
  let smtp: Server;
  let got = "";
  beforeAll(async () => {
    // 아주 작은 SMTP 서버 — 인사 · 받는 사람 · 본문만
    smtp = createServer((s) => {
      let data = false;
      s.write("220 test ESMTP\r\n");
      s.on("data", (chunk) => {
        for (const line of chunk.toString("utf8").split(/(?<=\r\n)/)) {
          if (data) { got += line; if (got.endsWith("\r\n.\r\n")) { data = false; s.write("250 ok\r\n"); } continue; }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === "EHLO" || cmd === "HELO") s.write("250-test\r\n250 8BITMIME\r\n");
          else if (cmd === "MAIL" || cmd === "RCPT") s.write("250 ok\r\n");
          else if (cmd === "DATA") { data = true; s.write("354 go\r\n"); }
          else if (cmd === "QUIT") { s.write("221 bye\r\n"); s.end(); }
        }
      });
    });
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  });
  afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

  it("★한글 제목 · 본문 · 엑셀 붙임이 SMTP로 간다", async () => {
    const port = (smtp.address() as AddressInfo).port;
    const m = new SmtpMailer(`smtp://127.0.0.1:${port}`, "Flowsmith <robot@example.com>");
    await m.send({ to: ["kim@example.com"], subject: "✅ 날씨 뉴스 — 성공", text: "오늘 2건", html: "<b>오늘 2건</b>", attachments: [{ filename: "결과.xlsx", content: new Uint8Array([0x50, 0x4b, 3, 4]), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] });
    expect(got).toMatch(/^From: Flowsmith <robot@example\.com>/m);
    expect(got).toMatch(/^To: kim@example\.com/m);
    expect(got).toMatch(/^Subject: =\?UTF-8\?/m);                   // 한글 제목은 인코딩돼서
    expect(got).toContain("spreadsheetml.sheet");
    expect(got).toMatch(/^Content-Disposition: attachment;/m);
  });

  it("주소가 틀리면 만들 때 알린다", () => {
    expect(() => new SmtpMailer("아무거나")).toThrow(/FLOWSMITH_SMTP_URL을 읽을 수 없습니다/);
    expect(() => new SmtpMailer("smtp://127.0.0.1:25")).toThrow(/FLOWSMITH_MAIL_FROM/);
  });
});

describe("파일을 엑셀로 받기", () => {
  it("★파일 쓰기 노드가 쓴 CSV · JSON Lines를 엑셀로 — 원본은 그대로 · 다른 파일은 400", async () => {
    const base = join(dir, "files", "shared");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "news-20261016.csv"), "﻿제목,조회\r\n\"오늘, 날씨\",12\r\n내일 비,3\r\n");
    writeFileSync(join(base, "log.jsonl"), '{"a":1}\n{"a":2,"b":"x"}\n');
    writeFileSync(join(base, "memo.txt"), "그냥 글자");
    const x = await call("GET", "/api/files/download?path=shared/news-20261016.csv&as=xlsx");
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(x.headers.get("content-disposition")).toContain(encodeURIComponent("news-20261016.xlsx"));
    const text = new TextDecoder().decode(x.bytes);
    expect(text).toContain("오늘, 날씨");
    expect(text).not.toContain("﻿");
    expect(new TextDecoder().decode((await call("GET", "/api/files/download?path=shared/log.jsonl&as=xlsx")).bytes)).toContain('<c r="B3" t="inlineStr">');
    expect((await call("GET", "/api/files/download?path=shared/memo.txt&as=xlsx")).status).toBe(400);
    expect((await call("GET", "/api/files/download?path=shared/news-20261016.csv")).headers.get("content-type")).toMatch(/text\/csv/);
  });
});
