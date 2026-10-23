/**
 * 파일 쓰기 노드 — 로컬 파일. 브라우저 없이(시각은 넣어 준다).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFlow, parseFlow, type FileStoreTarget, type Scope, type FileWriteNode } from "@flowsmith/core";
import { parseCsv, runFileWriteNode } from "../src/index.ts";

let root: string;
/** 이 플로우의 폴더 이름(서버가 붙인 uuid) */
const UID = "6f1c2a8e-0000-4000-8000-000000000001";
const U = UID + "/";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "flowsmith-store-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const at = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi, 0);
const D15 = at(2026, 10, 15);
const D15b = at(2026, 10, 15, 18);
const D16 = at(2026, 10, 16, 0, 1);

const target = (patch: Partial<FileStoreTarget> = {}): FileStoreTarget => ({
  kind: "file", scope: "flow", dir: "news", name: "output", format: "csv", mode: "append", rolling: { kind: "time", unit: "day" },
  csv: { header: true, bom: true, columns: null }, dedupeKey: null, stampColumn: null, keepDays: null, ...patch,
});
const node = (t: FileStoreTarget, data = "{{ $input.news }}"): FileWriteNode => ({ id: "s", name: "저장", type: "fileWrite", position: { x: 0, y: 0 }, config: { data, target: t } });
const scope = (input: Record<string, unknown>): Scope => ({ input, nodes: {}, params: {}, vars: {}, secrets: {} });
const logs: string[] = [];
const run = (t: FileStoreTarget, input: Record<string, unknown>, now: Date, data?: string) =>
  runFileWriteNode(node(t, data), scope(input), { root, flowUid: UID }, (s) => logs.push(s), now);
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const ls = (dir = U + "news") => readdirSync(join(root, dir)).sort();

const A = [{ 제목: "첫 소식", 링크: "https://a/1" }, { 제목: "둘째, \"따옴표\"", 링크: "https://a/2" }];
const B = [{ 제목: "셋째", 링크: "https://a/3" }];

describe("롤링 · 이어 붙이기", () => {
  it("★날마다 — 15일 두 번은 같은 파일에 이어 붙이고(머리줄 한 번), 16일이 되면 새 파일", async () => {
    expect(await run(target(), { news: A }, D15)).toEqual({ file: U + "news/output-20261015.csv", written: 2, skipped: 0 });
    expect(await run(target(), { news: B }, D15b)).toEqual({ file: U + "news/output-20261015.csv", written: 1, skipped: 0 });
    expect(await run(target(), { news: B }, D16)).toMatchObject({ file: U + "news/output-20261016.csv", written: 1 });
    expect(ls()).toEqual(["output-20261015.csv", "output-20261016.csv"]);
    const rows = parseCsv(read(U + "news/output-20261015.csv"));
    expect(rows).toEqual([["제목", "링크"], ["첫 소식", "https://a/1"], ["둘째, \"따옴표\"", "https://a/2"], ["셋째", "https://a/3"]]);
    expect(read(U + "news/output-20261015.csv").startsWith("﻿제목,링크\r\n")).toBe(true);   // 엑셀 한글 — BOM은 맨 앞 한 번
    expect(read(U + "news/output-20261015.csv").match(/﻿/g)).toHaveLength(1);
  });

  it("시간 · 달 · 없음 — 파일 이름", async () => {
    expect((await run(target({ rolling: { kind: "time", unit: "hour" } }), { news: A }, D15b)).file).toBe(U + "news/output-20261015-18.csv");
    expect((await run(target({ rolling: { kind: "time", unit: "month" } }), { news: A }, D16)).file).toBe(U + "news/output-202610.csv");
    expect((await run(target({ rolling: { kind: "none" }, format: "jsonl" }), { news: A }, D16)).file).toBe(U + "news/output.jsonl");
  });

  it("★덮어쓰기 — 같은 날 두 번이면 두 번째 것만 남는다", async () => {
    const t = target({ mode: "overwrite" });
    await run(t, { news: A }, D15);
    await run(t, { news: B }, D15b);
    expect(parseCsv(read(U + "news/output-20261015.csv"))).toEqual([["제목", "링크"], ["셋째", "https://a/3"]]);
  });

  it("★번호 — 실행마다 새 번호", async () => {
    const t = target({ rolling: { kind: "sequence", every: "run", limit: null } });
    expect((await run(t, { news: A }, D15)).file).toBe(U + "news/output-0001.csv");
    expect((await run(t, { news: A }, D15)).file).toBe(U + "news/output-0002.csv");
    expect((await run(t, { news: A }, D16)).file).toBe(U + "news/output-0003.csv");
  });

  it("번호 — 행이 차면 다음 번호(묶음은 나누지 않는다) · 크기가 차면 다음 번호", async () => {
    const rows = target({ rolling: { kind: "sequence", every: "rows", limit: 3 } });
    expect((await run(rows, { news: A }, D15)).file).toBe(U + "news/output-0001.csv");   // 2행
    expect((await run(rows, { news: B }, D15)).file).toBe(U + "news/output-0001.csv");   // 3행 — 아직 넘지 않음
    expect((await run(rows, { news: B }, D15)).file).toBe(U + "news/output-0002.csv");   // 넘으므로 다음
    const bytes = target({ name: "big", format: "jsonl", rolling: { kind: "sequence", every: "bytes", limit: 50 } });
    expect((await run(bytes, { news: A }, D15)).file).toBe(U + "news/big-0001.jsonl");
    expect((await run(bytes, { news: A }, D15)).file).toBe(U + "news/big-0002.jsonl");   // 앞 파일이 50바이트를 넘었다
  });
});

