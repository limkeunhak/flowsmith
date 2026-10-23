/**
 * 모으고 저장하기 — 웹페이지 노드(되풀이 목록 읽기) → 파일 쓰기 노드(CSV · 날마다 · 겹치면 건너뛰기) → 화면의 파일 API.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import { startApp, type App } from "../src/app.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";
import { InProcessWorker } from "../src/run/worker.ts";
import { caller } from "./helpers.ts";

const call = caller(() => app.url);

let site: TestSite;
let app: App;
let dir: string;


const css = (label: string, value: string) => ({ label, locators: [{ kind: "css", value }], fingerprint: null, frames: [], verifiedAt: null });
const flow = () => ({
  schemaVersion: 1, id: "news", name: "날씨 뉴스 모으기",
  nodes: [
    { id: "scrape", type: "web", name: "뉴스 읽기", position: { x: 0, y: 0 }, config: {
      start: { kind: "url", url: `${site.url}/news` },
      actions: [{ id: "a1", kind: "readTable", output: "news", table: {
        label: "목록", rows: css("목록 행", "#main_pack > div > div.list_news > div.sds-comps-vertical-layout"), maxRows: 100,
        columns: [
          { name: "제목", selector: ":scope > div.sds-comps-base-layout > div > a:nth-of-type(1)", strategy: "auto" },
          { name: "링크", selector: ":scope > div.sds-comps-base-layout > div > a:nth-of-type(1)", strategy: "link" },
        ],
      } }],
    } },
    { id: "save", type: "fileWrite", name: "저장", position: { x: 300, y: 0 }, config: {
      data: "{{ $input.news }}",
      target: { kind: "file", dir: "news", name: "weather", format: "csv", mode: "append", rolling: { kind: "time", unit: "day" }, dedupeKey: "링크", stampColumn: "수집시각" },
    } },
  ],
  edges: [{ id: "e1", from: { node: "scrape", port: "out" }, to: { node: "save" } }],
});

beforeAll(async () => {
  site = await startTestSite(0);
  dir = mkdtempSync(join(tmpdir(), "flowsmith-files-"));
  const filesDir = join(dir, "files");
  app = await startApp({ dbPath: join(dir, "t.db"), box: new SecretBox(generateKey()), worker: new InProcessWorker({ filesDir }), filesDir, monitor: false, schedule: false });
  await call("POST", "/api/flows", { draft: flow() });
});
afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(dir, { recursive: true, force: true });
});

const runDraft = async () => {
  const { runId } = (await call("POST", "/api/flows/news/runs", { version: "draft" })).body;
  await app.runs.wait(runId);
  return (await call("GET", `/api/runs/${runId}`)).body;
};

describe("모으고 저장하기", () => {
  it("★목록을 읽어 오늘 날짜 파일에 쓰고 — 다시 돌면 이미 있는 것은 건너뛴다", async () => {
    const first = await runDraft();
    expect(first.status, first.message).toBe("success");
    const save = first.result.nodes.find((n: any) => n.id === "save");
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    // ★이 플로우의 폴더 — 서버가 붙인 uuid
    const uid = (await call("GET", "/api/flows/news")).body.uid;
    expect(uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(save.output).toEqual({ file: `${uid}/news/weather-${ymd}.csv`, written: 3, skipped: 0 });
    expect(save.logs.join("\n")).toMatch(/새로 썼습니다/);

    const again = await runDraft();
    expect(again.result.nodes.find((n: any) => n.id === "save").output).toMatchObject({ written: 0, skipped: 3 });
  }, 60_000);

  it("화면 — 파일 목록 · 미리 보기 · 내려받기 · 지우기", async () => {
    const uid = (await call("GET", "/api/flows/news")).body.uid;
    // 화면은 uuid를 몰라도 된다 — 플로우 id와 폴더 종류로 묻는다
    const list = (await call("GET", "/api/files?flow=news&scope=flow&dir=news")).body;
    expect(list.dir).toBe(`${uid}/news`);
    expect(list.entries).toHaveLength(1);
    const f = list.entries[0];
    expect(f).toMatchObject({ kind: "file", path: expect.stringMatching(new RegExp(`^${uid}/news/weather-\\d{8}\\.csv$`)) });
    expect((await call("GET", "/api/files")).body.entries.map((e: any) => [e.name, e.kind])).toEqual([[uid, "dir"]]);
    expect((await call("GET", "/api/files?flow=news&scope=shared")).body).toMatchObject({ dir: "shared", entries: [] });

    const pv = (await call("GET", `/api/files/preview?path=${encodeURIComponent(f.path)}`)).body;
    expect(pv.text.split("\r\n")[0]).toBe("제목,링크,수집시각");
    expect(pv.text).toContain(`"[뉴스9 날씨] 내일, 다시 기온 올라…큰 일교차 주의",${site.url}/n/1,`);   // 쉼표가 든 제목은 따옴표로
    expect(pv.text).not.toContain("새 창 열림");

    const dl = await call("GET", `/api/files/download?path=${encodeURIComponent(f.path)}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''weather-\d{8}\.csv$/);
    expect(dl.headers.get("content-type")).toMatch(/text\/csv/);

    expect((await call("DELETE", `/api/files?path=${encodeURIComponent(f.path)}`)).status).toBe(204);
    expect((await call("GET", "/api/files?flow=news&scope=flow&dir=news")).body.entries).toEqual([]);
  }, 30_000);

  it("★JSON을 복사해 만든 워크플로우는 새 uuid — 같은 설정이어도 원래 워크플로우의 파일에 섞이지 않는다", async () => {
    const copy = { ...flow(), id: "news-copy", name: "복사본", uid: "가짜-uid" };   // JSON에 uid가 있어도 무시한다
    const made = (await call("POST", "/api/flows", { draft: copy })).body;
    const orig = (await call("GET", "/api/flows/news")).body;
    expect(made.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(made.uid).not.toBe(orig.uid);
    const { runId } = (await call("POST", "/api/flows/news-copy/runs", { version: "draft" })).body;
    await app.runs.wait(runId);
    const out = (await call("GET", `/api/runs/${runId}`)).body.result.nodes.find((n: any) => n.id === "save").output;
    expect(out.file.startsWith(`${made.uid}/news/`)).toBe(true);
    expect(out).toMatchObject({ written: 3, skipped: 0 });   // 원래 플로우가 모은 것과 겹친다고 보지 않는다
  }, 60_000);

  it("★파일 뿌리 밖은 못 본다", async () => {
    for (const p of ["../t.db", "/etc/passwd", "news/../../t.db", ".hidden"]) {
      expect((await call("GET", `/api/files/preview?path=${encodeURIComponent(p)}`)).status, p).toBe(400);
      expect((await call("GET", `/api/files/download?path=${encodeURIComponent(p)}`)).status, p).toBe(400);
    }
    expect((await call("GET", "/api/files?dir=..")).status).toBe(400);
    expect((await call("GET", "/api/files/preview?path=news/none.csv")).status).toBe(404);
  });
});
