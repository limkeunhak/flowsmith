import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFlow, ID_RE, parseTemplate } from "@flowsmith/core";
import { blankFlow, describeAction, describeStep, humanTemplate, insertNode, josa, newAction, normalize, outputsOf, refLabel, TEMPLATES, guideItems, type GuideItem, fixHint, REPICKABLE, promoteCandidate, targetOf, hasAction } from "../src/model/index.ts";

describe("조사", () => {
  it("받침을 보고 고른다", () => {
    expect(josa("'조회' 버튼", "을를")).toBe("'조회' 버튼을");
    expect(josa("주문 상태", "을를")).toBe("주문 상태를");
    expect(josa("요소", "이가")).toBe("요소가");
    expect(josa("칸", "이가")).toBe("칸이");
    expect(josa("주소", "으로")).toBe("주소로");
    expect(josa("「합계」", "으로")).toBe("「합계」로");
    expect(josa("「금액」", "으로")).toBe("「금액」으로");
    expect(josa("「출발」", "으로")).toBe("「출발」로");   // ㄹ받침
  });

  it("한글이 아니면 둘 다 적는다", () => {
    expect(josa("{{ $params.orderNo }}", "을를")).toBe("{{ $params.orderNo }}을(를)");
    expect(josa("「status」", "으로")).toBe("「status」(으)로");
  });

  it("동작 문장", () => {
    const a = newAction("read", []);
    if (a.kind !== "read") throw new Error();
    expect(describeAction({ ...a, target: { ...a.target, label: "주문 상태" }, output: "status" })).toBe("주문 상태를 읽어 「status」(으)로 내보냅니다");
  });
});

describe("노드 끼우기", () => {
  const base = () => {
    let f = blankFlow("f", "f");
    f = insertNode(f, "web", { kind: "at", position: { x: 0, y: 0 } }).flow;
    f = insertNode(f, "custom", { kind: "after", node: "web1", port: "out" }).flow;
    return f;
  };

  it("출력 점 뒤에 붙이면 오른쪽에 놓고 잇는다", () => {
    const f = base();
    expect(f.nodes.map((n) => [n.id, n.position.x])).toEqual([["web1", 0], ["custom1", 220]]);
    expect(f.edges).toEqual([{ id: "e1", from: { node: "web1", port: "out" }, to: { node: "custom1" } }]);
  });

  it("엣지 사이에 끼우면 둘로 나누고 뒤를 민다", () => {
    const r = insertNode(base(), "condition", { kind: "between", edge: "e1" });
    expect(r.nodeId).toBe("cond1");
    expect(r.flow.edges.map((e) => `${e.from.node}→${e.to.node}`).sort()).toEqual(["cond1→custom1", "web1→cond1"]);
    expect(r.flow.nodes.find((n) => n.id === "custom1")!.position.x).toBe(440);
  });

  it("겹치면 아래로 비킨다", () => {
    const f = base();
    const r = insertNode(f, "custom", { kind: "after", node: "web1", port: "out" });
    const n = r.flow.nodes.find((x) => x.id === r.nodeId)!;
    expect(n.position).toEqual({ x: 220, y: 140 });
  });

  it("조건 노드의 갈래 뒤에 붙이면 갈래 포트로 잇는다", () => {
    let f = base();
    const c = insertNode(f, "condition", { kind: "after", node: "custom1", port: "out" });
    f = c.flow;
    const r = insertNode(f, "web", { kind: "after", node: c.nodeId, port: "yes" });
    expect(r.flow.edges.at(-1)).toMatchObject({ from: { node: "cond1", port: "yes" } });
    // 새 웹페이지 노드는 앞 페이지에서 이어서 시작한다 — 검사도 통과한다(빈 동작 문제만 빼고)
    expect(checkFlow(r.flow).filter((p) => !/동작이 하나도|비었습니다|오른쪽 값|elseThen/.test(p) && /순환|포트/.test(p))).toEqual([]);
  });
});

