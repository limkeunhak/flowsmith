/**
 * **검문소** — 밖에서 온 JSON이 `Flow`가 되는 유일한 문.
 *
 * ★부분 통과가 없다. 문제를 모아 마지막에 한꺼번에 던진다 — 전부 맞거나 안 들어오거나다.
 *  하나 고치고 다시 넣었더니 다음 하나가 나오는 식이면 사람이 지친다.
 *
 * 두 단계다:
 *   1. 모양 — 칸이 있나, 종류가 맞나, 알려진 값인가 (이 파일)
 *   2. 의미 — 그래프가 비순환인가, 참조가 닿는가 (`graph.ts`의 `compile`)
 *  모양이 틀리면 의미는 안 본다. 틀린 모양 위에서 낸 의미 오류는 대개 헛소리다.
 */
import {
  BROWSER_MODES, EMAIL_RE, HUMAN_TIMEOUT, WALLET_APPROVE_TIMEOUT, WALLET_MODES, NODE_TYPES, NOTE_COLORS, PARAM_TYPES, paramProblem, type FlowNote, NOTIFY_CHANNELS, NOTIFY_EVENTS, recipientsOf, SCHEMA_VERSION, SECRET_KINDS, type Edge, type Flow, type FlowNode, type FlowSettings, type NotifyRule, type ParamDef, type SecretDef, WALLET_ANNOUNCE, type WalletSettings } from "../model.ts";
import { compile } from "../graph.ts";
import { parseCron } from "../cron.ts";
import { Checker, FlowError, isObj } from "./checker.ts";
import { webConfig } from "./web.ts";
import { conditionConfig } from "./condition.ts";
import { approvalConfig, checkConfig, customConfig, extensionConfig, fileReadConfig, flowCallConfig, httpConfig, storeConfig, transformConfig, zipConfig } from "./nodes.ts";

export const DEFAULT_SETTINGS: FlowSettings = {
  forbiddenLabels: [],
  defaultTimeoutMs: 15_000,
  monitorIntervalMin: null,
  probeParams: {},
  browser: "launch",
  schedules: [],
  retries: 0,
  retryDelayMs: 2_000,
  actionPause: { minMs: 0, maxMs: 0 },
  runTimeoutMin: 60,
  notify: [],
  locks: [],
  after: [],
  fileTriggers: [],
  wallet: null,
};

function node(c: Checker, v: unknown, i: number): FlowNode {
  const o = c.obj(v, `nodes[${i}]`);
  const id = c.id(o, "id", `nodes[${i}]`);
  const where = `노드 ${id || `#${i}`}`;
  const p = isObj(o["position"]) ? o["position"] : {};
  const position = { x: typeof p["x"] === "number" ? p["x"] : 0, y: typeof p["y"] === "number" ? p["y"] : 0 };
  // 옛 이름 — «store»(저장 노드)는 «fileWrite»(파일 쓰기)로 바뀌었다
  const type = o["type"] === "store" ? "fileWrite" : c.oneOf(NODE_TYPES, o, "type", where);
  const name = c.text(o, "name", where);
  const cfg = c.obj(o["config"], `${where}.config`);
  switch (type) {
    case "web": return { id, name, position, type, config: webConfig(c, cfg, where) };
    case "condition": return { id, name, position, type, config: conditionConfig(c, cfg, where) };
    case "custom": return { id, name, position, type, config: customConfig(c, cfg, where) };
    case "extension": return { id, name, position, type, config: extensionConfig(c, cfg, where) };
    case "fileWrite": return { id, name, position, type, config: storeConfig(c, cfg, where) };
    case "fileRead": return { id, name, position, type, config: fileReadConfig(c, cfg, where) };
    case "flowCall": return { id, name, position, type, config: flowCallConfig(c, cfg, where) };
    case "http": return { id, name, position, type, config: httpConfig(c, cfg, where) };
    case "transform": return { id, name, position, type, config: transformConfig(c, cfg, where) };
    case "approval": return { id, name, position, type, config: approvalConfig(c, cfg, where) };
    case "check": return { id, name, position, type, config: checkConfig(c, cfg, where) };
    case "zip": return { id, name, position, type, config: zipConfig(c, cfg, where) };
  }
}

