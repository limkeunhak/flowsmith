/**
 * **AI에게 주는 설명서**(시스템 프롬프트) — 워크플로우의 모양 · 규칙 · 지금 이 서버에 있는 것(확장 · 다른 워크플로우 · 시크릿 이름).
 * ★«노드 종류»와 예시는 ai/catalog.ts에서 만든다 — 시험이 예시를 진짜 길(ai/build.ts · 검문소)로 돌려 보니 core와 어긋나지 않는다.
 * ★커스텀 코드 노드는 쓰지 않는다(사용자 결정 2026-10-20) · 웹페이지의 «어느 요소»는 AI가 지어내지 않는다 —
 *  이미 검증된 요소(ai/refs.ts — 같은 사이트의 녹화)가 있으면 from으로 다시 쓰고, 없으면 이름만 붙인 빈 자리로 둔다(사람이 녹화로).
 */
import type { Flow } from "@flowsmith/core";
import type { ExtensionMeta } from "../ext-meta.ts";
import { EXAMPLES, NODE_DOCS } from "./catalog.ts";
import { refLines, type RefElement } from "./refs.ts";

export interface SpecContext {
  /** 고치는 중인 초안 — 새로 만들 때는 null */
  draft: Flow | null;
  extensions: ExtensionMeta[];
  /** 다른 워크플로우 실행 노드가 부를 수 있는 것 */
  flows: { id: string; name: string }[];
  /** 다시 쓸 수 있는 요소(ai/refs.ts) — 같은 사이트의 녹화 */
  refs?: RefElement[];
  /** 앞 말에서 본 화면의 요소(p …) */
  pageRefs?: RefElement[];
  /** 사이트를 볼 수 있나(open_page · look_page — 관리자가 켰을 때만) */
  browse?: boolean;
}

const GUIDE = `
당신은 Flowsmith(웹 업무 자동화 도구 — n8n과 비슷한 노드 · 선 워크플로우)의 도우미입니다. 사용자는 대개 개발자가 아닙니다.
사용자의 말을 듣고 워크플로우를 만들거나 고치고, 물으면 설명합니다. 답은 늘 한국어로, 짧고 쉬운 말로 합니다.

## 일하는 법
- 워크플로우를 만들거나 바꿀 때는 **propose_flow 도구에 워크플로우 전체**(nodes · edges 모두)를 넣어 부릅니다. 고친 부분만 보내지 않습니다.
- 도구가 문제를 돌려주면 고쳐서 다시 부릅니다. 받아들여지면 무엇을 만들었는지 · 사람이 할 일(녹화 등)을 두세 줄로 말하고 끝냅니다.
- 설명만 원하면 도구를 부르지 않고 답합니다.
- 이미 있는 노드는 id를 그대로 두고, 사용자가 말하지 않은 노드 · 설정은 바꾸지 않습니다.
- 모르는 값(사이트 주소 · 메일 주소 등)은 지어내지 말고 실행 입력(params)으로 받게 하거나 사용자에게 묻습니다.

## 지켜야 할 것
- ★커스텀 코드 노드(type "custom")는 만들지도 고치지도 않습니다(관리 정책). 코드 없이 되는 노드(값 다듬기 · 조건 · HTTP 등)를 씁니다.
- ★시크릿(비밀번호 · 토큰)의 값은 절대 적지 않습니다. secrets에 이름 · 종류만 정의하고 {{ $secrets.이름 }}으로 씁니다. 값은 사람이 화면에서 넣습니다.
- ★웹페이지에서 «어느 단추 · 칸»인지는 지어내지 않습니다. 아래 «다시 쓸 수 있는 요소»에 맞는 것이 있으면 동작에 **"from": "r3"**처럼 그 ref를 적습니다(이름 · 값 · output은 따로 적어도 됩니다).
  없으면 **이름(label)만 붙인 빈 자리**로 둡니다 — 사람이 녹화로 채웁니다. 목록에 없는 ref는 받지 않습니다.
- 게시 · 실행은 하지 않습니다(사람이 확인하고 합니다).

## 모양(JSON)
워크플로우: { "name": "...", "description": "...", "params": [...], "nodes": [...], "edges": [...], "secrets": [...], "vars": {...}, "notes": [...], "settings": {...} }
- params(실행 입력): { "name": "orderNo", "label": "주문번호", "required": true, "type": "text|number|date|select", "options": [], "default": "", "help": "" }
- secrets: { "name": "portal", "kind": "login|text", "description": "쇼핑몰 관리자 계정" } — login이면 {{ $secrets.portal.username }} · {{ $secrets.portal.password }}
- vars: 고정 값 { "siteUrl": "https://..." } → {{ $vars.siteUrl }}
- settings에서 쓸 만한 것: "schedules": [{ "id": "s1", "cron": "0 9 * * 1-5", "params": {}, "enabled": true }], "notify": [{ "id": "n1", "on": ["failure"], "channel": "slack|teams|webhook|email", "url": "", "enabled": true }]
- nodes: { "id": "영문으로 시작(예: read1)", "type": "...", "name": "사람이 읽을 이름", "config": {...} } — 위치(position)는 비워 두면 화면이 늘어놓습니다
- edges: { "from": "노드 id", "to": "노드 id", "port": "out" } — port는 보통 "out"(생략 가능). 조건 노드는 갈래 id 또는 "else"
- notes(캔버스 메모): { "text": "사람이 할 일 · 설명", "near": "노드 id" } — 녹화가 필요한 웹페이지 노드 옆에 할 일을 적어 두면 좋습니다

## 값 쓰기(표현식)
- 앞 노드가 내놓은 값: {{ $input.이름 }} — 앞 노드의 출력 이름이어야 합니다(웹페이지 노드는 read · readTable의 output, 다른 노드는 아래 «내놓는 것»)
- 실행 입력 {{ $params.x }} · 변수 {{ $vars.x }} · 시크릿 {{ $secrets.x }} · 다른 워크플로우를 행마다 돌릴 때의 그 행 {{ $item.칸 }}
- 글 안에 섞어 써도 됩니다: "주문 {{ $params.orderNo }} 결과"

`.trim();

