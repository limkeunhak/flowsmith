/**
 * 틀린 값이 성공처럼 보이는 자리(2026-10-27, NexusFlow 실측에서 가져옴):
 * 값이 두 번 바뀌는 칸 · 같은 화면에서 다시 조회 · 꺼진 단추 · 고른 뒤 되돌아가는 보기 · 늦게 지워지는 칸 · 빈 표 · 보이는 행만 그리는 표.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseFlow } from "@flowsmith/core";
import { runFlow } from "../src/index.ts";
import { overlap } from "../src/browser/primitives.ts";

const PAGES: Record<string, string> = {
  // 조회를 누르면 금액이 중간값을 거쳐 0.6초 뒤에 최종값이 된다
  "/twice": `<button id="go" onclick="const p=document.getElementById('amt');p.textContent='3억원';setTimeout(()=>p.textContent='1억원',600)">조회</button><p id="amt"></p>`,
  // 앞 결과(A)가 남아 있고, 다시 조회하면 0.5초 뒤에 B가 된다. 「그대로」는 눌러도 바뀌지 않는다
  "/again": `<button id="go" onclick="setTimeout(()=>document.getElementById('res').textContent='B',500)">조회</button><button id="same">그대로</button><p id="res">A</p>`,
  "/disabled": `<button id="b" disabled onclick="document.getElementById('hit').textContent='눌림'">계산</button><p id="hit">안 눌림</p>`,
  // 고르면 화면이 곧바로 첫 보기로 되돌린다
  "/reset": `<select id="s" onchange="setTimeout(()=>{this.selectedIndex=0},0)"><option value="">선택</option><option value="m">남</option></select>`,
  // 처음 넣은 값을 0.3초 뒤에 한 번 지운다(늦게 온 조회 응답이 칸을 비우는 것처럼)
  "/clears": `<input id="name" onchange="if(!window.done){window.done=1;setTimeout(()=>{this.value=''},300)}">`,
  "/empty": `<table id="list"><tbody></tbody></table><p id="none">조회 결과가 없습니다</p>`,
  "/empty-row": `<table id="list"><tbody><tr><td class="empty" colspan="2">조회 결과가 없습니다</td></tr></tbody></table>`,
  "/no-rows": `<table id="list"><tbody></tbody></table>`,
  // 세 번째로 열 때부터 «판매 중» — 다른 실행이 올린 매물이 새로고침해야 보이는 것처럼
  "/later": "",
  // 30행짜리 표 — 높이 100px 상자에 보이는 행(+ 앞뒤 하나)만 그린다. 스크롤 자리를 #top에 적는다
  "/virtual": virtual(1),
  // 상자는 5행 높이인데 2행만 그린다 — 반 화면씩 내리면 행을 건너뛴다
  "/virtual-skip": virtual(0, 2),
};

function virtual(extra: number, shown?: number): string {
  return `<div id="box" style="height:100px;overflow:auto;position:relative"><div style="height:600px"></div><div id="rows" style="position:absolute;left:0;right:0"></div></div><p id="top"></p>
<script>
  const box = document.getElementById("box"), rows = document.getElementById("rows");
  function draw() {
    const first = Math.floor(box.scrollTop / 20), n = ${shown ?? "5 + " + extra};
    rows.style.top = first * 20 + "px";
    rows.innerHTML = Array.from({ length: n }, (_, i) => first + i).filter((i) => i < 30)
      .map((i) => '<div class="row" style="height:20px"><span class="n">R' + i + '</span></div>').join("");
    document.getElementById("top").textContent = String(box.scrollTop);
  }
  box.addEventListener("scroll", draw);
  box.scrollTop = 40; draw();
</script>`;
}

let site: Server;
let hits = 0;
let url: string;
let browser: Browser;

const target = (label: string, css: string) => ({ label, locators: [{ kind: "css", value: css }], fingerprint: null, frames: [], verifiedAt: null });
const flow = (path: string, actions: unknown[], timeoutMs = 3000) => parseFlow({
  schemaVersion: 1, id: "s", name: "s", settings: { defaultTimeoutMs: timeoutMs },
  nodes: [{ id: "w", type: "web", name: "화면", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: url + path }, actions } }],
  edges: [],
});
const steps = (r: Awaited<ReturnType<typeof runFlow>>) => r.nodes[0]!.steps;
const table = (rows: string, extra: Record<string, unknown> = {}) => ({ label: "목록", rows: target("행", rows), columns: [{ name: "n", selector: ".n", strategy: "auto" }], maxRows: 100, ...extra });

beforeAll(async () => {
  site = createServer((q, res) => {
    const path = new URL(q.url ?? "/", "http://x").pathname;
    if (path === "/later") hits++;
    const body = path === "/later" ? (hits >= 3 ? `<p id="sale">판매 중</p>` : `<p>준비 중</p>`) : PAGES[path];
    res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8">${body ?? ""}`);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
});

describe("값이 그대로일 때까지", () => {
  it("★«찼다»는 중간값에서 통과하고, «그대로»는 최종값을 읽는다", async () => {
    const run = (wait: unknown) => runFlow(flow("/twice", [
      { id: "go", kind: "click", target: target("조회", "#go") },
      { id: "w", kind: "wait", wait },
      { id: "r", kind: "read", output: "amt", target: target("금액", "#amt") },
    ]), { browser });
    expect((await run({ kind: "filled", target: target("금액", "#amt") })).output).toEqual({ amt: "3억원" });
    expect((await run({ kind: "stable", target: target("금액", "#amt"), ms: 1000 })).output).toEqual({ amt: "1억원" });
  }, 30_000);

  it("검문소 — 그대로여야 하는 시간은 0.3~30초", () => {
    expect(() => flow("/twice", [{ id: "w", kind: "wait", wait: { kind: "stable", target: target("금액", "#amt"), ms: 100 } }])).toThrow(/300~30000/);
    expect(flow("/twice", [{ id: "w", kind: "wait", wait: { kind: "stable", target: target("금액", "#amt") } }]).nodes[0]).toMatchObject({ config: { actions: [{ wait: { ms: 2000 } }] } });
  });
});

describe("새로고침하며 기다리기", () => {
  it("★저절로 오지 않는 변화를 간격마다 다시 열어 본다 · 몇 번 열었나 남긴다", async () => {
    hits = 0;
    const r = await runFlow(flow("/later", [
      { id: "w", kind: "wait", timeoutMs: 15_000, wait: { kind: "visible", target: target("판매 중", "#sale"), reloadEveryMs: 2000 } },
      { id: "r", kind: "read", output: "sale", target: target("판매 중", "#sale") },
    ]), { browser });
    expect(r.status, JSON.stringify(r.nodes[0]!.failure)).toBe("success");
    expect(r.output).toEqual({ sale: "판매 중" });
    expect(steps(r).find((s) => s.id === "w")!.note).toMatch(/새로고침 2번 만에 나타났습니다/);
  }, 30_000);

  it("시간이 다 되면 몇 번 열었나와 함께 멈춘다 · 검문소 — 간격 2초~10분", async () => {
    const r = await runFlow(flow("/no-rows", [
      { id: "w", kind: "wait", timeoutMs: 5000, wait: { kind: "visible", target: target("판매 중", "#sale"), reloadEveryMs: 2000 } },
    ]), { browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/나타나지 않았습니다 — 새로고침 2번/);
    expect(() => flow("/later", [{ id: "w", kind: "wait", wait: { kind: "visible", target: target("x", "#x"), reloadEveryMs: 500 } }])).toThrow(/2초~10분/);
  }, 30_000);
});

describe("값이 바뀔 때까지", () => {
  it("★앞 결과가 남아 있어도 새 결과를 읽는다", async () => {
    const r = await runFlow(flow("/again", [
      { id: "go", kind: "click", target: target("조회", "#go") },
      { id: "w", kind: "wait", wait: { kind: "changed", target: target("결과", "#res") } },
      { id: "r", kind: "read", output: "res", target: target("결과", "#res") },
    ], 6000), { browser });
    expect(r.output).toEqual({ res: "B" });
  }, 30_000);

  it("★안 바뀌면 멈추지 않고 이어 가며 그 사실을 남긴다", async () => {
    const r = await runFlow(flow("/again", [
      { id: "same", kind: "click", target: target("그대로", "#same") },
      { id: "w", kind: "wait", timeoutMs: 1000, wait: { kind: "changed", target: target("결과", "#res") } },
      { id: "r", kind: "read", output: "res", target: target("결과", "#res") },
    ]), { browser });
    expect(r.status).toBe("success");
    expect(r.output).toEqual({ res: "A" });
    expect(steps(r).find((s) => s.id === "w")!.note).toMatch(/1초 동안 앞 동작 전\(1글자\)과 같았습니다/);
  }, 30_000);

  it("앞 동작을 건너뛰었으면 기다리지 않는다 · 검문소 — 첫 동작일 수 없다", async () => {
    const r = await runFlow(flow("/again", [
      { id: "go", kind: "click", optional: true, target: target("없는 단추", "#nope") },
      { id: "w", kind: "wait", wait: { kind: "changed", target: target("결과", "#res") } },
    ]), { browser });
    expect(steps(r).find((s) => s.id === "w")!.note).toMatch(/앞 동작을 건너뛰어/);
    expect(() => flow("/again", [{ id: "w", kind: "wait", wait: { kind: "changed", target: target("결과", "#res") } }])).toThrow(/첫 동작일 수 없습니다/);
  }, 30_000);
});

describe("꺼진 단추", () => {
  it("★이벤트로 누른 척하지 않고 멈춘다", async () => {
    const r = await runFlow(flow("/disabled", [{ id: "b", kind: "click", target: target("계산", "#b") }]), { browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/꺼져 있는 단추입니다/);
  }, 30_000);
});

describe("고르기 되읽기", () => {
  it("★화면이 보기를 되돌리면 멈춘다", async () => {
    const r = await runFlow(flow("/reset", [{ id: "s", kind: "select", target: target("성별", "#s"), value: "남" }]), { browser });
    expect(r.nodes[0]!.failure).toMatchObject({ problem: "notFilled" });
    expect(r.nodes[0]!.failure!.message).toMatch(/화면의 보기는 «선택»/);
  }, 30_000);
});

describe("넣은 칸 다시 확인", () => {
  it("★늦게 지워진 칸을 한 번 다시 넣는다", async () => {
    const r = await runFlow(flow("/clears", [
      { id: "f", kind: "fill", target: target("이름", "#name"), value: "김철수" },
      { id: "w", kind: "wait", wait: { kind: "fixed", ms: 600 } },
      { id: "c", kind: "recheck" },
      { id: "r", kind: "read", output: "name", target: target("이름", "#name") },
    ]), { browser });
    expect(r.output).toEqual({ name: "김철수" });
    expect(steps(r).find((s) => s.id === "c")!.note).toBe("넣은 칸 1개 중 1개가 바뀌어 있어 다시 넣었습니다 — 이름");
  }, 30_000);

  it("안 바뀌었으면 그대로 · 넣은 칸이 없으면 볼 것이 없다", async () => {
    const r = await runFlow(flow("/clears", [{ id: "c0", kind: "recheck" }, { id: "f", kind: "fill", target: target("이름", "#name"), value: "김철수" }, { id: "c", kind: "recheck" }]), { browser });
    expect(steps(r).find((s) => s.id === "c0")!.note).toMatch(/넣은 칸이 없어/);
    expect(steps(r).find((s) => s.id === "c")!.note).toBe("넣은 칸 1개가 그대로입니다");
  }, 30_000);
});

describe("표 읽기", () => {
  it("★빈 표 표시가 보이면 기다리지 않는다 — 표시가 행 모양이어도 빈 표다", async () => {
    for (const [path, empty] of [["/empty", "#none"], ["/empty-row", "#list td.empty"]] as const) {
      const t0 = Date.now();
      const r = await runFlow(flow(path, [{ id: "t", kind: "readTable", output: "rows", table: table("#list tbody tr", { empty: target("결과 없음", empty) }) }], 10_000), { browser });
      expect(r.output).toEqual({ rows: [] });
      expect(steps(r).find((s) => s.id === "t")!.note).toMatch(/빈 표 표시\(결과 없음\)가 보여/);
      expect(Date.now() - t0).toBeLessThan(5_000);
    }
  }, 30_000);

  it("표시가 없으면 시간 제한 뒤 빈 표로 보고 그 사실을 남긴다", async () => {
    const r = await runFlow(flow("/no-rows", [{ id: "t", kind: "readTable", output: "rows", timeoutMs: 1000, table: table("#list tbody tr") }]), { browser });
    expect(r.output).toEqual({ rows: [] });
    expect(steps(r).find((s) => s.id === "t")!.note).toMatch(/1초 동안 하나도 나오지 않아 빈 표로 봤습니다/);
  }, 30_000);

  it("★보이는 행만 그리는 표 — 스크롤 없이는 몇 행만, 스크롤 상자를 주면 30행 전부 · 스크롤은 제자리로", async () => {
    const shown = await runFlow(flow("/virtual", [{ id: "t", kind: "readTable", output: "rows", table: table("#rows .row") }]), { browser });
    expect((shown.output["rows"] as unknown[]).length).toBe(6);
    const r = await runFlow(flow("/virtual", [
      { id: "t", kind: "readTable", output: "rows", table: table("#rows .row", { scroll: "#box" }) },
      { id: "w", kind: "wait", wait: { kind: "fixed", ms: 100 } },
      { id: "top", kind: "read", output: "top", target: target("스크롤 자리", "#top") },
    ]), { browser });
    expect((r.output["rows"] as { n: string }[]).map((x) => x.n)).toEqual(Array.from({ length: 30 }, (_, i) => `R${i}`));
    expect(r.output["top"]).toBe("40");
  }, 60_000);

  it("★겹침이 없으면(행을 건너뛰었으면) 멈춘다", async () => {
    const r = await runFlow(flow("/virtual-skip", [{ id: "t", kind: "readTable", output: "rows", table: table("#rows .row", { scroll: "#box" }) }]), { browser });
    expect(r.status).toBe("failure");
    expect(r.nodes[0]!.failure!.message).toMatch(/앞 행과 겹치지 않습니다 — 건너뛴 행이 있을 수 있어 멈춥니다/);
  }, 30_000);

  it("겹침 — 가장 길게 겹치는 것", () => {
    const rs = (...xs: string[]) => xs.map((n) => ({ n }));
    expect(overlap([], rs("a"))).toBe(0);
    expect(overlap(rs("a", "b", "c"), rs("b", "c", "d"))).toBe(2);
    expect(overlap(rs("a", "b"), rs("a", "b"))).toBe(2);
    expect(overlap(rs("a", "b"), rs("c"))).toBe(0);
  });
});