describe("형식", () => {
  it("CSV — 이어 붙일 때 있는 파일의 머리줄을 따르고, 없는 열의 값은 쓰지 않는다고 알린다", async () => {
    await run(target(), { news: A }, D15);
    logs.length = 0;
    await run(target(), { news: [{ 링크: "https://a/9", 제목: "순서 바뀜", 언론사: "KBS" }] }, D15b);
    expect(parseCsv(read(U + "news/output-20261015.csv")).at(-1)).toEqual(["순서 바뀜", "https://a/9"]);
    expect(logs.join("\n")).toMatch(/열에 없는 값은 쓰지 않았습니다 — 언론사/);
  });

  it("CSV — 열 순서를 정할 수 있고, 줄바꿈 · 쉼표 · 객체도 깨지지 않는다", async () => {
    const t = target({ csv: { header: true, bom: false, columns: ["링크", "제목"] } });
    await run(t, { news: [{ 제목: "두 줄\n제목", 링크: "x", 태그: ["a", "b"] }] }, D15);
    expect(parseCsv(read(U + "news/output-20261015.csv"))).toEqual([["링크", "제목"], ["x", "두 줄\n제목"]]);
  });

  it("JSON Lines · JSON 배열 · 텍스트", async () => {
    await run(target({ format: "jsonl" }), { news: A }, D15);
    await run(target({ format: "jsonl" }), { news: B }, D15);
    expect(read(U + "news/output-20261015.jsonl").trim().split("\n").map((l) => JSON.parse(l))).toEqual([...A, ...B]);

    await run(target({ format: "json" }), { news: A }, D15);
    await run(target({ format: "json" }), { news: B }, D15);
    expect(JSON.parse(read(U + "news/output-20261015.json"))).toEqual([...A, ...B]);

    await run(target({ format: "text" }), { news: A }, D15);
    await run(target({ format: "text" }), { title: "글자 하나" }, D15, "{{ $input.title }}");
    expect(read(U + "news/output-20261015.txt")).toBe("첫 소식\thttps://a/1\n둘째, \"따옴표\"\thttps://a/2\n글자 하나\n");
  });

  it("값 하나(객체)는 한 줄 · 빈 목록이면 파일을 만들지 않는다", async () => {
    expect((await run(target(), { one: { 제목: "하나" } }, D15, "{{ $input.one }}")).written).toBe(1);
    expect(await run(target({ name: "empty" }), { news: [] }, D15)).toEqual({ file: U + "news/empty-20261015.csv", written: 0, skipped: 0 });
    expect(ls()).toEqual(["output-20261015.csv"]);
  });
});