describe("값 칩 — 표현식을 사람 말로", () => {
  const flow = normalize({
    schemaVersion: 1, id: "f", name: "f",
    params: [{ name: "orderNo", label: "주문번호", required: true }],
    vars: { base: "https://x" },
    secrets: [{ name: "shop", kind: "login", description: "" }],
    nodes: [
      { id: "news", type: "web", name: "뉴스 읽기", position: { x: 0, y: 0 }, config: { start: { kind: "url", url: "https://x" }, actions: [{ id: "a1", kind: "readTable", output: "rows", table: { label: "목록", rows: { label: "", locators: [{ kind: "css", value: "li" }], fingerprint: null, frames: [], verifiedAt: null }, columns: [{ name: "제목", selector: "a", strategy: "auto" }], maxRows: 10 } }] } },
      { id: "cond", type: "condition", name: "있나", position: { x: 0, y: 0 }, config: { cases: [], else: { then: { kind: "next" } } } },
      { id: "tf", type: "transform", name: "다듬기", position: { x: 0, y: 0 }, config: { source: "", steps: [] } },
    ],
    edges: [{ id: "e1", from: { node: "news", port: "out" }, to: { node: "cond" } }, { id: "e2", from: { node: "cond", port: "else" }, to: { node: "tf" } }],
  });
  const label = (t: string) => { const s = parseTemplate(t)[0]; if (s?.kind !== "ref") throw new Error(); return refLabel(flow, "tf", s.ref); };

  it("★앞 단계 값은 그 값을 만든 노드 이름으로 — 조건 노드를 건너 더 앞까지", () => {
    expect(label("{{ $input.rows }}")).toEqual({ label: "뉴스 읽기 › rows", kind: "input", bad: null });
    expect(label("{{ $input.없음 }}").bad).toMatch(/내놓지 않습니다/);
  });

  it("실행 입력 · 변수 · 시크릿 · 노드 · 행", () => {
    expect(label("{{ $params.orderNo }}").label).toBe("실행 입력 › 주문번호");
    expect(label("{{ $vars.base }}").label).toBe("변수 › base");
    expect(label("{{ $secrets.shop.password }}")).toMatchObject({ label: "🔒 shop · 비밀번호", kind: "secret" });
    expect(label("{{ $node.news.rows }}").label).toBe("뉴스 읽기 › rows");
    expect(label("{{ $item.제목 }}").label).toBe("이 행 › 제목");
  });

  it("★동작 문장에도 표현식 대신 사람 말", () => {
    const a = newAction("fill", []);
    if (a.kind !== "fill") throw new Error();
    const filled = { ...a, target: { ...a.target, label: "주문번호 칸" }, value: "{{ $params.orderNo }}" };
    expect(describeAction(filled, { flow, nodeId: "tf" })).toBe("주문번호 칸에 «실행 입력 › 주문번호»를 넣습니다");
    expect(humanTemplate("A-{{ $params.orderNo }} / {{ $secrets.shop.username }}", flow, "tf")).toBe("A-«실행 입력 › 주문번호» / «🔒 shop · 아이디»");
  });

  it("새 값 다듬기 노드 · 단계 문장", () => {
    expect(outputsOf(flow, "tf")).toEqual(["rows", "count", "first"]);
    expect(describeStep({ kind: "filter", match: "all", rules: [{ field: "제목", op: "contains", value: "날씨" }, { field: "조회", op: "gte", value: "100" }] }))
      .toBe("「제목」에 포함 「날씨」 그리고 「조회」 ≥ 「100」인 행만");
    expect(describeStep({ kind: "pick", fields: [{ from: "제목", to: "title" }, { from: "링크", to: "" }] })).toBe("제목 → title · 링크만 남깁니다");
  });
});

describe("템플릿 · 다음 할 일", () => {
  let n = 0;
  const ctx = { newId: (b: string) => `${b}-t${n++}`, flows: [{ id: "src", name: "모으기", files: [{ name: "목록", format: "jsonl" as const }] }] };
  const answers = { url: "https://x.example/list", when: "평일 아침 9시", to: "kim@example.com", from: "src", cols: "주문번호, 이 름" };
  const noop = { openNode: () => undefined, openNotify: () => undefined, openProblems: () => undefined, openPublish: () => undefined };

  it("★뼈대만 짠다 — 남은 문제는 «녹화» 한 가지뿐(받는 메일을 적었으면)", () => {
    for (const t of TEMPLATES) {
      for (const f of t.build(answers, t.title, ctx)) {
        expect(ID_RE.test(f.id), f.id).toBe(true);
        expect(checkFlow(f).filter((p) => !/동작이 하나도 없습니다|source가 비었습니다/.test(p)), `${t.id}/${f.id}`).toEqual([]);
      }
    }
  });

  it("매일 목록 — 일정 · 메일(엑셀 첨부) · 날짜별 파일 · 겹침 빼기", () => {
    const [f] = TEMPLATES[0]!.build(answers, "날씨 뉴스", ctx);
    expect(f!.settings.schedules).toEqual([{ id: "s1", cron: "0 9 * * 1-5", params: {}, enabled: true }]);
    expect(f!.settings.notify[0]).toMatchObject({ channel: "email", url: "kim@example.com", attach: true, on: ["success", "failure", "drift"] });
    expect(f!.nodes.map((x) => x.type)).toEqual(["web", "transform", "fileWrite"]);
  });

  it("행마다 — «한 건» 워크플로우를 먼저 만들고, 칸 이름으로 실행 입력 · $item을 잇는다", () => {
    const [child, parent] = TEMPLATES[2]!.build(answers, "주문 입력", ctx);
    expect(child!.name).toBe("주문 입력 — 한 건");
    expect(child!.params.map((p) => p.name)).toEqual(["주문번호", "이_름"]);
    const call = parent!.nodes.find((x) => x.type === "flowCall");
    expect(call).toMatchObject({ config: { flowId: child!.id, items: "{{ $input.rows }}", params: { 주문번호: "{{ $item.주문번호 }}", 이_름: "{{ $item.이_름 }}" } } });
    expect(parent!.nodes[0]).toMatchObject({ type: "fileRead", config: { source: { flowId: "src", name: "목록", format: "jsonl" } } });
  });

  it("★다음 할 일 — 녹화 · 목록 고르기 · 받는 메일 · 문제 · 돌려 보기 · 게시 차례로, 한 것은 지운다", () => {
    const [f0] = TEMPLATES[0]!.build({ ...answers, to: "" }, "뉴스", ctx);
    const f = f0!;
    const items = (flow: typeof f, history: { status: string }[] = [], active: number | null = null) =>
      guideItems(flow, checkFlow(flow), history, active, noop);
    expect(items(f).map((i) => [i.id, i.done])).toEqual([
      ["rec-read", false], ["src-tidy", false], ["mail-n1", false], ["problems", true], ["run", false], ["publish", false],
    ]);
    expect(items(f).find((i) => i.id === "publish")!.text).toContain("게시하면 평일 9시에 돕니다");
    // 녹화하고 목록을 고르고 메일을 적으면
    const a = newAction("readTable", []);
    const done = {
      ...f,
      nodes: f.nodes.map((x) => x.type === "web" ? { ...x, config: { ...x.config, actions: [{ ...a, output: "rows" } as never] } } : x.type === "transform" ? { ...x, config: { ...x.config, source: "{{ $input.rows }}" } } : x),
      settings: { ...f.settings, notify: f.settings.notify.map((r) => ({ ...r, url: "kim@example.com" })) },
    };
    const left = items(done as typeof f, [{ status: "success" }]).filter((i) => !i.done).map((i) => i.id);
    expect(left).toEqual(expect.arrayContaining(["publish"]));
    expect(left).not.toContain("rec-read");
    expect(left).not.toContain("mail-n1");
    expect(items(done as typeof f, [{ status: "success" }], 1).filter((i: GuideItem) => i.id === "publish")[0]!.done).toBe(true);
  });
});

