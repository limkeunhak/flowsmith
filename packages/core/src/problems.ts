/**
 * **문제를 사람 말로** — 검문소(parse/*)가 모은 문장을 화면 · 알림에 보일 말로 바꾼다 (PLAN §27).
 *
 *   검문소   「노드 web1.actions[2].target: label가 비었습니다」   ← 위치는 코드 경로, 칸은 영어 키
 *   사람     «웹페이지 1» › 3번째 동작(넣기) — 넣을 곳을 아직 고르지 않았습니다. 녹화하거나 «요소 고르기»로 고르세요
 *
 * ★검문소의 문장은 그대로 둔다 — API · 시험이 기댄다. 여기는 보여 주는 층이다(순수).
 * ★같은 까닭이 두 줄로 나오면(대상의 이름과 찾는 법이 함께 빔) 한 줄로 합친다.
 */
import { ACTION_LABEL as ACTIONS, NODE_TYPE_LABEL as TYPES } from "./labels.ts";

const ACTION_LABEL = ACTIONS as Record<string, string>;
const NODE_TYPE_LABEL = TYPES as Record<string, string>;

export interface ProblemView {
  /** 이 문제가 붙은 노드 — 없으면 플로우 전체 */
  nodeId: string | null;
  /** 어디 — «웹페이지 1» › 3번째 동작(넣기). 플로우 전체면 «플로우 설정» 등 */
  where: string;
  /** 무엇이 · 어떻게 */
  text: string;
  /** 검문소의 원래 문장 */
  raw: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

/** 받침이 있나 — 조사(이/가 · 을/를 · 은/는)를 고른다. 한글이 아니면 null */
function batchim(word: string): boolean | null {
  // 「시간(ms)」처럼 괄호로 끝나면 괄호 앞 말로 고른다
  const ch = word.trim().replace(/\s*\([^()]*\)$/, "").slice(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return "013678".includes(ch);
  return null;
}
const josa = (word: string, withB: string, without: string) => { const b = batchim(word); return word + (b === null ? `${withB}(${without})` : b ? withB : without); };
const iga = (w: string) => josa(w, "이", "가");
const eunneun = (w: string) => josa(w, "은", "는");
const eulreul = (w: string) => josa(w, "을", "를");

/** 칸 이름 — 영어 키를 사람 말로(자리에 따라 다르면 ctx로 고른다) */
function fieldLabel(key: string, ctx: string[]): string {
  const last = ctx[ctx.length - 1] ?? "";
  switch (key) {
    case "url": return "주소";
    case "value": return last === "locators" ? "찾는 법(선택자)" : last === "action:fill" || last === "action:select" ? "넣을 값" : "값";
    case "label": return ctx.includes("table") ? "표 이름" : ctx.includes("target") ? "요소 이름" : "이름";
    case "output": return "출력 이름";
    case "outputs": return "출력";
    case "name": return ctx.includes("params") ? "실행 입력 이름" : ctx.includes("secrets") ? "시크릿 이름" : ctx.includes("columns") ? "열 이름" : "이름";
    case "selector": return "열 선택자";
    case "left": return "왼쪽 값";
    case "right": return "오른쪽 값";
    case "flowId": return "부를 워크플로우";
    case "source": return "다듬을 목록";
    case "data": return "저장할 값";
    case "code": return "코드";
    case "ms": return "기다릴 시간(ms)";
    case "cron": return "일정";
    case "text": return "글";
    case "equals": return "기대값";
    case "attribute": return "속성 이름";
    case "strategy": return "읽는 법";
    case "retries": return "다시 해 보기 횟수";
    case "offset": return "몇 번째 전";
    case "extension": return "확장";
    case "id": return "id";
    case "kind": return "종류";
    case "type": return "노드 종류";
    case "format": return "파일 형식";
    case "mode": return "쓰는 법";
    case "method": return "방식";
    case "timeoutMs": return "시간 제한";
    case "monitorIntervalMin": return "감시 주기";
    case "runTimeoutMin": return "전체 시간 제한";
    case "description": return "설명";
    default: return key;
  }
}

/** 위치 경로를 마디로 — 「web1.actions[2].target.locators[0]」 → [web1, actions 2, target, locators 0] */
function segments(path: string): { key: string; index: number | null }[] {
  const out: { key: string; index: number | null }[] = [];
  for (const m of path.matchAll(/([^.[\]]+)(?:\[(\d+)\])?/g)) out.push({ key: m[1]!, index: m[2] !== undefined ? Number(m[2]) : null });
  return out;
}

const nth = (i: number) => `${i + 1}번째`;

interface Place { nodeId: string | null; where: string; ctx: string[] }

/** 「노드 web1.actions[2].target」 · 「params[0]」 · 「settings.notify[1]」 … → 사람이 읽는 자리 */
function placeOf(loc: string, flow: Obj | null): Place | null {
  const nodes = flow && Array.isArray(flow["nodes"]) ? (flow["nodes"] as unknown[]).filter(isObj) : [];
  // 「노드 web1.actions[2]」 · 「노드 #3」(id가 틀린 노드) — 「노드 '이름'(id)」(그래프 문장)은 아니다
  const m = /^노드 (#\d+|[A-Za-z][\w-]*)((?:[.[].*)?)$/.exec(loc);
  if (m) {
    const id = m[1]!.startsWith("#") ? null : m[1]!;
    const node = id ? nodes.find((n) => n["id"] === id) : nodes[Number(m[1]!.slice(1))];
    const nodeName = node && typeof node["name"] === "string" && node["name"].trim() ? node["name"] : null;
    const type = node && typeof node["type"] === "string" ? node["type"] : "";
    const parts: string[] = [nodeName ? `«${nodeName}»` : `노드 ${m[1]}`];
    const ctx: string[] = [`node:${type}`];
    const cfg = node && isObj(node["config"]) ? node["config"] : {};
    for (const s of segments(m[2]!)) {
      if (s.key === "config") continue;
      ctx.push(s.key);
      switch (s.key) {
        case "actions": {
          const a = Array.isArray(cfg["actions"]) && s.index !== null ? cfg["actions"][s.index] : undefined;
          const kind = isObj(a) && typeof a["kind"] === "string" ? a["kind"] : "";
          if (kind) ctx.push(`action:${kind}`);
          parts.push(`${s.index !== null ? nth(s.index) : ""} 동작${kind && ACTION_LABEL[kind] ? `(${ACTION_LABEL[kind]})` : ""}`.trim());
          break;
        }
        case "start": parts.push("시작 페이지"); break;
        case "target": parts.push(type === "fileWrite" ? "저장할 곳" : "대상 요소"); break;
        case "locators": case "frames": break;   // 대상 요소 안 — 따로 말하지 않는다
        case "table": parts.push("표"); break;
        case "rows": parts.push("행"); break;
        case "columns": parts.push(s.index !== null ? `${nth(s.index)} 열` : "열"); break;
        case "cases": parts.push(s.index !== null ? `${nth(s.index)} 갈래` : "갈래"); break;
        case "rules": parts.push(s.index !== null ? `${nth(s.index)} 조건` : "조건"); break;
        case "source": parts.push(type === "fileRead" ? "읽을 곳" : "다듬을 목록"); break;
        case "outputs": parts.push(s.index !== null ? `${nth(s.index)} 출력` : "출력"); break;
        case "steps": parts.push(s.index !== null ? `${nth(s.index)} 단계` : "단계"); break;
        case "headers": parts.push(s.index !== null ? `${nth(s.index)} 헤더` : "헤더"); break;
        case "query": parts.push(s.index !== null ? `${nth(s.index)} 쿼리` : "쿼리"); break;
        case "body": parts.push("본문"); break;
        case "pick": parts.push("고를 파일"); break;
        case "rolling": parts.push("파일 나누기"); break;
        case "csv": parts.push("CSV"); break;
        case "wait": parts.push("기다림"); break;
        case "when": parts.push("조건"); break;
        case "refuse": parts.push("고르면 안 되는 값"); break;
        case "else": parts.push("그 밖의 갈래"); break;
        default: parts.push(fieldLabel(s.key, ctx));
      }
    }
    if (!nodeName && type && NODE_TYPE_LABEL[type]) parts[0] = `${NODE_TYPE_LABEL[type]} 노드`;
    return { nodeId: node && typeof node["id"] === "string" ? node["id"] : id, where: parts.join(" › "), ctx };
  }
  const segs = segments(loc);
  const head = segs[0];
  if (!head) return null;
  const list = (key: string) => (flow && Array.isArray(flow[key]) ? (flow[key] as unknown[]) : []);
  const named = (key: string, i: number | null) => { const x = i !== null ? list(key)[i] : undefined; return isObj(x) && typeof x["name"] === "string" && x["name"].trim() ? ` «${x["name"]}»` : ""; };
  switch (head.key) {
    case "params": return { nodeId: null, where: `실행 입력 ${head.index !== null ? nth(head.index) : ""}${named("params", head.index)}`.trim(), ctx: ["params"] };
    case "secrets": return { nodeId: null, where: `시크릿 ${head.index !== null ? nth(head.index) : ""}${named("secrets", head.index)}`.trim(), ctx: ["secrets"] };
    case "vars": return { nodeId: null, where: "변수", ctx: ["vars"] };
    case "edges": return { nodeId: null, where: `연결 ${head.index !== null ? nth(head.index) : ""}`.trim(), ctx: ["edges"] };
    case "워크플로우": return { nodeId: null, where: "워크플로우", ctx: [] };
    case "settings": {
      const sub = segs[1];
      if (!sub) return { nodeId: null, where: "워크플로우 설정", ctx: ["settings"] };
      const i = sub.index !== null ? ` ${nth(sub.index)}` : "";
      const label = sub.key === "notify" ? `알림${i}` : sub.key === "schedules" ? `일정${i}` : sub.key === "forbiddenLabels" ? `금지 버튼${i}` : sub.key === "probeParams" ? "점검용 입력값" : fieldLabel(sub.key, ["settings"]);
      return { nodeId: null, where: `워크플로우 설정 › ${label}`, ctx: ["settings", sub.key] };
    }
    default: return null;
  }
}

/** 칸 하나에 대한 말을 사람 말로 */
function sayOf(msg: string, place: Place): string {
  const ctx = place.ctx;
  let m: RegExpExecArray | null;
  // 비었다
  if ((m = /^(\w+)가 비었습니다$/.exec(msg))) {
    const key = m[1]!;
    if (ctx.includes("rows") && (key === "value" || key === "label")) return "표의 행을 아직 고르지 않았습니다 — 녹화하면서 표를 누르거나 «요소 고르기»로 고르세요";
    if (ctx.includes("table") && key === "label") return "표를 아직 고르지 않았습니다 — 녹화하면서 표를 누르거나 «요소 고르기»로 고르세요";
    if ((ctx.includes("target") || ctx.includes("locators")) && (key === "value" || key === "label") && !ctx.includes("node:fileWrite")) {
      const kind = ctx.find((x) => x.startsWith("action:"))?.slice(7) ?? "";
      const what = kind === "click" ? "누를 곳" : kind === "fill" || kind === "select" || kind === "check" ? "넣을 곳" : kind === "read" || kind === "assert" ? "읽을 곳"
        : kind === "wait" ? "기다릴 요소" : kind === "pickRow" ? "고를 행" : "대상 요소";
      return `${eulreul(what)} 아직 고르지 않았습니다 — 녹화하거나 «요소 고르기»로 고르세요`;
    }
    const label = fieldLabel(key, ctx);
    const hint = key === "url" ? " — https://로 시작하는 주소를 넣으세요"
      : key === "flowId" ? " — 부를 워크플로우를 고르세요"
      : key === "left" ? " — 무엇을 견줄지 값을 고르세요(값 칩)"
      : key === "source" ? " — 다듬을 목록을 고르세요(값 칩)"
      : key === "data" ? " — 저장할 값을 고르세요(값 칩)"
      : key === "selector" ? " — 녹화로 열을 다시 고르세요"
      : key === "name" || key === "label" ? " — 이름을 지어 주세요"
      : key === "value" && (ctx.includes("action:fill") || ctx.includes("action:select")) ? " — 넣을 값을 적거나 값 칩으로 고르세요"
      : "";
    return `${iga(label)} 비었습니다${hint}`;
  }
  // 이름 규칙
  if ((m = /^(\w+) "(.*)"는 글자 · 숫자 · _ 만 쓸 수 있습니다/.exec(msg))) {
    const label = fieldLabel(m[1]!, ctx), v = m[2]!;
    if (v.trim() === "") return `${iga(label)} 비었습니다 — ${m[1] === "output" ? "읽은 값을 담을 " : ""}이름을 지어 주세요`;
    const fixed = v.trim().replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "");
    return `${label} «${v}»에는 글자 · 숫자 · _만 쓸 수 있습니다 — 띄어쓰기 · 점 대신 _를 쓰세요${fixed ? `(예: ${fixed})` : ""}`;
  }
  if ((m = /^(\w+) "(.*)"는 영문자로 시작하는 영문 · 숫자 · _ · - 여야 합니다$/.exec(msg))) {
    return `${fieldLabel(m[1]!, ctx)} «${m[2]}»는 영문자로 시작하고 영문 · 숫자 · _ · -만 씁니다`;
  }
  if ((m = /^출력 이름 "(.*)"가 두 번 있습니다$/.exec(msg))) {
    return m[1] === "" ? "이름 없는 출력이 둘 이상 있습니다 — 읽기 동작마다 출력 이름을 지어 주세요" : `출력 이름 «${m[1]}»이(가) 두 번 쓰였습니다 — 하나를 다른 이름으로 바꾸세요`;
  }
  if ((m = /^(.+) "(.*)"가 두 번 있습니다$/.exec(msg))) return `${m[1]} «${m[2]}»이(가) 두 번 있습니다 — 하나를 다른 것으로 바꾸세요`;
  // 모양(손으로 고친 JSON에서나 나온다)
  if ((m = /^(\w+)는 (글자|배열|true\/false|글자 또는 null)(?:이)?여야 합니다$/.exec(msg))) {
    return `${fieldLabel(m[1]!, ctx)}의 모양이 맞지 않습니다(${m[2] === "true/false" ? "켜기/끄기" : m[2]}) — 화면에서 다시 고르세요`;
  }
  if ((m = /^(\w+)는 (\d+) 이상의 정수( 또는 null)?이어야 합니다$/.exec(msg))) {
    return `${eunneun(fieldLabel(m[1]!, ctx))} ${m[2]} 이상의 정수여야 합니다${m[3] ? "(비워 두어도 됩니다)" : ""}`;
  }
  if ((m = /^(\w+): 모르는 값 (.*) \(가능: (.*)\)$/.exec(msg))) {
    return `${fieldLabel(m[1]!, ctx)}에 모르는 값 ${m[2]} — ${m[3]!.split(" | ").join(" · ")} 중 하나여야 합니다`;
  }
  if (msg === "객체여야 합니다") return "설정의 모양이 맞지 않습니다 — 화면에서 다시 고르거나, 손으로 고친 JSON을 되돌리세요";
  if (msg === "위치가 하나도 없습니다 — 레코더로 다시 지정하세요") return "요소를 찾는 법이 하나도 없습니다 — 녹화하거나 «요소 고르기»로 다시 고르세요";
  // 그 밖 — 이미 사람 말이다. 남은 영어 키만 바꾼다
  return msg.replace(/\b(retries|monitorIntervalMin|runTimeoutMin|offset|strategy|attribute|ms)\b/g, (k) => fieldLabel(k, ctx));
}

/** 문제 하나를 사람 말로 — flow는 초안(이름 · 동작 종류를 찾으려고). 모르는 꼴이면 그대로 */
export function explainProblem(raw: string, flow?: unknown): ProblemView {
  const f = isObj(flow) ? flow : null;
  const i = raw.indexOf(": ");
  if (i > 0) {
    const place = placeOf(raw.slice(0, i), f);
    if (place) return { nodeId: place.nodeId, where: place.where, text: sayOf(raw.slice(i + 2), place), raw };
  }
  // 그래프 문장 — 「노드 '이름'(id)…」에서 노드를 찾는다(이미 사람 말이다)
  const nodes = f && Array.isArray(f["nodes"]) ? (f["nodes"] as unknown[]).filter(isObj) : [];
  for (const m of raw.matchAll(/\(([A-Za-z][\w-]*)\)/g)) {
    const n = nodes.find((x) => x["id"] === m[1]);
    if (n) return { nodeId: m[1]!, where: typeof n["name"] === "string" ? `«${n["name"]}»` : "", text: raw, raw };
  }
  return { nodeId: null, where: "", text: raw, raw };
}

/** 여럿 — 같은 자리 · 같은 말은 하나로 */
export function explainProblems(raws: readonly string[], flow?: unknown): ProblemView[] {
  const seen = new Set<string>();
  const out: ProblemView[] = [];
  for (const r of raws) {
    const v = explainProblem(r, flow);
    const k = `${v.nodeId ?? ""}\u0000${v.where}\u0000${v.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** 한 줄로 — 알림 · 토스트 */
export const problemLine = (v: ProblemView): string => (v.where ? `${v.where}: ${v.text}` : v.text);