describe("더 하기", () => {
  it("★이미 저장한 것은 건너뛴다 — 같은 날 다시 모아도 겹치지 않는다(묶음 안의 겹침도)", async () => {
    const t = target({ dedupeKey: "링크" });
    expect(await run(t, { news: A }, D15)).toMatchObject({ written: 2, skipped: 0 });
    expect(await run(t, { news: [...A, ...B, B[0]] }, D15b)).toMatchObject({ written: 1, skipped: 3 });
    expect(parseCsv(read(U + "news/output-20261015.csv")).length).toBe(4);
    expect(await run(t, { news: A }, D15b)).toMatchObject({ written: 0, skipped: 2 });
    // 날이 바뀌면 새 파일 — 거기에는 없으므로 다시 쓴다
    expect(await run(t, { news: A }, D16)).toMatchObject({ written: 2 });
    const j = target({ format: "jsonl", dedupeKey: "링크" });
    await run(j, { news: A }, D15);
    expect(await run(j, { news: [...A, ...B] }, D15)).toMatchObject({ written: 1, skipped: 2 });
  });

  it("수집 시각을 칸으로 붙인다", async () => {
    await run(target({ stampColumn: "수집시각" }), { news: B }, at(2026, 10, 15, 18, 30));
    expect(parseCsv(read(U + "news/output-20261015.csv"))).toEqual([["제목", "링크", "수집시각"], ["셋째", "https://a/3", "2026-10-15 18:30:00"]]);
  });

  it("CSV가 아닌 파일 끝에 줄바꿈이 없어도 이어 붙인 줄이 붙지 않는다", async () => {
    await run(target({ dir: "", name: "x", format: "jsonl", rolling: { kind: "none" } }), { news: A }, D15);
    writeFileSync(join(root, U + "x.jsonl"), read(U + "x.jsonl").trimEnd());
    await run(target({ dir: "", name: "x", format: "jsonl", rolling: { kind: "none" } }), { news: B }, D15);
    expect(read(U + "x.jsonl").trim().split("\n")).toHaveLength(3);
  });
});

describe("오래된 파일 지우기", () => {
  it("★n일 지난 이 노드의 파일만 지운다 — 지금 쓴 파일 · 다른 이름의 파일은 둔다", async () => {
    const { utimesSync } = await import("node:fs");
    const t = target({ keepDays: 7 });
    await run(t, { news: A }, at(2026, 10, 1));
    await run(t, { news: A }, at(2026, 10, 10));
    writeFileSync(join(root, U + "news", "other-20261001.csv"), "x\n");
    const old = new Date(2026, 9, 1), mid = new Date(2026, 9, 10);
    utimesSync(join(root, U + "news/output-20261001.csv"), old, old);
    utimesSync(join(root, U + "news/output-20261010.csv"), mid, mid);
    utimesSync(join(root, U + "news/other-20261001.csv"), old, old);
    logs.length = 0;
    await run(t, { news: B }, D15);   // 15일 — 1일 파일은 7일이 지났고 10일 파일은 아직
    expect(ls()).toEqual(["other-20261001.csv", "output-20261010.csv", "output-20261015.csv"]);
    expect(logs.join("\n")).toMatch(/7일 지난 파일 1개를 지웠습니다 — output-20261001\.csv/);
  });
});

