/**
 * **AI에게 보이는 노드 · 동작 목록과 예시**(PLAN §42 · 2026-10-25) — 설명서(spec.ts)의 «노드 종류»는 여기서 만든다.
 *
 * ★예시 설정은 손으로 쓰지만 **시험이 진짜 길로 돌려 본다**(apps/studio/test/ai-catalog.test.ts) —
 *  노드 종류마다 · 웹 동작마다 하나씩 있어야 하고(빠지면 시험이 실패), 예시를 ai/build.ts에 넣으면 검문소까지 통과해야 한다.
 *  그래서 core의 노드 설정이 바뀌면 여기가 어긋난 채로 남지 않는다.
 * 예시에는 $input을 쓰지 않는다(노드 하나로 돌려 보므로) — 앞 노드의 값을 쓰는 법은 설명서의 «값 쓰기»와 아래 EXAMPLES가 보인다.
 */
import { CHECK_LIST_OPS, CONDITION_OPS } from "@flowsmith/core";

export interface NodeDoc {
  type: string;
  title: string;
  /** 이 노드의 config 예시 — 시험이 검문소로 돌려 본다 */
  config: Record<string, unknown>;
  /** 덧붙일 말(고를 수 있는 값 · 규칙) */
  more?: string;
  /** 다음 노드에 내놓는 것 */
  outputs: string;
}

export interface ActionDoc {
  kind: string;
  /** 동작 예시 — label은 «어느 요소»의 이름(요소는 녹화 · 화면 보기로 채운다) */
  example: Record<string, unknown>;
  note: string;
}

/** 웹 동작 — ai/build.ts가 받는 것과 같아야 한다(시험이 본다) */
export const ACTION_DOCS: ActionDoc[] = [
  { kind: "click", example: { kind: "click", label: "로그인 단추" }, note: "누르기 — 새 창(팝업)이 열리면 \"popup\": true(뒤 동작은 그 창에서)" },
  { kind: "fill", example: { kind: "fill", label: "아이디 칸", value: "{{ $secrets.portal.username }}" }, note: "칸에 넣기" },
  { kind: "select", example: { kind: "select", label: "기간", value: "최근 1개월" }, note: "고르기 칸에서 고르기(보이는 글자)" },
  { kind: "read", example: { kind: "read", label: "주문 상태", output: "status" }, note: "글자 읽기 → output 이름으로 내놓음" },
  { kind: "readTable", example: { kind: "readTable", label: "주문 목록", output: "orders", columns: ["주문번호", "고객", "금액"] }, note: "표 읽기 → 행 목록(열 이름이 칸)" },
  { kind: "goto", example: { kind: "goto", url: "https://shop.example.com/orders" }, note: "주소로 가기" },
  { kind: "wait", example: { kind: "wait", ms: 2000 }, note: "잠깐 기다리기" },
  { kind: "press", example: { kind: "press", key: "Enter" }, note: "키 누르기" },
  { kind: "human", example: { kind: "human", prompt: "포털에 로그인해 주세요" }, note: "사람 기다리기 — 로그인 · 본인 인증 · 캡차처럼 사람이 직접 할 일. 끝났다는 표시는 사람이 녹화로 정한다" },
];