describe("깨졌을 때 고치기", () => {
  const flow = normalize(JSON.parse(readFileSync(new URL("../../../examples/login-and-read.json", import.meta.url), "utf8")));
  it("★실패마다 «무엇을 해 주세요» — 사이트 탓(다시 지정) · 입력 탓(입력값 확인) · 느림(다시 해 보기)", () => {
    for (const p of ["missing", "many", "forbidden", "notFilled", "noPage", "refused", "mismatch", "timeout", "stopped", "other"] as const) expect(fixHint(p, "'조회' 버튼").length).toBeGreaterThan(5);
    expect(fixHint("missing", "'조회' 버튼")).toMatch(/«'조회' 버튼»이\(가\) 화면에 없습니다.*\[다시 지정\]/);
    expect(fixHint("refused", null)).toMatch(/입력값/);
    expect(fixHint("timeout", null)).toMatch(/\[다시 해 보기 켜기\]/);
    expect(REPICKABLE).toEqual(["missing", "many", "notFilled"]);
  });

  it("★«이 위치로 바꾸기» — 그 후보를 1순위로 · 나머지 위치는 뒤에 남는다 · 확인 표시는 지운다 · 없는 동작이면 null", () => {
    const web = flow.nodes.find((n) => n.type === "web" && n.config.actions.some((a) => targetOf(a)?.locators.length))!;
    if (web.type !== "web") throw new Error();
    const a = web.config.actions.find((x) => (targetOf(x)?.locators.length ?? 0) > 0)!;
    const before = targetOf(a)!;
    const cand = { kind: "css" as const, value: "#새위치" };
    const next = promoteCandidate(flow, web.id, a.id, cand)!;
    const na = (next.nodes.find((n) => n.id === web.id) as typeof web).config.actions.find((x) => x.id === a.id)!;
    expect(targetOf(na)!.locators).toEqual([cand, ...before.locators]);
    expect(targetOf(na)!.verifiedAt).toBeNull();
    expect(promoteCandidate(flow, web.id, "없는동작", cand)).toBeNull();
    expect(hasAction(flow, web.id, a.id)).toBe(true);
  });

  it("고친 것이 게시되지 않았으면 «고친 것을 새 버전으로 게시하기»", () => {
    const noop = { openNode: () => undefined, openNotify: () => undefined, openProblems: () => undefined, openPublish: () => undefined };
    const pub = (upToDate: boolean) => guideItems(flow, [], [{ status: "success" }], { version: 3, upToDate }, noop).find((i) => i.id === "publish")!;
    expect(pub(true)).toMatchObject({ done: true });
    expect(pub(false)).toMatchObject({ done: false, text: "고친 것을 새 버전으로 게시하기 — 지금 도는 것은 v3입니다" });
  });
});

describe("빈 워크플로우의 다음 할 일", () => {
  it("«노드가 하나도 없습니다»는 문제가 아니라 첫 할 일", () => {
    const noop = { openNode: () => undefined, openNotify: () => undefined, openProblems: () => undefined, openPublish: () => undefined };
    const f = blankFlow("empty-x", "빈");
    const items = guideItems(f, checkFlow(f), [], null, noop);
    expect(items[0]).toMatchObject({ id: "first", done: false });
    expect(items.find((i) => i.id === "problems")).toMatchObject({ done: true });
  });
});
