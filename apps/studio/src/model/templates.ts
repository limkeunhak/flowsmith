/**
 * **템플릿** — «무엇을 자동화할까요?»에서 고르면, 몇 가지만 물어보고 플로우를 짜 둔다(PLAN §18).
 *
 * ★템플릿은 **뼈대**다 — 웹페이지 노드의 동작은 비워 둔다. 사람이 녹화해서 채운다(사이트마다 다르다).
 *  나머지(다듬기 · 파일 쓰기 · 알림 · 일정)는 채워 둔다. 남은 일은 편집 화면의 «다음 할 일»이 알려 준다.
 * ★id는 사람이 짓지 않는다 — 이름과 상관없이 짧은 무작위 id를 붙인다(주소에만 쓰인다).
 */
import type { Flow, FlowNode, NotifyRule, Schedule } from "@flowsmith/core";
import { newParam, normalize } from "./nodes.ts";

export type AskKind = "url" | "text" | "email" | "schedule" | "flow";

export interface Ask {
  key: string;
  label: string;
  kind: AskKind;
  placeholder?: string;
  hint?: string;
  required: boolean;
}

/** 파일 쓰기 노드가 있는 플로우 — 그 노드들이 쓰는 파일 이름 · 형식 */
export interface FlowChoice { id: string; name: string; files: { name: string; format: "csv" | "jsonl" | "json" | "text" }[] }

export interface Template {
  id: string;
  title: string;
  desc: string;
  /** 무엇이 만들어지나 — 카드에 한 줄씩 */
  steps: string[];
  asks: Ask[];
  /** 만들 플로우들 — 마지막이 열 플로우(다른 플로우를 부르는 템플릿은 부를 쪽을 먼저 만든다) */
  build(a: Record<string, string>, name: string, ctx: { newId: (base: string) => string; flows: FlowChoice[] }): Flow[];
}

/** 일정 고르기 — 사람 말 → cron */
export const SCHEDULE_CHOICES: { label: string; cron: string | null }[] = [
  { label: "매일 아침 9시", cron: "0 9 * * *" },
  { label: "평일 아침 9시", cron: "0 9 * * 1-5" },
  { label: "매일 저녁 6시", cron: "0 18 * * *" },
  { label: "매시 정각", cron: "0 * * * *" },
  { label: "30분마다", cron: "*/30 * * * *" },
  { label: "정하지 않음(손으로 돌림)", cron: null },
];

const rand = () => Math.random().toString(36).slice(2, 6);
/** 짧은 무작위 id — 「news-k3x9」 */
export const newFlowId = (base: string, taken: Iterable<string> = []): string => {
  const set = new Set(taken);
  for (;;) { const id = `${base}-${rand()}`; if (!set.has(id)) return id; }
};

const pos = (x: number, y = 0) => ({ x, y });
const schedule = (cron: string | null): Schedule[] => (cron ? [{ id: "s1", cron, params: {}, enabled: true }] : []);
const cronOf = (label: string | undefined) => SCHEDULE_CHOICES.find((c) => c.label === label)?.cron ?? null;
const mail = (to: string, attach: boolean, on: NotifyRule["on"]): NotifyRule[] =>
  [{ id: "n1", on, channel: "email", url: to.trim(), attach, firstOnly: true, enabled: true }];
const web = (id: string, name: string, url: string, x: number): FlowNode =>
  ({ id, name, position: pos(x), type: "web", config: { start: { kind: "url", url: url.trim() }, actions: [] } });
const edge = (id: string, from: string, to: string) => ({ id, from: { node: from, port: "out" }, to: { node: to } });

const flow = (id: string, name: string, description: string, nodes: FlowNode[], edges: ReturnType<typeof edge>[], extra: Partial<Flow> = {}): Flow =>
  normalize({ schemaVersion: 1, id, name, description, nodes, edges, ...extra });

