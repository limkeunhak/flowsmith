/**
 * 사람 말로 옮기기 — 동작 · 위치 · 노드 한 줄 요약. HTML을 몰라도 읽히게.
 */
import { humanTemplate } from "./graph.ts";
import { FORMAT_LABEL, HUMAN_TIMEOUT, WALLET_APPROVE_TIMEOUT, fileNameFor, readFileName, type ConditionOp, type Flow, type FlowNode, type Locator, type TransformStep, type WebAction } from "@flowsmith/core";

/** 동작의 이름 — core에 하나(문제 문장도 같은 말을 쓴다) */
export { ACTION_LABEL } from "@flowsmith/core";
import { ACTION_LABEL } from "@flowsmith/core";

const q = (s: string) => (s.trim() === "" ? "(비어 있음)" : s);

/**
 * 받침을 보고 조사를 고른다 — 「버튼을」 · 「상태를」 · 「칸으로」 · 「주소로」.
 * 끝 글자가 한글이 아니면(`}}` · 영문) 「을(를)」처럼 둘 다 적는다 — 틀리게 붙이느니 낫다.
 */
export function josa(word: string, pair: "을를" | "이가" | "으로"): string {
  const ch = word.trim().replace(/['"」』»)\]]+$/u, "").slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  const both = { 을를: "을(를)", 이가: "이(가)", 으로: "(으)로" }[pair];
  if (Number.isNaN(code) || code < 0 || code > 11171) return `${word}${both}`;
  const jong = code % 28;
  if (pair === "으로") return `${word}${jong === 0 || jong === 8 ? "로" : "으로"}`;  // ㄹ받침은 「로」
  return `${word}${jong === 0 ? pair[1] : pair[0]}`;
}

const opt = (a: WebAction) => (a.optional ? "(있으면) " : "");
export const OP_WORD: Record<ConditionOp, string> = {
  eq: "=", ne: "≠", contains: "에 포함", notContains: "에 없음", startsWith: "로 시작", endsWith: "로 끝남", matches: "~",
  empty: "비어 있음", notEmpty: "비어 있지 않음", gt: ">", gte: "≥", lt: "<", lte: "≤", isTrue: "참", isFalse: "거짓",
};
const bare = (t: string) => t.replace(/\{\{\s*|\s*\}\}/g, "");
type H = (t: string) => string;
const when = (a: WebAction, h: H | null) => {
  const w = h ?? bare;
  return a.when ? `(${w(a.when.left)} ${OP_WORD[a.when.op]}${a.when.right !== null ? ` ${w(a.when.right)}` : ""} 이면) ` : "";
};

/**
 * 동작 하나를 사람 말로 — HTML을 몰라도 읽히게.
 * ctx를 주면 값 속의 {{ }}도 사람 말로(「«실행 입력 › 주문번호»를 넣습니다」)
 */
export function describeAction(a: WebAction, ctx?: { flow: Flow; nodeId: string }): string {
  const h: H | null = ctx ? (t) => humanTemplate(t, ctx.flow, ctx.nodeId) : null;
  return when(a, h) + describeBare(a, h ?? ((t) => t));
}

function describeBare(a: WebAction, h: H): string {
  switch (a.kind) {
    case "goto": return `${josa(q(h(a.url)), "으로")} 갑니다`;
    case "click": return `${opt(a)}${josa(q(a.target.label), "을를")} 누릅니다${a.popup ? " — 새 창으로 옮겨 갑니다" : ""}${a.dialog ? ` — 확인창${a.dialog.expect ? `(${q(a.dialog.expect)})` : ""}에 ${a.dialog.accept ? "«확인»" : "«취소»"}` : ""}`;
    case "fill": return `${q(a.target.label)}에 ${josa(q(h(a.value)), "을를")} 넣습니다`;
    case "select": return `${q(a.target.label)}에서 ${josa(q(h(a.value)), "을를")} 고릅니다`;
    case "check": return `${josa(q(a.target.label), "을를")} ${a.checked ? "켭니다" : "끕니다"}`;
    case "press": return `${a.target ? `${q(a.target.label)}에서 ` : ""}${a.key} 키를 누릅니다`;
    case "wait": {
      const w = a.wait;
      return w.kind === "fixed" ? `${w.ms / 1000}초 기다립니다`
        : w.kind === "visible" ? `${josa(q(w.target.label), "이가")} 보일 때까지 기다립니다`
        : w.kind === "hidden" ? `${josa(q(w.target.label), "이가")} 사라질 때까지 기다립니다`
        : w.kind === "filled" ? `${q(w.target.label)}에 값이 찰 때까지 기다립니다`
        : w.kind === "stable" ? `${q(w.target.label)}의 값이 ${w.ms / 1000}초 동안 그대로일 때까지 기다립니다`
        : w.kind === "changed" ? `${q(w.target.label)}의 값이 바로 앞 동작 전과 달라질 때까지 기다립니다`
        : w.kind === "url" ? `주소가 /${w.pattern}/ 에 맞을 때까지 기다립니다`
        : "네트워크가 잠잠해질 때까지 기다립니다";
    }
    case "read": return `${josa(q(a.target.label), "을를")} ${a.transform === "number" ? "숫자로 " : ""}읽어 ${josa(`「${q(a.output)}」`, "으로")} 내보냅니다`;
    case "readTable": return `${q(a.table.label)} 표를 ${a.table.scroll ? "스크롤하며 " : ""}읽어 ${josa(`「${q(a.output)}」`, "으로")} 내보냅니다`;
    case "closeWindow": return "이 창을 닫고 연 창으로 돌아갑니다";
    case "switchWindow": return "새로 열린 창으로 옮겨 갑니다";
    case "recheck": return "이 창에 넣은 칸이 그대로인지 다시 보고, 바뀐 칸은 한 번 다시 넣습니다";
    case "pickRow": {
      const p = a.pick;
      const which = p.by === "index"
        ? (/^-\d+$/.test(p.value.trim()) ? (p.value.trim() === "-1" ? "마지막 행" : `끝에서 ${p.value.trim().slice(1)}번째 행`) : `${q(h(p.value))}번째 행`)
        : `${p.keyLabel || "키"}가 ${q(h(p.value))}인 행`;
      return `${q(p.label)}에서 ${which}을 고릅니다${p.refuse ? ` — ${p.refuse.values.join("·")}이면 멈춥니다` : ""}`;
    }
    case "assert": return `${josa(q(a.target.label), "이가")} 「${q(h(a.equals))}」인지 확인합니다 — 아니면 멈춥니다`;
    case "human": {
      const d = a.done;
      const until = d.kind === "hidden" ? `${josa(q(d.target.label), "이가")} 사라지면` : d.kind === "visible" ? `${josa(q(d.target.label), "이가")} 보이면` : `주소가 /${d.pattern}/ 에 맞으면`;
      const minutes = Math.round((a.timeoutMs ?? HUMAN_TIMEOUT.defaultMs) / 60_000 * 10) / 10;
      return `${a.appears ? `${josa(q(a.appears.label), "이가")} 보일 때만 ` : ""}사람을 기다립니다 — «${a.prompt}» · ${until} 이어 갑니다(${minutes}분까지)`;
    }
    case "save": return `${a.source === "url" ? `${josa(q(h(a.url)), "을를")} 이 브라우저의 로그인으로 받아` : "지금 페이지를 PDF로 찍어"} ${q(h(a.path))}에 저장합니다${a.skipExisting ? "(이미 있으면 건너뜀)" : ""}`;
    case "walletApprove": {
      const d = a.done;
      const until = d.kind === "hidden" ? `${josa(q(d.target.label), "이가")} 사라질` : d.kind === "visible" ? `${josa(q(d.target.label), "이가")} 보일` : `주소가 /${d.pattern}/ 에 맞을`;
      const minutes = Math.round((a.timeoutMs ?? WALLET_APPROVE_TIMEOUT.defaultMs) / 60_000 * 10) / 10;
      return `MetaMask 화면(연결 · 서명 · 목록 안 체인)을 승인합니다 — ${until} 때까지(${minutes}분까지)`;
    }
  }
}

const STEP_TITLE: Record<TransformStep["kind"], string> = { pick: "칸 고르기", filter: "거르기", dedupe: "겹침 빼기", map: "값 바꾸기", format: "형식", sort: "정렬", limit: "앞 n개" };
const stepTitle = (s: TransformStep) => STEP_TITLE[s.kind];

/** 값 다듬기 단계 한 줄 — 「「상태」에 포함 「완료」인 행만」 */
export function describeStep(s: TransformStep): string {
  const f = (x: string) => (x.trim() === "" ? "(칸?)" : `「${x}」`);
  switch (s.kind) {
    case "pick": return s.fields.length ? `${s.fields.map((x) => (x.to.trim() && x.to !== x.from ? `${x.from} → ${x.to}` : x.from)).join(" · ")}만 남깁니다` : "남길 칸을 고르세요";
    case "filter": return s.rules.length ? `${s.rules.map((r) => `${f(r.field)}${/^[에로]/.test(OP_WORD[r.op]) ? "" : " "}${OP_WORD[r.op]}${r.value !== null ? ` 「${r.value}」` : ""}`).join(s.match === "all" ? " 그리고 " : " 또는 ")}인 행만` : "조건을 정하세요";
    case "dedupe": return s.fields.length ? `${s.fields.map(f).join(" · ")}이(가) 같으면 한 행만` : "모든 칸이 같은 행은 한 행만";
    case "map": return `${f(s.field)} 값을 표대로 바꿉니다(${s.table.filter((e) => e.from.trim()).length}개)`;
    case "format": return `${f(s.field)} — ${s.as === "replace" ? `「${s.find}」→「${s.replace}」` : FORMAT_LABEL[s.as].replace(/\(.*\)$/, "")}`;
    case "sort": return `${f(s.field)} ${s.order === "asc" ? "작은 것부터" : "큰 것부터"}`;
    case "limit": return `앞에서 ${s.count}개만`;
  }
}

export const describeLocator = (l: Locator): string =>
  l.kind === "role" ? `역할 ${l.value}${l.name ? ` «${l.name}»` : ""}`
  : ({ testid: "테스트 id", label: "칸 이름", placeholder: "안내 글자", text: "글자", css: "CSS", xpath: "XPath" } as const)[l.kind] + ` ${l.value}`;

/** 노드 아래 한 줄 — 무엇을 하는 노드인지 */
export function subtitleOf(n: FlowNode): string {
  switch (n.type) {
    case "web": {
      const c = n.config.actions.length;
      // 사람 기다리기뿐 — 그 안내 문구 · 접속만 — 그 주소(split.ts webFace와 같은 판단)
      if (c > 0 && n.config.actions.every((a) => a.kind === "human")) return n.config.actions.map((a) => (a.kind === "human" ? `🙋 ${a.prompt}` : "")).join(" · ");
      if (c === 0 && n.config.start.kind === "url") return n.config.start.url ? `접속 · ${n.config.start.url.replace(/^https?:\/\//, "")}` : "접속 · 주소를 넣으세요";
      return `${n.config.start.kind === "continue" ? "이어서 · " : ""}동작 ${c}개`;
    }
    case "condition": return `갈래 ${n.config.cases.length + 1}개`;
    case "custom": return n.config.usesPage ? "코드 · 페이지 사용" : "코드";
    case "extension": return `확장 · ${n.config.extension}`;
    case "fileRead": {
      const s = n.config.source;
      const from = s.scope === "otherFlow" ? `${s.flowId ?? "?"} · ` : s.scope === "shared" ? "공유 · " : "";
      return `${from}${readFileName(s, new Date()) ?? `${s.name} 가장 최근`}`;
    }
    case "flowCall": return `${n.config.flowId || "(워크플로우 없음)"}${n.config.items ? " · 행마다" : ""}`;
    case "check": return `검사 ${n.config.items.length}개`;
    case "approval": return `${({ runner: "실행자", editor: "편집자", admin: "관리자" } as const)[n.config.minRole]} 이상이 승인`;
    case "transform": return n.config.steps.length ? n.config.steps.map(stepTitle).join(" → ") : "단계 없음";
    case "http": {
      const u = n.config.url.trim();
      let host = u;
      try { host = new URL(u).host; } catch { /* 표현식 · 아직 비었음 */ }
      return `${n.config.method} ${host || "(주소 없음)"}`;
    }
    case "fileWrite": return `파일 · ${fileNameFor(n.config.target, new Date())}${n.config.target.mode === "overwrite" ? " · 덮어쓰기" : ""}`;
  }
}