export const NODE_DOCS: NodeDoc[] = [
  {
    type: "web", title: "웹페이지",
    config: { start: { kind: "url", url: "https://shop.example.com/login" }, actions: [{ kind: "fill", label: "아이디 칸", value: "{{ $secrets.portal.username }}" }, { kind: "click", label: "로그인 단추" }] },
    more: [
      "start: { \"kind\": \"url\", \"url\": \"https://...\" } 또는 { \"kind\": \"continue\" }(앞 웹페이지 노드의 페이지에서 이어서)",
      `actions — ${ACTION_DOCS.map((a) => `${JSON.stringify(a.example)} ${a.note}`).join("\n    · ")}`,
      "★**한 웹페이지 노드에 단계를 몰지 말고 나눕니다** — 사용자가 캔버스에서 흐름을 봅니다:",
      "  «페이지 접속»(start url · actions 비움) → «사람 기다리기»(start continue · actions에 human 하나만) → «주문 읽기»(start continue · 업무 동작)",
      "  로그인이 자동이면(시크릿으로 아이디 · 비밀번호 넣기) «로그인» 노드로 따로 둡니다. 나눈 노드들은 같은 브라우저 페이지에서 이어 돌고, 앞에서 읽은 값도 뒤로 이어집니다",
    ].join("\n  "),
    outputs: "read · readTable의 output 이름들(readTable은 행 목록) + «앞 페이지에서 이어서»면 앞 노드가 넘긴 것도 함께",
  },
  {
    type: "condition", title: "조건",
    config: { cases: [{ id: "yes", label: "배송중이면", match: "all", rules: [{ left: "{{ $params.status }}", op: "eq", right: "배송중" }], then: { kind: "end", status: "success", message: "배송중입니다" } }], else: { then: { kind: "end", status: "failure", message: "배송중이 아닙니다" } } },
    more: `op: ${CONDITION_OPS.join(" · ")} (empty · notEmpty · isTrue · isFalse는 right가 null). then: { "kind": "next" }(그 갈래에 이은 노드로 — 갈래 id를 port로 선을 잇는다) · { "kind": "end", "status": "success|failure", "message" }(여기서 끝). 갈래마다 출력 port = 갈래 id, 나머지는 "else"`,
    outputs: "받은 값을 그대로 넘김",
  },
  {
    type: "transform", title: "값 다듬기(코드 없이 목록 다루기)",
    config: { source: "{{ $params.rows }}", steps: [
      { kind: "filter", match: "all", rules: [{ field: "상태", op: "eq", value: "배송중" }] },
      { kind: "pick", fields: [{ from: "주문번호", to: "orderNo" }] },
      { kind: "sort", field: "orderNo", order: "asc" },
    ] },
    more: "steps: pick { fields: [{ from, to }] } · filter { match, rules: [{ field, op, value }] } · dedupe { fields } · map { field, table: [{ from, to }], otherwise: \"keep\", fixed } · format { field, as: \"number|trim|date|replace\", find, replace } · sort { field, order: \"asc|desc\" } · limit { count }",
    outputs: "rows · count · first",
  },
  {
    type: "http", title: "HTTP 요청",
    config: { method: "POST", url: "https://hooks.example.com/notify", query: [], headers: [{ name: "Content-Type", value: "application/json" }], body: { kind: "json", text: "{\"text\": \"주문 {{ $params.orderNo }} 확인\"}" }, response: "auto" },
    more: "method: GET|POST|PUT|PATCH|DELETE|HEAD · body.kind: none|json|form|text · response: auto|json|text",
    outputs: "status · ok · body · headers",
  },
  {
    type: "fileWrite", title: "파일 쓰기",
    config: { data: "{{ $params.rows }}", target: { name: "주문 결과", format: "csv", mode: "append" } },
    more: "format: csv|jsonl|json|text · mode: append|overwrite",
    outputs: "file · written · skipped",
  },
  {
    type: "fileRead", title: "파일 읽기",
    config: { source: { scope: "flow", flowId: null, name: "주문 결과", format: "csv" }, missing: "empty" },
    more: "scope: flow(이 워크플로우) · shared(공유) · otherFlow(다른 워크플로우 — flowId) · missing: fail|empty",
    outputs: "rows · file · count",
  },
  {
    type: "flowCall", title: "다른 워크플로우 실행",
    config: { flowId: "order-detail", version: "active", items: "", params: { orderNo: "{{ $params.orderNo }}" }, concurrency: 1, onError: "stop" },
    more: "items — 행마다 돌릴 목록(\"{{ $input.rows }}\" · 그때 params에서 {{ $item.칸 }}) · 한 번이면 \"\" · onError: stop|continue · flowId는 아래 «다른 워크플로우»에 있는 것만",
    outputs: "results · succeeded · failed",
  },
  {
    type: "approval", title: "승인 기다리기",
    config: { message: "환불을 진행해도 될까요?", minRole: "editor", timeoutMin: 1440 },
    more: "minRole: runner|editor|admin",
    outputs: "approved · by · comment · at",
  },
  {
    type: "check", title: "검사(테스트 — 값이 기대대로인지)",
    config: { items: [{ id: "k1", label: "주문번호가 있다", actual: "{{ $params.orderNo }}", op: "notEmpty", expected: null }] },
    more: `op: 조건과 같고 목록용 ${CHECK_LIST_OPS.join(" · ")}`,
    outputs: "checksPassed · checksFailed",
  },
  {
    type: "extension", title: "확장(이 서버에 설치된 것만 — 아래 목록)",
    config: { extension: "my-extension", options: { 이름: "값" } },
    more: "extension은 아래 «이 서버의 확장»의 id(소문자 · 숫자 · - · 점) · options는 그 확장의 options 이름",
    outputs: "확장마다 다름(아래 목록)",
  },
];

