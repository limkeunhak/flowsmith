import { describe, expect, it } from "vitest";
import { checkFlow, compile, parseFlow } from "../src/index.ts";
import { cond, custom, edge, example, flow, target, web } from "./fixtures.ts";

const hasProblem = (json: unknown, re: RegExp) => {
  const ps = checkFlow(json);
  expect(ps.some((p) => re.test(p)), ps.join("\n") || "(문제 없음)").toBe(true);
};
const ok = (json: unknown) => expect(checkFlow(json)).toEqual([]);

describe("그래프", () => {
  it("순서는 위상 정렬이고, 같은 자리면 nodes 배열 순서다", () => {
    //   a ─┬─ c ─┐
    //   b ─┘     d
    //   (e는 홀로)
    const f = parseFlow(flow([custom("e"), custom("d"), custom("c"), custom("b"), custom("a")], [
      edge("e1", "a", "c"), edge("e2", "b", "c"), edge("e3", "c", "d"),
    ]));
    expect(compile(f).order).toEqual(["e", "b", "a", "c", "d"]);
  });

  it("★순환을 거부한다 — 그리고 순환 위에서 참조 검사를 하지 않는다", () => {
    const j = flow([custom("a"), custom("b"), custom("c")], [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "b")]);
    const ps = checkFlow(j);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatch(/순환.*\(b\).*\(c\)/);
  });

  it("자기 자신으로 가는 엣지 · 없는 노드 · 없는 포트 · 같은 연결 두 번", () => {
    hasProblem(flow([custom("a")], [edge("e1", "a", "a")]), /자기 자신/);
    hasProblem(flow([custom("a")], [edge("e1", "a", "zz")]), /도착 노드 "zz"가 없습니다/);
    hasProblem(flow([custom("a"), custom("b")], [edge("e1", "a", "b", "yes")]), /"yes" 포트가 없습니다.*out/);
    hasProblem(flow([custom("a"), custom("b")], [edge("e1", "a", "b"), edge("e2", "a", "b")]), /같은 연결/);
  });

  it("노드가 없으면 거부한다", () => {
    hasProblem(flow([], []), /노드가 하나도 없습니다/);
  });

  describe("조건 노드의 갈래", () => {
    const base = (cases: { id: string; then?: unknown }[], elseThen: unknown, edges: unknown[]) =>
      flow([custom("a", ["v"]), cond("c", cases, elseThen), custom("x"), custom("y")], [edge("e0", "a", "c"), ...edges]);

    it("«다음으로»인 갈래에 이어진 노드가 없으면 거부한다", () => {
      hasProblem(base([{ id: "yes" }], { kind: "next" }, [edge("e1", "c", "x", "yes")]), /그 밖\(else\)이 «다음 노드로»인데/);
    });

    it("«종료»인 갈래 뒤에 노드가 이어져 있으면 거부한다", () => {
      hasProblem(base([{ id: "yes", then: { kind: "end", status: "success", message: "" } }], { kind: "next" },
        [edge("e1", "c", "x", "yes"), edge("e2", "c", "y", "else")]), /«워크플로우 종료»인데 뒤에/);
    });

    it("맞게 이으면 통과한다", () => {
      ok(base([{ id: "yes" }], { kind: "end", status: "failure", message: "아님" }, [edge("e1", "c", "x", "yes")]));
    });
  });

  describe("표현식 참조", () => {
    it("$input은 앞 노드들이 내놓는 이름만", () => {
      const j = example();
      j.nodes[2].config.cases[0].rules[0].left = "{{ $input.stat }}";
      hasProblem(j, /"stat"를 내놓지 않습니다.*status · amount/);
    });

    it("들어오는 엣지가 없는 노드는 $input을 못 쓴다", () => {
      const j = example();
      j.nodes[0].config.actions[0].value = "{{ $input.x }}";
      hasProblem(j, /들어오는 엣지가 없어/);
    });

    it("조건 노드는 받은 것을 그대로 넘긴다 — 뒤 노드가 그 이름을 쓸 수 있다", () => {
      const f = compile(parseFlow(example()));
      // 조회(search)는 «앞 페이지에서 이어서» — 로그인이 읽은 userName도 함께 넘긴다(2026-10-22 노드 나누기)
      expect([...f.outputs.get("check")!]).toEqual(["userName", "status", "amount"]);
    });

    it("★$node는 조상 노드만 — 옆 갈래나 뒤 노드는 안 된다", () => {
      const j = flow([custom("a", ["v"]), custom("b", ["w"]), web("c")], [edge("e1", "a", "c")]);
      (j.nodes[2] as any).config.actions.push({ id: "f", kind: "fill", target: target(), value: "{{ $node.b.w }}" });
      hasProblem(j, /조상 노드만/);
      (j.nodes[2] as any).config.actions[1].value = "{{ $node.a.w }}";
      hasProblem(j, /"w"를 내놓지 않습니다/);
      (j.nodes[2] as any).config.actions[1].value = "{{ $node.a.v }}";
      ok(j);
    });

    it("$params · $vars는 정의된 것만", () => {
      const j = example();
      j.nodes[1].config.actions[1].value = "{{ $params.orderNumber }}";
      j.nodes[1].config.actions[0].url = "{{ $vars.base }}/orders";
      hasProblem(j, /실행 입력 "orderNumber"/);
      hasProblem(j, /변수 "base"가 없습니다/);
    });

    it("★시크릿은 넣기 · 고르기 값에서만 — 주소나 조건에 쓰면 거부한다", () => {
      const j = example();
      j.nodes[1].config.actions[0].url = "{{ $vars.baseUrl }}/orders?k={{ $secrets.shop.password }}";
      j.nodes[2].config.cases[0].rules[0].right = "{{ $secrets.shop.username }}";
      const ps = checkFlow(j).filter((p) => /넣기» · «고르기»/.test(p));
      expect(ps).toHaveLength(2);
    });

    it("login 시크릿은 칸을 붙여 쓰고, text 시크릿은 칸 없이 쓴다", () => {
      const j = example();
      j.secrets.push({ name: "token", kind: "text" });
      j.nodes[0].config.actions[0].value = "{{ $secrets.shop }}";
      j.nodes[0].config.actions[1].value = "{{ $secrets.token.value }}";
      hasProblem(j, /\.username · \.password · \.extra 중 하나/);
      hasProblem(j, /칸 없이 씁니다/);
    });

    it("정의되지 않은 시크릿은 거부한다", () => {
      const j = example();
      j.nodes[0].config.actions[0].value = "{{ $secrets.bank.username }}";
      hasProblem(j, /시크릿 "bank"가 정의되지 않았습니다/);
    });

    it("치환을 넘어서는 표현식은 거부한다", () => {
      const j = example();
      j.nodes[1].config.actions[1].value = "{{ $params.orderNo + 1 }}";
      hasProblem(j, /읽을 수 없습니다/);
      j.nodes[1].config.actions[1].value = "{{ orderNo }}";
      hasProblem(j, /\$input · \$node .* 중 하나로 시작/);
    });
  });

  it("«앞 페이지에서 이어서»는 앞에 웹페이지 노드가 있어야 한다", () => {
    const j = flow([custom("a"), web("b")], [edge("e1", "a", "b")]);
    (j.nodes[1] as any).config.start = { kind: "continue" };
    hasProblem(j, /앞에 웹페이지 노드가 없습니다/);
    (j.nodes[0] as any).config.usesPage = true;
    ok(j);
  });

  it("★금지 버튼을 누르도록 녹화된 클릭은 거부한다", () => {
    const j = example();
    j.nodes[1].config.actions[2].target.label = "'주문 취소' 버튼";
    hasProblem(j, /금지 버튼\(주문\\s\*취소\)/);
  });

  it("금지 버튼은 지문의 글자로도 잡는다 — 사람이 붙인 이름을 바꿔도 빠져나가지 못한다", () => {
    const j = example();
    j.nodes[1].config.actions[2].target.fingerprint = { tag: "button", attrs: {}, text: "결제하기", nearText: "" };
    hasProblem(j, /금지 버튼\(결제\)/);
  });

  it("위치에는 표현식을 못 쓴다", () => {
    const j = example();
    j.nodes[1].config.actions[3].target.locators[0].value = "#row-{{ $params.orderNo }}";
    hasProblem(j, /위치에는 표현식을 쓸 수 없습니다/);
  });

  describe("B1 동작 — 행 고르기 · 확인 · 조건이 맞을 때만", () => {
    const pickFlow = (pick: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const j = example();
      j.nodes[1].config.actions.push({ id: "p1", kind: "pickRow", pick: { label: "목록", rows: target("행", "#t > tbody > tr"), keyColumn: "td:nth-child(2)", keyLabel: "번호", value: "{{ $params.orderNo }}", click: "", refuse: null, ...pick }, ...extra });
      return j;
    };
    it("행 고르기 · 확인 · 조건의 값도 참조 검사를 받는다", () => {
      ok(pickFlow({}));
      hasProblem(pickFlow({ value: "{{ $params.nope }}" }), /동작 \d+\(p1\) 찾을 값: .*실행 입력 "nope"가 정의되지 않았습니다/);
      hasProblem(pickFlow({}, { when: { left: "{{ $input.nope }}", op: "eq", right: "x" } }), /동작 \d+\(p1\) 조건 왼쪽/);
      const j = example();
      j.nodes[1].config.actions.push({ id: "c1", kind: "assert", strategy: "auto", equals: "{{ $secrets.shop.password }}", target: target("상태", "#s") });
      hasProblem(j, /c1\) 기대값/);
    });
    it("고르면 안 되는 값은 하나 이상 · 키 칸은 비울 수 없다", () => {
      hasProblem(pickFlow({ refuse: { column: "td:nth-child(5)", values: [], reason: "x" } }), /고르면 안 되는 값을 하나 이상/);
      hasProblem(pickFlow({ keyColumn: "" }), /keyColumn/);
    });
    it("새 필드는 없으면 기본값 — 옛 워크플로우가 그대로 읽힌다", () => {
      const f = parseFlow(example());
      const a = (f.nodes[1] as any).config.actions;
      expect(a.find((x: any) => x.kind === "click")).toMatchObject({ optional: false, popup: false });
      expect(a.find((x: any) => x.kind === "read")).toMatchObject({ transform: null });
      expect(a.some((x: any) => "when" in x)).toBe(false);
    });
  });
});
