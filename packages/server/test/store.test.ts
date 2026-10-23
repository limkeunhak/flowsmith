import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Store, StoreError } from "../src/storage/store.ts";
import { Secrets } from "../src/storage/secrets.ts";
import { generateKey, SecretBox } from "../src/storage/secret-box.ts";

const example = (): any => JSON.parse(readFileSync(fileURLToPath(new URL("../../../examples/login-and-read.json", import.meta.url)), "utf8"));
const err = (fn: () => unknown): StoreError => { try { fn(); } catch (e) { if (e instanceof StoreError) return e; throw e; } throw new Error("던지지 않았다"); };

describe("저장소", () => {
  it("초안 → 버전 → 배포", () => {
    const s = new Store(":memory:");
    s.createFlow(example());
    expect(s.getFlow("login-and-read")).toMatchObject({ name: "로그인하고 주문 상태 읽기", problems: [], activeVersion: null, versions: [], draftChanged: true });
    expect(s.createVersion("login-and-read", "처음")).toBe(1);
    expect(s.getFlow("login-and-read").draftChanged).toBe(false);
    s.deploy("login-and-read", 1);
    expect(s.listFlows()).toEqual([expect.objectContaining({ id: "login-and-read", activeVersion: 1, latestVersion: 1, problems: 0 })]);
    expect(s.getVersion("login-and-read", 1).nodes).toHaveLength(4);
  });

  it("★틀린 초안도 저장은 되지만 버전은 못 만든다 — 문제를 같이 돌려준다", () => {
    const s = new Store(":memory:");
    s.createFlow(example());
    const j = example();
    j.edges.push({ id: "loop", from: { node: "shape", port: "out" }, to: { node: "login" } });
    expect(s.saveDraft("login-and-read", j).problems[0]).toMatch(/순환/);
    const e = err(() => s.createVersion("login-and-read", ""));
    expect(e.status).toBe(422);
    expect(e.problems[0]).toMatch(/순환/);
  });

  it("바뀐 것이 없으면 버전을 만들지 않는다 — 키 순서만 달라도 같은 것이다", () => {
    const s = new Store(":memory:");
    s.createFlow(example());
    s.createVersion("login-and-read", "");
    const reordered = Object.fromEntries(Object.entries(example()).reverse());
    s.saveDraft("login-and-read", reordered);
    expect(err(() => s.createVersion("login-and-read", "")).message).toMatch(/바뀐 것이 없습니다/);
  });

  it("id는 바꿀 수 없고, 같은 id로 두 번 만들 수 없다", () => {
    const s = new Store(":memory:");
    s.createFlow(example());
    expect(err(() => s.createFlow(example())).status).toBe(409);
    expect(err(() => s.saveDraft("login-and-read", { ...example(), id: "other" })).message).toMatch(/id는 바꿀 수 없습니다/);
    expect(err(() => s.createFlow({ ...example(), id: "1bad" })).status).toBe(400);
  });

  it("없는 버전은 배포할 수 없다", () => {
    const s = new Store(":memory:");
    s.createFlow(example());
    expect(err(() => s.deploy("login-and-read", 3)).status).toBe(404);
  });

  it("다시 뜰 때 돌던 실행은 실패로 적는다", () => {
    const s = new Store(":memory:");
    s.createFlow(example());
    s.insertRun({ id: "r1", flowId: "login-and-read", version: null, trigger: "manual", params: {} });
    expect(s.markInterrupted()).toBe(1);
    expect(s.getRun("r1")).toMatchObject({ status: "failure", message: expect.stringMatching(/다시 시작/) });
  });
});

describe("시크릿", () => {
  const setup = () => {
    const store = new Store(":memory:");
    store.createFlow(example());
    return { store, secrets: new Secrets(store, new SecretBox(generateKey())), draft: example() };
  };

  it("넣으면 목록에는 «있다»만 나온다", () => {
    const { secrets, draft } = setup();
    expect(secrets.list("login-and-read", draft)).toEqual([{ name: "shop", kind: "login", description: "시험 사이트 계정", stored: false, updatedAt: null, orphan: false, shared: false, sharedScope: null }]);
    secrets.put("login-and-read", draft, "shop", { username: "kim", password: "p@ss" });
    const [s] = secrets.list("login-and-read", draft);
    expect(s).toMatchObject({ name: "shop", stored: true });
    expect(JSON.stringify(s)).not.toContain("p@ss");
  });

  it("정의되지 않은 이름 · 종류에 안 맞는 값은 거부한다", () => {
    const { secrets, draft } = setup();
    expect(err(() => secrets.put("login-and-read", draft, "bank", "x")).message).toMatch(/정의되어 있지 않습니다/);
    expect(err(() => secrets.put("login-and-read", draft, "shop", "그냥 글자")).message).toMatch(/객체여야/);
    expect(err(() => secrets.put("login-and-read", draft, "shop", { username: "kim" })).message).toMatch(/password가 비었습니다/);
    expect(err(() => secrets.put("login-and-read", draft, "shop", { username: "kim", password: "x", pin: "1" })).message).toMatch(/모르는 칸/);
  });

  it("초안에서 정의를 지우면 저장된 값은 «orphan»으로 보인다", () => {
    const { secrets, draft } = setup();
    secrets.put("login-and-read", draft, "shop", { username: "kim", password: "p@ss" });
    expect(secrets.list("login-and-read", { ...draft, secrets: [] })).toEqual([expect.objectContaining({ name: "shop", orphan: true, kind: null })]);
  });

  it("실행할 때 푼다 — 정의된 것만", () => {
    const { secrets, draft } = setup();
    secrets.put("login-and-read", draft, "shop", { username: "kim", password: "p@ss" });
    expect(secrets.unlockFor("login-and-read", [{ name: "shop", kind: "login", description: "", shared: false }])).toEqual({ shop: { username: "kim", password: "p@ss" } });
    expect(secrets.unlockFor("login-and-read", [])).toEqual({});
  });
});

describe("워크플로우 uuid", () => {
  it("★옛 DB(uid 칸 없음)를 열면 칸을 더하고 워크플로우마다 uuid를 채운다 — 다시 열어도 바뀌지 않는다", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "flowsmith-mig-"));
    try {
      const path = join(dir, "old.db");
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE flow (id TEXT PRIMARY KEY, name TEXT NOT NULL, draft_json TEXT NOT NULL, active_version INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      for (const id of ["a", "b"]) old.prepare("INSERT INTO flow VALUES (?, ?, ?, NULL, 'x', 'x')").run(id, id, JSON.stringify({ id, name: id }));
      old.close();
      const s = new Store(path);
      const [a, b] = [s.getFlow("a").uid, s.getFlow("b").uid];
      expect(a).toMatch(/^[0-9a-f-]{36}$/);
      expect(b).not.toBe(a);
      s.close();
      const again = new Store(path);
      expect(again.getFlow("a").uid).toBe(a);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