/** 노드 하나로 시험할 때 둘러쌀 것 — 예시가 쓰는 실행 입력 · 시크릿(ai-catalog 시험) */
export const DOC_WRAPPER = {
  params: [{ name: "orderNo", label: "주문번호" }, { name: "status", label: "상태" }, { name: "rows", label: "목록" }],
  secrets: [{ name: "portal", kind: "login", description: "포털 계정" }],
};

/**
 * **잘 만든 예**(few-shot) — 설명서에 그대로 보인다. 시험이 ai/build.ts로 돌려 검문소를 통과하는지 본다.
 * 웹페이지 노드를 단계로 나누고 · 시크릿은 이름으로 · 앞 노드의 값은 $input으로 잇는 법을 보인다.
 */
export const EXAMPLES: { ask: string; flow: Record<string, unknown> }[] = [
  {
    ask: "쇼핑몰 관리자에 로그인해서 주문번호로 상태를 보고, 배송중이면 슬랙으로 알려줘",
    flow: {
      name: "주문 상태 확인 · 배송중 알림",
      params: [{ name: "orderNo", label: "주문번호", required: true, type: "text" }],
      secrets: [{ name: "shop", kind: "login", description: "쇼핑몰 관리자 계정" }],
      vars: { siteUrl: "https://admin.shop.example.com", slackUrl: "https://hooks.slack.com/services/…" },
      nodes: [
        { id: "login", type: "web", name: "로그인", config: { start: { kind: "url", url: "{{ $vars.siteUrl }}/login" }, actions: [
          { kind: "fill", label: "아이디 칸", value: "{{ $secrets.shop.username }}" },
          { kind: "fill", label: "비밀번호 칸", value: "{{ $secrets.shop.password }}" },
          { kind: "click", label: "로그인 단추" },
        ] } },
        { id: "order", type: "web", name: "주문 상태 읽기", config: { start: { kind: "continue" }, actions: [
          { kind: "fill", label: "주문번호 칸", value: "{{ $params.orderNo }}" },
          { kind: "click", label: "조회 단추" },
          { kind: "read", label: "주문 상태", output: "status" },
        ] } },
        { id: "shipping", type: "condition", name: "배송중인가", config: { cases: [{ id: "yes", label: "배송중", match: "all", rules: [{ left: "{{ $input.status }}", op: "eq", right: "배송중" }], then: { kind: "next" } }], else: { then: { kind: "end", status: "success", message: "배송중이 아닙니다" } } } },
        { id: "notify", type: "http", name: "슬랙 알림", config: { method: "POST", url: "{{ $vars.slackUrl }}", body: { kind: "json", text: "{\"text\": \"주문 {{ $params.orderNo }}이 배송중입니다\"}" } } },
      ],
      edges: [{ from: "login", to: "order" }, { from: "order", to: "shipping" }, { from: "shipping", to: "notify", port: "yes" }],
      notes: [{ text: "처음 한 번: 로그인 · 주문 상태 읽기 노드를 녹화로 채우세요", near: "login" }],
    },
  },
  {
    ask: "평일 아침마다 주문 목록에서 취소된 것만 골라 파일로 남겨줘",
    flow: {
      name: "취소 주문 모으기",
      secrets: [{ name: "shop", kind: "login", description: "쇼핑몰 관리자 계정" }],
      settings: { schedules: [{ id: "s1", cron: "0 9 * * 1-5", params: {}, enabled: true }] },
      nodes: [
        { id: "open", type: "web", name: "페이지 접속", config: { start: { kind: "url", url: "https://admin.shop.example.com/orders" }, actions: [] } },
        { id: "wait", type: "web", name: "사람 기다리기", config: { start: { kind: "continue" }, actions: [{ kind: "human", prompt: "쇼핑몰 관리자에 로그인해 주세요" }] } },
        { id: "list", type: "web", name: "주문 목록 읽기", config: { start: { kind: "continue" }, actions: [{ kind: "readTable", label: "주문 목록", output: "orders", columns: ["주문번호", "고객", "상태"] }] } },
        { id: "pick", type: "transform", name: "취소만", config: { source: "{{ $input.orders }}", steps: [{ kind: "filter", match: "all", rules: [{ field: "상태", op: "eq", value: "취소" }] }] } },
        { id: "save", type: "fileWrite", name: "파일에 남기기", config: { data: "{{ $input.rows }}", target: { name: "취소 주문", format: "csv", mode: "append" } } },
      ],
      edges: [{ from: "open", to: "wait" }, { from: "wait", to: "list" }, { from: "list", to: "pick" }, { from: "pick", to: "save" }],
    },
  },
];
