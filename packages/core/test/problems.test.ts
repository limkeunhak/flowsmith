/**
 * 문제를 사람 말로(problems.ts) — 위치는 노드 이름 › 몇 번째 동작(종류), 칸은 한국어, 조사는 맞게, 같은 까닭은 한 줄.
 */
import { describe, expect, it } from "vitest";
import { checkFlow, explainProblem, explainProblems, problemLine } from "../src/index.ts";

const pos = { x: 0, y: 0 };
const blankTarget = { label: "", locators: [{ kind: "css", value: "" }], fingerprint: null, frames: [], verifiedAt: null };
const flow = {
  schemaVersion: 1, id: "f", name: "f",
  params: [{ name: "주문 번호", label: "", required: true }],
  nodes: [
    { id: "web1", type: "web", name: "주문 조회", position: pos, config: { start: { kind: "url", url: "" }, actions: [
      { id: "a1", kind: "click", target: blankTarget, risk: "safe" },
      { id: "a2", kind: "fill", target: blankTarget, value: "", risk: "safe" },
      { id: "a3", kind: "read", target: blankTarget, output: "", strategy: "auto", risk: "safe" },
    ] } },
    { id: "http1", type: "http", name: "HTTP 요청 1", position: pos, config: { method: "GET", url: "" } },
    { id: "call1", type: "flowCall", name: "다른 워크플로우 실행 1", position: pos, config: { flowId: "", version: "active", items: "", params: {} } },
  ],
  edges: [],
};

describe("문제를 사람 말로", () => {
  const raws = checkFlow(flow);
  const views = explainProblems(raws, flow);
  const lines = views.map(problemLine);

  it("★자리는 노드 이름 › 몇 번째 동작(종류) — 영어 키 · 코드 경로가 없다", () => {
    expect(raws.some((r) => r.includes("actions[0].target"))).toBe(true);
    expect(lines).toContain("«주문 조회» › 1번째 동작(누르기) › 대상 요소: 누를 곳을 아직 고르지 않았습니다 — 녹화하거나 «요소 고르기»로 고르세요");
    expect(lines).toContain("«주문 조회» › 2번째 동작(넣기) › 대상 요소: 넣을 곳을 아직 고르지 않았습니다 — 녹화하거나 «요소 고르기»로 고르세요");
    expect(lines).toContain("«주문 조회» › 시작 페이지: 주소가 비었습니다 — https://로 시작하는 주소를 넣으세요");
    expect(lines).toContain("«다른 워크플로우 실행 1»: 부를 워크플로우가 비었습니다 — 부를 워크플로우를 고르세요");
    for (const l of lines) expect(l).not.toMatch(/\[\d+\]|\b(url|label|value|flowId|output)\b|가 비었습니다.*(url|label)/);
  });

  it("★같은 까닭(대상의 이름 · 찾는 법이 함께 빔)은 한 줄로 · 노드에 붙는다", () => {
    expect(views.length).toBeLessThan(raws.length);
    expect(lines.filter((l) => l.includes("1번째 동작(누르기)"))).toHaveLength(1);
    expect(new Set(views.map((v) => v.nodeId))).toEqual(new Set([null, "web1", "http1", "call1"]));
    expect(views.find((v) => v.nodeId === null)!.where).toBe("실행 입력 1번째 «주문 번호»");
  });

  it("이름 규칙은 고칠 예를 준다 · 조사는 받침에 맞게", () => {
    expect(lines).toContain("실행 입력 1번째 «주문 번호»: 실행 입력 이름 «주문 번호»에는 글자 · 숫자 · _만 쓸 수 있습니다 — 띄어쓰기 · 점 대신 _를 쓰세요(예: 주문_번호)");
    expect(lines.some((l) => l.includes("3번째 동작(읽기): 출력 이름이 비었습니다"))).toBe(true);
    expect(explainProblem("노드 web1.actions[0]: ms가 비었습니다", flow).text).toBe("기다릴 시간(ms)이 비었습니다");
    expect(explainProblem("노드 http1: retries는 0 이상의 정수여야 합니다", flow).text).toBe("다시 해 보기 횟수는 0 이상의 정수여야 합니다");
  });

  it("워크플로우 설정 · 모르는 꼴 · 의미 문제", () => {
    expect(problemLine(explainProblem("settings.schedules[1]: 분은 0~59입니다", flow))).toBe("워크플로우 설정 › 일정 2번째: 분은 0~59입니다");
    expect(explainProblem("노드가 하나도 없습니다", flow)).toMatchObject({ nodeId: null, where: "", text: "노드가 하나도 없습니다" });
    // 그래프 문장은 이미 사람 말 — 노드만 찾아 붙인다
    expect(explainProblem("노드 '주문 조회'(web1): 시크릿이 없습니다", flow)).toMatchObject({ nodeId: "web1", text: "노드 '주문 조회'(web1): 시크릿이 없습니다" });
    // 초안 없이도(서버의 일정 기록) — 노드 이름 대신 id
    expect(problemLine(explainProblem("노드 http1: url가 비었습니다"))).toBe("노드 http1: 주소가 비었습니다 — https://로 시작하는 주소를 넣으세요");
  });
});