export const TEMPLATES: Template[] = [
  {
    id: "collect-mail",
    title: "매일 목록 모아 메일로 받기",
    desc: "뉴스 · 검색 결과 · 게시판처럼 되풀이되는 목록을 정한 시각마다 모아, 겹치는 것은 빼고 쌓아 두고, 엑셀로 메일을 받습니다.",
    steps: ["목록 읽기(녹화)", "다듬기 — 겹침 빼기", "파일로 쌓기(날짜별)", "메일 — 엑셀 첨부"],
    asks: [
      { key: "url", label: "목록이 있는 페이지 주소", kind: "url", placeholder: "https://search.naver.com/…", required: true, hint: "검색어를 넣고 정렬까지 한 뒤의 주소를 붙여 넣으면 녹화가 짧아집니다" },
      { key: "when", label: "언제 모을까요", kind: "schedule", required: true },
      { key: "to", label: "받는 메일", kind: "email", placeholder: "kim@example.com", required: false, hint: "여럿이면 쉼표로 — 나중에 알림에서 바꿀 수 있습니다" },
    ],
    build: (a, name, { newId }) => [flow(newId("collect"), name, "목록을 모아 겹치는 것은 빼고 날짜별 파일로 쌓고, 엑셀로 메일을 보냅니다", [
      web("read", "목록 읽기", a["url"] ?? "", 0),
      { id: "tidy", name: "겹침 빼기", position: pos(320), type: "transform", config: { source: "", steps: [{ kind: "dedupe", fields: [] }] } },
      { id: "save", name: "파일로 쌓기", position: pos(640), type: "fileWrite", config: { data: "{{ $input.rows }}", target: { kind: "file", scope: "flow", dir: "", name: "목록", format: "csv", mode: "append", rolling: { kind: "time", unit: "day" }, csv: { header: true, bom: true, columns: null }, dedupeKey: null, stampColumn: "모은시각", keepDays: 90 } } },
    ], [edge("e1", "read", "tidy"), edge("e2", "tidy", "save")], {
      settings: { ...normalize({}).settings, schedules: schedule(cronOf(a["when"])), notify: mail(a["to"] ?? "", true, ["success", "failure", "drift"]), monitorIntervalMin: 24 * 60 },
    })],
  },
  {
    id: "read-excel",
    title: "사이트에서 값 읽어 엑셀로 쌓기",
    desc: "가격 · 환율 · 재고 · 상태처럼 화면의 값 몇 개를 정한 때마다 읽어 한 줄씩 쌓습니다. 언제든 엑셀로 받습니다.",
    steps: ["값 읽기(녹화)", "파일로 쌓기 — 한 번에 한 줄", "실패하면 메일"],
    asks: [
      { key: "url", label: "값이 있는 페이지 주소", kind: "url", placeholder: "https://…", required: true },
      { key: "when", label: "언제 읽을까요", kind: "schedule", required: true },
      { key: "to", label: "실패하면 알릴 메일", kind: "email", placeholder: "kim@example.com", required: false },
    ],
    build: (a, name, { newId }) => [flow(newId("watch"), name, "화면의 값을 읽어 한 줄씩 쌓습니다", [
      web("read", "값 읽기", a["url"] ?? "", 0),
      { id: "save", name: "한 줄 쌓기", position: pos(320), type: "fileWrite", config: { data: "{{ $input }}", target: { kind: "file", scope: "flow", dir: "", name: "기록", format: "csv", mode: "append", rolling: { kind: "time", unit: "month" }, csv: { header: true, bom: true, columns: null }, dedupeKey: null, stampColumn: "읽은시각", keepDays: null } } },
    ], [edge("e1", "read", "save")], {
      settings: { ...normalize({}).settings, schedules: schedule(cronOf(a["when"])), notify: a["to"]?.trim() ? mail(a["to"], false, ["failure", "recovered", "drift"]) : [] },
    })],
  },
  {
    id: "per-row",
    title: "모은 목록의 행마다 다른 사이트에 입력하기",
    desc: "다른 워크플로우가 모아 둔 목록(파일)을 읽어, 행마다 한 건씩 입력합니다. 한 건 입력은 따로 워크플로우로 만들어 녹화합니다 — 행마다 실행 기록이 남습니다.",
    steps: ["목록 파일 읽기", "행마다 «한 건 입력» 워크플로우 부르기", "한 건 입력(녹화)"],
    asks: [
      { key: "from", label: "목록을 모으는 워크플로우", kind: "flow", required: true, hint: "파일 쓰기 노드가 있는 워크플로우만 보입니다" },
      { key: "url", label: "입력할 사이트 주소", kind: "url", placeholder: "https://…", required: true },
      { key: "cols", label: "한 건에 쓸 칸 이름들", kind: "text", placeholder: "주문번호, 이름", required: true, hint: "목록 파일의 열 이름(CSV 첫 줄)과 같게 — 쉼표로" },
    ],
    build: (a, name, { newId, flows }) => {
      const cols = (a["cols"] ?? "").split(/[,，]/).map((s) => s.trim().replace(/[^\p{L}\p{N}_]/gu, "_")).filter(Boolean);
      const src = flows.find((f) => f.id === a["from"]);
      const childId = newId("one");
      const child = flow(childId, `${name} — 한 건`, "목록의 한 행을 받아 사이트에 입력합니다(행마다 이 워크플로우가 불립니다)",
        [web("input", "한 건 입력", a["url"] ?? "", 0)], [],
        { params: cols.map((c) => newParam({ name: c, label: c })), settings: { ...normalize({}).settings, probeParams: {} } });
      const parent = flow(newId("each"), name, "모은 목록을 읽어 행마다 «한 건» 워크플로우를 부릅니다", [
        { id: "list", name: "목록 읽기", position: pos(0), type: "fileRead", config: { source: { scope: "otherFlow", flowId: a["from"] ?? null, dir: "", name: src?.files[0]?.name ?? "목록", format: src?.files[0]?.format ?? "csv", pick: { kind: "latest" }, csv: { header: true } }, missing: "fail", maxRows: null } },
        { id: "each", name: "행마다 입력", position: pos(320), type: "flowCall", config: { flowId: childId, version: "draft", items: "{{ $input.rows }}", params: Object.fromEntries(cols.map((c) => [c, `{{ $item.${c} }}`])), concurrency: 1, onError: "continue" } },
      ], [edge("e1", "list", "each")]);
      return [child, parent];
    },
  },
];