/** «노드 종류» — catalog의 예시에서 */
export function nodeGuide(): string {
  return `## 노드 종류\n${NODE_DOCS.map((d) => `- **${d.type}** ${d.title} — config 예: ${JSON.stringify(d.config)}${d.more ? `\n  ${d.more}` : ""}\n  내놓는 것: ${d.outputs}`).join("\n")}`;
}

/** 잘 만든 예(few-shot) */
export function exampleGuide(): string {
  return `## 잘 만든 예\n${EXAMPLES.map((e, i) => `### 예 ${i + 1} — «${e.ask}»\npropose_flow의 flow: ${JSON.stringify(e.flow)}`).join("\n\n")}`;
}

export function systemPrompt(ctx: SpecContext): string {
  const exts = ctx.extensions.length
    ? ctx.extensions.map((e) => `- ${e.id} «${e.title}» — ${e.description}${e.options.length ? ` · options: ${e.options.map((o) => `${o.name}(${o.label}${o.required ? ", 필수" : ""})`).join(", ")}` : ""} · 내놓는 것: ${e.outputs.join(", ") || "없음"}`).join("\n")
    : "(설치된 확장 없음 — extension 노드는 쓰지 않습니다)";
  const flows = ctx.flows.length ? ctx.flows.slice(0, 80).map((f) => `- ${f.id} «${f.name}»`).join("\n") : "(없음)";
  const now = ctx.draft
    ? `## 지금 고치는 워크플로우(JSON)\n${JSON.stringify(compact(ctx.draft))}`
    : "## 지금\n새 워크플로우를 만듭니다.";
  const all = [...(ctx.refs ?? []), ...(ctx.pageRefs ?? [])];
  const refs = all.length
    ? `## 다시 쓸 수 있는 요소(from으로 — 이미 녹화했거나 화면에서 하나로 확인한 것)\n${refLines(all)}`
    : "## 다시 쓸 수 있는 요소\n(아직 없음 — 웹페이지 동작은 이름만 붙인 빈 자리로)";
  const site = ctx.browse
    ? "## 사이트 보기(쓸 수 있음)\n사이트 주소를 알면 **먼저 open_page로 열어** 화면의 요소(p1 …)를 보고, 동작에 from으로 씁니다. 화면이 바뀌면 look_page. " +
      "**act로 직접 누르고 넣으며 다음 화면으로 갑니다** — 사람이 녹화하듯 워크플로우의 동작 순서대로 해 보고, 그때 본 요소(p…)를 그 동작의 from으로 씁니다. " +
      "로그인은 시크릿({{ $secrets.이름.username }} · .password — 값은 서버가 넣는다)으로 해 봅니다. 시크릿 값이 없거나(새 워크플로우) 본인 인증 · 캡차면 «사람 기다리기»를 넣고 그 뒤는 이름만 붙인 빈 자리로 둡니다. " +
      "되돌릴 수 없어 보이는 단추(저장 · 제출 · 결제 · 삭제 …)는 누르지 않습니다 — 동작으로만 넣습니다(실행 때 사람이 확인). " +
      "제안이 받아들여지면 **try_flow로 돌려 보고**, 실패하면 고쳐서 다시 냅니다. 주소를 모르면 지어내지 말고 묻습니다."
    : "## 사이트 보기\n(관리자가 켜지 않았습니다 — 사이트를 열어 볼 수 없습니다)";
  return `${GUIDE}\n\n${nodeGuide()}\n\n${exampleGuide()}\n\n## 이 서버의 확장\n${exts}\n\n## 다른 워크플로우(flowCall이 부를 수 있는 것)\n${flows}\n\n${site}\n\n${refs}\n\n${now}`;
}

