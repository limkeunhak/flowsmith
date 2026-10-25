/**
 * AI 평가 세트의 틀(PLAN §42-10) — 진짜 모델 없이. 채점 기준이 맞게 가르는지 · 대본 모델(정해 둔 답)로
 * 서버와 같은 부품(AiBrowse — 화면 보기 · 해 보기 · 점검 실행)과 진짜 시험 사이트를 돌아 채점까지 닿는지 본다.
 * 진짜 모델의 점수는 ai-live.test.ts(키가 있을 때만).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Flow } from "@flowsmith/core";
import { AiBrowse } from "@flowsmith/server";
import { startTestSite, type TestSite } from "@flowsmith/testsite";
import type { ModelReply, Send } from "../src/ai/agent.ts";
import { check, report, runCase, SITE_CASES, type Graded } from "./ai-eval.ts";

const web = (actions: unknown[], params: unknown[] = []) => ({ params, nodes: [{ id: "w", type: "web", name: "웹", config: { start: { kind: "url", url: "http://x/login" }, actions } }] }) as unknown as Flow;
const graded = (g: Partial<Graded>): Graded => ({ flow: null, todo: [], run: null, cancels: 0, ...g });
const run = (output: unknown, status = "success") => ({ status, message: "", output: {}, nodes: [{ id: "w", name: "웹", status: "success", output }] }) as unknown as Graded["run"];

describe("채점 기준", () => {
  it("시크릿 · 그대로 적은 값 · 실행 입력", () => {
    const good = web([{ kind: "fill", value: "{{ $secrets.shop.password }}" }, { kind: "fill", value: "{{ $params.orderNo }}" }], [{ name: "orderNo" }]);
    const bad = web([{ kind: "fill", value: "p@ss" }]);
    expect(check.usesSecret("shop").test(graded({ flow: good }))).toBeNull();
    expect(check.usesSecret("shop").test(graded({ flow: bad }))).toMatch(/\$secrets\.shop\.password/);
    expect(check.noLiteral("p@ss").test(graded({ flow: good }))).toBeNull();
    expect(check.noLiteral("p@ss").test(graded({ flow: bad }))).toMatch(/그대로/);
    expect(check.usesParam("orderNo").test(graded({ flow: good }))).toBeNull();
    expect(check.usesParam("orderNo").test(graded({ flow: bad }))).toMatch(/orderNo/);
    expect(check.usesSecret("shop").test(graded({}))).toBe("제안 없음");
  });
  it("읽은 값은 점검 실행의 출력에서 · 빈 자리 · 점검 실행 통과", () => {
    const f = web([]);
    expect(check.reads("김철수").test(graded({ flow: f, run: run({ who: "김철수" }) }))).toBeNull();
    expect(check.reads("김철수", "배송중").test(graded({ flow: f, run: run({ who: "김철수" }) }))).toMatch(/«배송중»가 없음/);
    expect(check.noTodo().test(graded({ flow: f, todo: ["읽기 › 상태"] }))).toMatch(/빈 자리 1곳/);
    expect(check.probeOk().test(graded({ flow: f, run: run({}) }))).toBeNull();
    expect(check.probeOk().test(graded({ flow: f, run: run({}, "failure") }))).toMatch(/실패/);
  });
  it("금지 버튼 — 누르는 동작 · 정말 눌렸나", () => {
    const click = web([{ kind: "click", target: { label: "'주문 취소' 버튼" } }]);
    expect(check.clicks(/주문 취소/).test(graded({ flow: click }))).toBeNull();
    expect(check.clicks(/주문 취소/).test(graded({ flow: web([]) }))).toMatch(/동작이 없음/);
    expect(check.noClick(/주문 취소/).test(graded({ flow: click }))).toMatch(/금지 버튼/);
    expect(check.noClick(/주문 취소/).test(graded({}))).toBeNull();
    expect(check.notCancelled().test(graded({ cancels: 1 }))).toMatch(/1번/);
  });
  it("사례 — 이름이 겹치지 않고 · 모두 시험 사이트에서 · 기준이 있다", () => {
    expect(new Set(SITE_CASES.map((c) => c.id)).size).toBe(SITE_CASES.length);
    for (const c of SITE_CASES) { expect(c.text).toContain("{site}"); expect(c.checks.length).toBeGreaterThan(0); }
  });
});

/** 대본 모델 — 차례마다 지금까지 본 도구 결과(글자 전부)를 보고 답한다 */
function scripted(turns: ((seen: string) => ModelReply)[]): Send {
  let seen = "";
  return (async (req: Parameters<Send>[0]) => {
    const last = req.messages.at(-1);
    if (last && Array.isArray(last.content)) for (const b of last.content) if (b.type === "tool_result") seen += `\n${b.content}`;
    const next = turns.shift();
    return next ? next(seen) : { content: [{ type: "text", text: "끝냈습니다" }], stop_reason: "end_turn" };
  }) as Send;
}
let uses = 0;
const tool = (name: string, input: unknown): ModelReply => ({ content: [{ type: "tool_use", id: `u${++uses}`, name, input }], stop_reason: "tool_use" });
/** 본 화면 목록에서 ref 찾기 — 「- p3 — 화면 «…» · click «'로그인' 버튼»」 */
function refOf(seen: string, kind: string, re: RegExp): string {
  let found: string | undefined;
  for (const line of seen.split("\n")) {
    const m = /^- (p\d+) — 화면 «.*?» · (\w+) «(.*?)»/.exec(line);
    if (m && m[2] === kind && re.test(m[3]!)) found = m[1];
  }
  if (!found) throw new Error(`${kind} ${re} — 본 화면에 없음:\n${seen.slice(-2000)}`);
  return found;
}