describe("폴더 — 워크플로우마다 따로 · 공유", () => {
  it("★같은 하위 폴더 · 이름이라도 워크플로우(uuid)가 다르면 다른 파일이다", async () => {
    const other = "6f1c2a8e-0000-4000-8000-000000000002";
    const a = await runFileWriteNode(node(target()), scope({ news: A }), { root, flowUid: UID }, () => undefined, D15);
    const b = await runFileWriteNode(node(target()), scope({ news: B }), { root, flowUid: other }, () => undefined, D15);
    expect(a.file).toBe(`${UID}/news/output-20261015.csv`);
    expect(b.file).toBe(`${other}/news/output-20261015.csv`);
    expect(parseCsv(read(a.file as string))).toHaveLength(3);
    expect(parseCsv(read(b.file as string))).toHaveLength(2);
  });

  it("★공유 폴더는 워크플로우가 달라도 같은 파일에 모은다", async () => {
    const t = target({ scope: "shared", dir: "", name: "all" });
    await runFileWriteNode(node(t), scope({ news: A }), { root, flowUid: UID }, () => undefined, D15);
    const b = await runFileWriteNode(node(t), scope({ news: B }), { root, flowUid: "6f1c2a8e-0000-4000-8000-000000000002" }, () => undefined, D15);
    expect(b.file).toBe("shared/all-20261015.csv");
    expect(parseCsv(read("shared/all-20261015.csv"))).toHaveLength(4);
  });

  it("이 워크플로우 폴더인데 uuid를 모르면 쓰지 않는다", async () => {
    await expect(runFileWriteNode(node(target()), scope({ news: A }), { root }, () => undefined, D15)).rejects.toThrow(/uuid/);
    await expect(runFileWriteNode(node(target()), scope({ news: A }), { root, flowUid: "../x" }, () => undefined, D15)).rejects.toThrow(/uuid/);
    await expect(runFileWriteNode(node(target()), scope({ news: A }), { root, flowUid: "shared" }, () => undefined, D15)).rejects.toThrow(/uuid/);
  });
});

describe("안전", () => {
  it("★파일 뿌리 밖으로 못 나간다 — 검문소가 막고, 실행도 한 번 더 막는다", async () => {
    const flow = (t: Partial<FileStoreTarget>) => ({
      schemaVersion: 1, id: "f", name: "f",
      nodes: [{ id: "s", type: "fileWrite", name: "저장", position: { x: 0, y: 0 }, config: { data: "x", target: { ...target(), ...t } } }], edges: [],
    });
    expect(checkFlow(flow({ dir: "../etc" })).join()).toMatch(/「\.\.」/);
    expect(checkFlow(flow({ dir: "/etc" })).join()).toMatch(/절대 경로/);
    expect(checkFlow(flow({ name: "a/b" })).join()).toMatch(/쓸 수 없습니다/);
    expect(checkFlow(flow({ rolling: { kind: "sequence", every: "rows", limit: null } })).join()).toMatch(/몇 행마다/);
    expect(checkFlow(flow({}))).toEqual([]);
    await expect(run(target({ dir: "../out" }), { news: A }, D15)).rejects.toThrow(/「\.\.」/);
    await expect(runFileWriteNode(node(target()), scope({ news: A }), undefined, () => undefined, D15)).rejects.toThrow(/저장할 곳/);
    await expect(run(target(), {}, D15, "{{ $input.none }}")).rejects.toThrow(/저장할 값이 없습니다/);
  });

  it("검문소 — 기본값이 채워지고 파일 쓰기 노드의 출력(file · written · skipped)을 뒤 노드가 쓸 수 있다", () => {
    const f = parseFlow({
      schemaVersion: 1, id: "f", name: "f",
      nodes: [
        { id: "s", type: "fileWrite", name: "저장", position: { x: 0, y: 0 }, config: { data: "x", target: { kind: "file", dir: "", name: "out" } } },
        { id: "c", type: "condition", name: "조건", position: { x: 0, y: 0 }, config: { cases: [{ id: "y", rules: [{ left: "{{ $input.written }}", op: "gt", right: "0" }], then: { kind: "end", status: "success", message: "" } }], else: { then: { kind: "end", status: "success", message: "" } } } },
      ],
      edges: [{ id: "e", from: { node: "s", port: "out" }, to: { node: "c" } }],
    });
    expect((f.nodes[0] as FileWriteNode).config.target).toEqual({
      kind: "file", scope: "flow", dir: "", name: "out", format: "csv", mode: "append", rolling: { kind: "none" },
      csv: { header: true, bom: true, columns: null }, dedupeKey: null, stampColumn: null, keepDays: null,
    });
  });
});