/** 모델에 보일 초안 — 웹 동작의 요소(선택자 · 지문)는 빼고 이름만(크기를 줄이고, 바꾸지 말 것을 바꾸지 않게) */
export function compact(f: Flow): unknown {
  return {
    name: f.name, description: f.description, params: f.params, vars: f.vars, secrets: f.secrets.map((s) => ({ name: s.name, kind: s.kind, description: s.description })),
    settings: { schedules: f.settings.schedules, notify: f.settings.notify.map((r) => ({ ...r, url: r.url ? "(설정됨)" : "" })) },
    nodes: f.nodes.map((n) => n.type === "web"
      ? { id: n.id, type: n.type, name: n.name, config: { start: n.config.start, actions: n.config.actions.map((a) => ({ id: a.id, kind: a.kind, ...("target" in a && a.target ? { label: a.target.label } : {}), ...("output" in a ? { output: a.output } : {}), ...("value" in a ? { value: a.value } : {}), ...("url" in a ? { url: a.url } : {}) })) } }
      : n.type === "custom" ? { id: n.id, type: n.type, name: n.name, config: "(커스텀 코드 — 바꾸지 마세요)" }
      : { id: n.id, type: n.type, name: n.name, config: n.config }),
    edges: f.edges.map((e) => ({ from: e.from.node, to: e.to.node, port: e.from.port })),
    notes: f.notes.map((n) => ({ text: n.text })),
  };
}

export interface Tool { name: string; description: string; input_schema: Record<string, unknown> }

/** 모델이 부르는 도구 — 제안 하나 · 사이트 보기(관리자가 켰을 때) 둘 */
export const TOOLS: Tool[] = [{
  name: "propose_flow",
  description: "워크플로우 전체를 제안합니다. 화면이 검문소로 확인해 문제가 있으면 돌려줍니다 — 고쳐서 다시 부르세요. 받아들여지면 사람이 «바뀐 것»을 보고 적용합니다.",
  input_schema: {
    type: "object",
    properties: {
      flow: { type: "object", description: "워크플로우 전체(name · params · nodes · edges · secrets · vars · notes · settings)" },
      summary: { type: "string", description: "무엇을 만들었거나 바꿨는지 한두 줄" },
    },
    required: ["flow", "summary"],
  },
}];
export const BROWSE_TOOLS: Tool[] = [
  { name: "open_page", description: "사이트 주소를 열어 화면 요약(누를 것 · 넣을 칸 · 고를 것 · 읽을 글자 · 표 — 요소마다 ref p…)을 받습니다. 로그인하지 않은 새 브라우저입니다.", input_schema: { type: "object", properties: { url: { type: "string", description: "http(s) 주소" } }, required: ["url"] } },
  { name: "look_page", description: "지금 연 화면을 다시 요약합니다.", input_schema: { type: "object", properties: {} } },
];
/** 3단계 — 직접 해 보기 · 돌려 보기 */
export const ACT_TOOLS: Tool[] = [
  { name: "act", description: "지금 화면에서 한 가지를 합니다 — ref 요소를 누르기(click) · 넣기(fill) · 고르기(select) · 키(press). 다음 화면의 요약이 돌아옵니다. 되돌릴 수 없어 보이는 단추(저장 · 제출 · 결제 · 삭제 …)는 누르지 않습니다. 비밀번호 등은 value에 \"{{ $secrets.이름.password }}\"처럼 — 값은 서버가 넣습니다. 실행 입력 자리에는 시험 값을 그대로 넣습니다.",
    input_schema: { type: "object", properties: { ref: { type: "string", description: "p… 또는 r…" }, action: { type: "string", enum: ["click", "fill", "select", "press"] }, value: { type: "string" }, key: { type: "string", description: "press일 때 — Enter 등" } }, required: ["action"] } },
  { name: "try_flow", description: "받아들여진 마지막 제안을 점검 실행으로 돌려 봅니다(되돌릴 수 없는 동작 앞에서 멈춤 · 요소를 녹화 때와 견줌). 실패하면 무엇이 틀렸는지 돌아옵니다 — 고쳐서 다시 제안하세요.",
    input_schema: { type: "object", properties: { params: { type: "object", description: "실행 입력의 시험 값" } } } },
];
export const toolsFor = (browse: boolean, act = false): Tool[] => (browse ? [...TOOLS, ...BROWSE_TOOLS, ...(act ? ACT_TOOLS : [])] : TOOLS);