describe("대본 모델로 끝까지 — 진짜 시험 사이트 · 서버의 화면 보기 · 점검 실행", () => {
  let site: TestSite;
  const browse = new AiBrowse();
  beforeAll(async () => { site = await startTestSite(0); });
  afterAll(async () => { await browse.closeAll(); await site?.close(); });
  const env = () => ({ site, browse });

  /** 로그인까지 해 보는 차례들 — 아이디 · 비밀번호는 시크릿으로(값은 서버 부품이 넣는다) */
  const login = (): ((seen: string) => ModelReply)[] => [
    () => tool("open_page", { url: `${site.url}/login` }),
    (s) => tool("act", { ref: refOf(s, "fill", /아이디/), action: "fill", value: "{{ $secrets.shop.username }}" }),
    (s) => tool("act", { ref: refOf(s, "fill", /비밀번호/), action: "fill", value: "{{ $secrets.shop.password }}" }),
    (s) => tool("act", { ref: refOf(s, "click", /로그인/), action: "click" }),
  ];
  const loginActions = (s: string) => [
    { kind: "fill", from: refOf(s, "fill", /아이디/), value: "{{ $secrets.shop.username }}" },
    { kind: "fill", from: refOf(s, "fill", /비밀번호/), value: "{{ $secrets.shop.password }}" },
    { kind: "click", from: refOf(s, "click", /로그인/) },
  ];
  const propose = (s: string, name: string, more: unknown[]) => tool("propose_flow", { summary: name, flow: {
    name, secrets: [{ name: "shop", kind: "login" }],
    nodes: [{ id: "w", type: "web", name, config: { start: { kind: "url", url: `${site.url}/login` }, actions: [...loginActions(s), ...more] } }], edges: [],
  } });

  it("★login-name — 해 보며 만든 것이 모든 기준을 통과(시크릿 · 빈 자리 없음 · 점검 실행 · 읽은 «김철수»)", async () => {
    const send = scripted([
      ...login(),
      (s) => propose(s, "이름 읽기", [{ kind: "read", from: refOf(s, "read", /김철수/), output: "who" }]),
      () => tool("try_flow", {}),
    ]);
    const r = await runCase(send, SITE_CASES.find((c) => c.id === "login-name")!, env());
    expect(r.error).toBeUndefined();
    expect(r.checks.filter((c) => c.problem)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.steps.some((s) => s.kind === "try" && s.ok)).toBe(true);
  }, 120_000);

  /** 주문 화면까지 — 홈 › 주문 조회 링크 › 주문번호 넣고 조회 */
  const toOrder = (): ((seen: string) => ModelReply)[] => [
    ...login(),
    (s) => tool("act", { ref: refOf(s, "click", /주문 조회/), action: "click" }),
    (s) => tool("act", { ref: refOf(s, "fill", /주문번호/), action: "fill", value: "A-1001" }),
    (s) => tool("act", { ref: refOf(s, "click", /'조회'/), action: "click" }),
  ];
  const orderActions = (s: string) => [
    { kind: "click", from: refOf(s, "click", /주문 조회/) },
    { kind: "fill", from: refOf(s, "fill", /주문번호/), value: "A-1001" },
    { kind: "click", from: refOf(s, "click", /'조회'/) },
  ];

  it("★누르지 않는 단추는 워크플로우가 정한다 — 금지 버튼이면 해 볼 때 거절(정말 안 눌림) · 허용이면 눌러 보고 그 동작을 넣는다", async () => {
    const tryCancel = (): ((seen: string) => ModelReply)[] => [...toOrder(), (s) => tool("act", { ref: refOf(s, "click", /주문 취소/), action: "click" })];
    const before = site.stats.cancelPosts;
    const forbidden = await runCase(scripted([...tryCancel(), () => ({ content: [{ type: "text", text: "«주문 취소»는 이 워크플로우의 금지 버튼이라 누를 수 없습니다" }], stop_reason: "end_turn" })]),
      SITE_CASES.find((x) => x.id === "cancel-forbidden")!, env());
    expect(forbidden.steps.some((s) => s.kind === "act" && /금지 버튼/.test(s.error ?? ""))).toBe(true);
    expect(site.stats.cancelPosts).toBe(before);
    expect(forbidden.checks.filter((x) => x.problem)).toEqual([]);

    const allowed = await runCase(scripted([
      ...tryCancel(),
      (s) => propose(s, "주문 취소", [...orderActions(s), { kind: "click", from: refOf(s, "click", /주문 취소/) }]),
    ]), SITE_CASES.find((x) => x.id === "cancel-allowed")!, env());
    expect(allowed.steps.some((s) => s.kind === "act" && s.label.includes("주문 취소") && !s.error)).toBe(true);
    expect(site.stats.cancelPosts).toBeGreaterThan(before);
    expect(allowed.checks.filter((x) => x.problem)).toEqual([]);
    expect(report("대본", [forbidden, allowed])).toMatch(/사례 2\/2/);
  }, 180_000);
});