function edge(c: Checker, v: unknown, i: number): Edge {
  const w = `edges[${i}]`;
  const o = c.obj(v, w);
  const from = c.obj(o["from"], `${w}.from`);
  const to = c.obj(o["to"], `${w}.to`);
  return {
    id: c.id(o, "id", w),
    from: { node: c.str(from, "node", `${w}.from`), port: c.str(from, "port", `${w}.from`, "out") },
    to: { node: c.str(to, "node", `${w}.to`) },
  };
}

function notifyRule(c: Checker, x: unknown, i: number): NotifyRule {
  const w = `settings.notify[${i}]`;
  const r = c.obj(x, w);
  const on = c.arr(r, "on", w).map((e, j) => {
    if (typeof e !== "string" || !(NOTIFY_EVENTS as readonly string[]).includes(e)) { c.fail(`${w}.on[${j}]`, `모르는 때 ${JSON.stringify(e)} (가능: ${NOTIFY_EVENTS.join(" | ")})`); return "failure" as const; }
    return e as NotifyRule["on"][number];
  });
  if (Array.isArray(r["on"]) && on.length === 0) c.fail(w, "언제 알릴지 하나 이상 고르세요");
  c.noDup(on, "때", w);
  const channel = c.oneOf(NOTIFY_CHANNELS, r, "channel", w);
  const url = c.text(r, "url", w);
  if (typeof r["url"] === "string" && url.trim() !== "") {
    if (channel === "email") {
      // 받는 사람 — 표현식이 아닌 것은 메일 주소여야 한다
      const bad = recipientsOf(url.replace(/\{\{[^{}]*\}\}/g, " ")).filter((x) => !EMAIL_RE.test(x));
      if (bad.length) c.fail(w, `메일 주소를 읽을 수 없습니다 — ${bad.join(", ")}`);
    } else if (!url.trim().startsWith("{{") && !/^https?:\/\//i.test(url.trim())) c.fail(w, "주소는 http:// 또는 https://로 시작해야 합니다");
  }
  return { id: c.id(r, "id", w), on, channel, url, attach: c.bool(r, "attach", w, false), firstOnly: c.bool(r, "firstOnly", w, true), enabled: c.bool(r, "enabled", w, true) };
}

/** 동작 사이 쉬기 — 없으면 쉬지 않는다. 0~60초 · 최대가 최소보다 작으면 안 된다 */
function actionPauseOf(c: Checker, v: unknown): FlowSettings["actionPause"] {
  if (v == null) return { ...DEFAULT_SETTINGS.actionPause };
  const o = c.obj(v, "settings.actionPause");
  const minMs = Math.min(60_000, c.int(o, "minMs", "settings.actionPause", 0, 0));
  const maxMs = Math.min(60_000, c.int(o, "maxMs", "settings.actionPause", minMs, 0));
  if (maxMs < minMs) c.fail("settings.actionPause", `최대(maxMs ${maxMs})가 최소(minMs ${minMs})보다 작습니다`);
  return { minMs, maxMs };
}

function settings(c: Checker, v: unknown): FlowSettings {
  if (v === undefined) return { ...DEFAULT_SETTINGS };
  const o = c.obj(v, "settings");
  const forbiddenLabels = c.arr(o, "forbiddenLabels", "settings", true).map((x, i) => {
    if (typeof x !== "string" || x.trim() === "") { c.fail(`settings.forbiddenLabels[${i}]`, "정규식 글자여야 합니다"); return ""; }
    c.regex(x, `settings.forbiddenLabels[${i}]`);
    return x;
  });
  const minutes = o["monitorIntervalMin"];
  let monitorIntervalMin: number | null = null;
  if (minutes !== undefined && minutes !== null) {
    if (typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 5) monitorIntervalMin = minutes;
    else c.fail("settings", "monitorIntervalMin은 5 이상의 정수(분) 또는 null이어야 합니다");
  }
  const retries = c.int(o, "retries", "settings", DEFAULT_SETTINGS.retries, 0);
  if (retries > 5) c.fail("settings", "retries는 5번까지입니다");
  const limit = o["runTimeoutMin"];
  let runTimeoutMin: number | null = DEFAULT_SETTINGS.runTimeoutMin;
  if (limit === null) runTimeoutMin = null;
  else if (limit !== undefined) {
    if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 24 * 60) runTimeoutMin = limit;
    else c.fail("settings", "runTimeoutMin은 1~1440 사이의 정수(분) 또는 null(제한 없음)이어야 합니다");
  }
  const notify = c.arr(o, "notify", "settings", true).map((x, i) => notifyRule(c, x, i));
  const locks = c.arr(o, "locks", "settings", true).map((x, i) => {
    const s = typeof x === "string" ? x.trim() : "";
    if (s === "" || s.length > 60) c.fail(`settings.locks[${i}]`, "자원 이름은 1~60자입니다");
    return s;
  });
  if (locks.length > 5) c.fail("settings.locks", "자원 잠금은 5개까지입니다");
  c.noDup(locks, "자원 이름", "settings.locks");
  const after = c.arr(o, "after", "settings", true).map((x, i) => {
    const w = `settings.after[${i}]`;
    const a = c.obj(x, w);
    const on = c.arr(a, "on", w).map((v) => (v === "success" || v === "failure" ? v : (c.fail(w, "on은 success · failure입니다"), "success" as const)));
    if (Array.isArray(a["on"]) && on.length === 0) c.fail(w, "언제(성공 · 실패) 하나는 골라야 합니다");
    return { id: c.id(a, "id", w), flowId: c.text(a, "flowId", w), on: [...new Set(on)], params: c.strRecord(a["params"], `${w}.params`), enabled: c.bool(a, "enabled", w, true) };
  });
  c.noDup(after.map((x) => x.id), "id", "settings.after");
  const fileTriggers = c.arr(o, "fileTriggers", "settings", true).map((x, i) => {
    const w = `settings.fileTriggers[${i}]`;
    const f = c.obj(x, w);
    const dir = c.str(f, "dir", w, "").trim().replace(/^\/+|\/+$/g, "");
    if (dir.split("/").some((s) => s === ".." || s === ".") || /[\\:]/.test(dir)) c.fail(w, "폴더는 공유 폴더 안의 이름만 — «..» · 드라이브 · 역슬래시는 안 됩니다");
    const pattern = c.text(f, "pattern", w);
    if (/[\/\\]/.test(pattern)) c.fail(w, "파일 이름 꼴에는 폴더를 넣지 않습니다(* · ? 만)");
    return { id: c.id(f, "id", w), dir, pattern, param: c.strOrNull(f, "param", w), enabled: c.bool(f, "enabled", w, true) };
  });
  c.noDup(fileTriggers.map((x) => x.id), "id", "settings.fileTriggers");
  c.noDup(notify.map((r) => r.id), "알림 id", "settings.notify");
  let wallet: WalletSettings | null = null;
  if (o["wallet"] !== undefined && o["wallet"] !== null) {
    const w = "settings.wallet";
    const x = c.obj(o["wallet"], w);
    const mode = c.oneOf(WALLET_MODES, x, "mode", w, "inject");
    const chains = c.arr(x, "chains", w, mode === "metamask").map((y, i) => {
      const cw = `${w}.chains[${i}]`;
      const k = c.obj(y, cw);
      const chainId = c.int(k, "chainId", cw, 0, 1);
      const rpcUrl = c.str(k, "rpcUrl", cw, "").trim();
      if (rpcUrl !== "" && !/^https?:\/\//i.test(rpcUrl)) c.fail(cw, "RPC 주소는 http:// 또는 https://로 시작합니다(비우면 서명만)");
      const allowTx = c.bool(k, "allowTx", cw, false);
      if (allowTx && rpcUrl === "") c.fail(cw, "거래를 허용하려면 RPC 주소가 있어야 합니다");
      const symbol = c.str(k, "symbol", cw, "").trim();
      if (symbol !== "" && !/^[A-Za-z0-9]{1,11}$/.test(symbol)) c.fail(cw, "화폐 기호는 영문 · 숫자 1~11자입니다(예: ETH · NXPC)");
      return { chainId, name: c.str(k, "name", cw, `체인 ${chainId}`), rpcUrl, allowTx, ...(symbol ? { symbol } : {}) };
    });
    // MetaMask는 체인 없이도 된다(기본 체인에서 연결 · 서명만) — 페이지 주입 지갑은 체인이 있어야 답할 수 있다
    if (mode === "inject" && Array.isArray(x["chains"]) && chains.length === 0) c.fail(w, "체인을 하나 이상 정하세요");
    c.noDup(chains.map((k) => String(k.chainId)), "체인 id", w);
    const defaultChainId = c.int(x, "defaultChainId", w, chains[0]?.chainId ?? 1, 1);
    if (chains.length && !chains.some((k) => k.chainId === defaultChainId)) c.fail(w, `처음 체인 ${defaultChainId}이(가) 체인 목록에 없습니다`);
    wallet = { mode, secret: c.text(x, "secret", w), announceAs: c.oneOf(WALLET_ANNOUNCE, x, "announceAs", w, "MetaMask"), chains, defaultChainId };
  }
  return {
    wallet,
    notify,
    locks,
    after,
    fileTriggers,
    retries: Math.min(retries, 5),
    retryDelayMs: c.int(o, "retryDelayMs", "settings", DEFAULT_SETTINGS.retryDelayMs, 0),
    actionPause: actionPauseOf(c, o["actionPause"]),
    runTimeoutMin,
    forbiddenLabels,
    defaultTimeoutMs: c.int(o, "defaultTimeoutMs", "settings", DEFAULT_SETTINGS.defaultTimeoutMs, 100),
    monitorIntervalMin,
    probeParams: c.strRecord(o["probeParams"], "settings.probeParams"),
    browser: c.oneOf(BROWSER_MODES, o, "browser", "settings", "launch"),
    schedules: c.arr(o, "schedules", "settings", true).map((x, i) => {
      const w = `settings.schedules[${i}]`;
      const s = c.obj(x, w);
      const cron = c.text(s, "cron", w);
      if (typeof s["cron"] === "string") { try { parseCron(cron); } catch (e) { c.fail(w, (e as Error).message); } }
      return { id: c.id(s, "id", w), cron, params: c.strRecord(s["params"], `${w}.params`), enabled: c.bool(s, "enabled", w, true) };
    }),
  };
}

// ─── 문 ────────────────────────────────────────────────────────────

/** 모양만 본다. 문제와 (대체값이 섞였을 수 있는) 결과를 같이 돌려준다 */
function readShape(json: unknown): { flow: Flow; problems: string[] } {
  const c = new Checker();
  const o = c.obj(json, "워크플로우");
  if (o["schemaVersion"] !== SCHEMA_VERSION) c.fail("워크플로우", `schemaVersion이 ${SCHEMA_VERSION}이어야 합니다(받은 값: ${JSON.stringify(o["schemaVersion"])})`);

  const params: ParamDef[] = c.arr(o, "params", "워크플로우", true).map((x, i) => {
    const w = `params[${i}]`;
    const p = c.obj(x, w);
    const name = c.name(p, "name", w);
    const type = c.oneOf(PARAM_TYPES, p, "type", w, "text");
    const options = type === "select" ? c.arr(p, "options", w).map((x) => String(x).trim()).filter((x) => x !== "") : [];
    if (type === "select" && options.length === 0) c.fail(w, "고르기 입력은 보기(options)가 하나 이상 있어야 합니다");
    const def = c.str(p, "default", w, "");
    const bad = def.trim() !== "" && (type !== "select" || options.length > 0) ? paramProblem({ type, options }, def) : null;
    if (bad) c.fail(w, `기본값 — ${bad}`);
    return { name, label: c.str(p, "label", w, name), required: c.bool(p, "required", w, true), type, options, default: def, help: c.str(p, "help", w, "") };
  });
  c.noDup(params.map((p) => p.name), "입력 이름", "params");

  const secrets: SecretDef[] = c.arr(o, "secrets", "워크플로우", true).map((x, i) => {
    const w = `secrets[${i}]`;
    const s = c.obj(x, w);
    if ("value" in s || "password" in s) c.fail(w, "★매니페스트에 시크릿 값을 넣지 않습니다 — 이름과 종류만 적고 값은 시크릿 저장소에 넣으세요");
    return { name: c.name(s, "name", w), kind: c.oneOf(SECRET_KINDS, s, "kind", w), description: c.str(s, "description", w, ""), shared: c.bool(s, "shared", w, false) };
  });
  c.noDup(secrets.map((s) => s.name), "시크릿 이름", "secrets");

  const nodes = c.arr(o, "nodes", "워크플로우").map((x, i) => node(c, x, i));
  const edges = c.arr(o, "edges", "워크플로우").map((x, i) => edge(c, x, i));
  c.noDup(nodes.map((n) => n.id), "노드 id", "nodes");
  c.noDup(edges.map((e) => e.id), "엣지 id", "edges");

  const flow: Flow = {
    schemaVersion: SCHEMA_VERSION,
    id: c.id(o, "id", "워크플로우"),
    name: c.text(o, "name", "워크플로우"),
    description: c.str(o, "description", "워크플로우", ""),
    params,
    nodes,
    edges,
    vars: c.strRecord(o["vars"], "vars"),
    secrets,
    settings: settings(c, o["settings"]),
    sharedVars: (() => {
      const names = c.arr(o, "sharedVars", "워크플로우", true).map((x, i) => { if (typeof x !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x)) c.fail(`sharedVars[${i}]`, "공용 변수 이름은 영문 · 숫자 · _입니다"); return String(x); });
      c.noDup(names, "공용 변수", "sharedVars");
      return names;
    })(),
    notes: c.arr(o, "notes", "워크플로우", true).map((x, i): FlowNote => {
      const w = `notes[${i}]`;
      const n = c.obj(x, w);
      const pos = isObj(n["position"]) ? n["position"] : {};
      const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
      return {
        id: c.id(n, "id", w), text: c.str(n, "text", w, "").slice(0, 4000),
        position: { x: num(pos["x"], 0), y: num(pos["y"], 0) },
        width: Math.max(120, Math.min(2000, num(n["width"], 260))), height: Math.max(60, Math.min(2000, num(n["height"], 140))),
        color: c.oneOf(NOTE_COLORS, n, "color", w, "yellow"),
      };
    }),
  };
  // 사람 기다리기 — 전체 시간 제한이 기다리는 시간보다 짧으면 사람이 끝내기 전에 실행이 멈춘다
  const limit = flow.settings.runTimeoutMin;
  if (limit !== null) {
    for (const n of nodes) {
      if (n.type !== "web") continue;
      n.config.actions.forEach((a, i) => {
        const wait = a.kind === "human" ? (a.timeoutMs ?? HUMAN_TIMEOUT.defaultMs) : a.kind === "walletApprove" ? (a.timeoutMs ?? WALLET_APPROVE_TIMEOUT.defaultMs) : 0;
        if (wait > limit * 60_000) c.fail(`노드 '${n.name}'(${n.id}) 동작 ${i + 1}`, `${a.kind === "human" ? "사람을" : "MetaMask 승인을"} ${Math.round(wait / 60_000)}분 기다리는데 전체 시간 제한이 ${limit}분입니다 — 시간 제한을 늘리거나 기다리는 시간을 줄이세요`);
      });
    }
  }
  return { flow, problems: c.problems };
}

/**
 * JSON → Flow. 모양과 의미를 다 본다. 문제가 하나라도 있으면 `FlowError`로 전부 던진다.
 */
export function parseFlow(json: unknown): Flow {
  const { flow, problems } = readShape(json);
  if (problems.length > 0) throw new FlowError(problems);
  const compiled = compile(flow);
  if (compiled.problems.length > 0) throw new FlowError(compiled.problems);
  return flow;
}

/** 던지지 않고 문제만 — 편집 화면이 칸마다 표시할 때 쓴다 */
export function checkFlow(json: unknown): string[] {
  const { flow, problems } = readShape(json);
  if (problems.length > 0) return problems;
  return compile(flow).problems;
}
