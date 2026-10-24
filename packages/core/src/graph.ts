/**
 * 플로우의 **의미**를 본다 — 그래프 모양, 실행 순서, 참조가 닿는가 (PLAN §3.2 · §3.3).
 *
 * 순수하다. 브라우저 없이 시험한다.
 * `parseFlow`가 모양 검사를 마친 뒤 부른다. 여기서 내는 문제도 모아서 한꺼번에 돌려준다.
 */
import { APPROVAL_OUTPUTS, CHECK_OUTPUTS, BLOCKED_OUTPUTS, BLOCKED_PORT, ELSE_PORT, FLOW_CALL_OUTPUTS, HTTP_OUTPUTS, OUT_PORT, TRANSFORM_OUTPUTS, SECRET_PARTS, type Edge, type Flow, type FlowNode, type Target } from "./model.ts";
import { FILE_READ_OUTPUTS, STORE_OUTPUTS } from "./nodes/file.ts";
import { ExprError, refsOf, type Ref } from "./expr.ts";

export interface CompiledFlow {
  flow: Flow;
  /** 실행 순서 — 위상 정렬, 같은 자리면 nodes 배열 순서 */
  order: string[];
  node: Map<string, FlowNode>;
  incoming: Map<string, Edge[]>;
  outgoing: Map<string, Edge[]>;
  ancestors: Map<string, Set<string>>;
  /** 노드가 내놓는 출력 이름들. 조건 노드는 받은 것을 그대로 넘긴다 */
  outputs: Map<string, Set<string>>;
  problems: string[];
}

/** 노드 종류가 정하는 출력 포트 */
/** 웹페이지 노드가 막는 행들 — 행 고르기의 «고르면 안 되는 행»(값 · 까닭). 없으면 빈 목록 */
export function blockRules(n: FlowNode): { values: string[]; reason: string }[] {
  if (n.type !== "web") return [];
  return n.config.actions.flatMap((a) => (a.kind === "pickRow" && a.pick.refuse && a.pick.refuse.values.length > 0 ? [{ values: a.pick.refuse.values, reason: a.pick.refuse.reason }] : []));
}

export function outPorts(n: FlowNode): string[] {
  if (n.type === "condition") return [...n.config.cases.map((c) => c.id), ELSE_PORT];
  return blockRules(n).length > 0 ? [OUT_PORT, BLOCKED_PORT] : [OUT_PORT];
}

export const nodeLabel = (n: FlowNode): string => `노드 '${n.name}'(${n.id})`;

/** 노드 안의 표현식 자리들. 시크릿은 넣기 · 고르기 값에서만 쓸 수 있다 (PLAN §7) */
function templatesOf(n: FlowNode): { where: string; template: string; secrets: boolean; item?: boolean }[] {
  const out: { where: string; template: string; secrets: boolean; item?: boolean }[] = [];
  switch (n.type) {
    case "web":
      if (n.config.start.kind === "url") out.push({ where: "시작 주소", template: n.config.start.url, secrets: false });
      n.config.actions.forEach((a, i) => {
        const w = `동작 ${i + 1}(${a.id})`;
        if (a.when) {
          out.push({ where: `${w} 조건 왼쪽`, template: a.when.left, secrets: false });
          if (a.when.right !== null) out.push({ where: `${w} 조건 오른쪽`, template: a.when.right, secrets: false });
        }
        if (a.kind === "goto") out.push({ where: `${w} 주소`, template: a.url, secrets: false });
        if (a.kind === "fill" || a.kind === "select") out.push({ where: `${w} 값`, template: a.value, secrets: true });
        if (a.kind === "pickRow") out.push({ where: `${w} 찾을 값`, template: a.pick.value, secrets: false });
        if (a.kind === "assert") out.push({ where: `${w} 기대값`, template: a.equals, secrets: false });
      });
      break;
    case "condition":
      n.config.cases.forEach((c) => c.rules.forEach((r, j) => {
        const w = `갈래 '${c.label}' 규칙 ${j + 1}`;
        out.push({ where: `${w} 왼쪽`, template: r.left, secrets: false });
        if (r.right !== null) out.push({ where: `${w} 오른쪽`, template: r.right, secrets: false });
      }));
      break;
    case "custom":
      break; // 코드는 `input`을 직접 받는다 — 표현식 자리가 없다
    case "extension":
      for (const [k, v] of Object.entries(n.config.options)) out.push({ where: `확장 값 '${k}'`, template: v, secrets: false });
      break;
    case "fileWrite":
      out.push({ where: "저장할 값", template: n.config.data, secrets: false });
      break;
    case "fileRead":
      break; // 표현식 자리가 없다
    case "flowCall":
      if (n.config.items !== "") out.push({ where: "행들", template: n.config.items, secrets: false });
      // ★$item은 행마다 돌 때만 — 행들이 비어 있으면 한 번만 돌고 $item이 없다
      for (const [k, v] of Object.entries(n.config.params)) out.push({ where: `실행 입력 '${k}'`, template: v, secrets: false, item: n.config.items !== "" });
      break;
    case "transform":
      out.push({ where: "다듬을 목록", template: n.config.source, secrets: false });
      n.config.steps.forEach((s, i) => { if (s.kind === "filter") s.rules.forEach((r) => { if (r.value !== null) out.push({ where: `단계 ${i + 1} 거르기 값`, template: r.value, secrets: false }); }); });
      break;
    case "http": {
      const c = n.config;
      out.push({ where: "주소", template: c.url, secrets: false });
      c.query.forEach((p) => out.push({ where: `쿼리 '${p.name}'`, template: p.value, secrets: true }));
      c.headers.forEach((p) => out.push({ where: `헤더 '${p.name}'`, template: p.value, secrets: true }));
      if (c.body.kind === "json" || c.body.kind === "text") out.push({ where: "본문", template: c.body.text, secrets: true });
      if (c.body.kind === "form") c.body.fields.forEach((p) => out.push({ where: `본문 '${p.name}'`, template: p.value, secrets: true }));
      break;
    }
    case "approval":
      out.push({ where: "승인 안내", template: n.config.message, secrets: false });
      break;
    case "check":
      n.config.items.forEach((it, i) => {
        const w = `검사 ${i + 1}(${it.label || it.id})`;
        out.push({ where: `${w} 실제값`, template: it.actual, secrets: false });
        if (it.expected !== null) out.push({ where: `${w} 기대값`, template: it.expected, secrets: false });
      });
      break;
  }
  return out;
}

function targetsOf(n: FlowNode): { where: string; target: Target; click: boolean }[] {
  if (n.type !== "web") return [];
  const out: { where: string; target: Target; click: boolean }[] = [];
  n.config.actions.forEach((a, i) => {
    const w = `동작 ${i + 1}(${a.id})`;
    switch (a.kind) {
      case "click": out.push({ where: w, target: a.target, click: true }); break;
      case "fill": case "select": case "check": case "read": case "assert": out.push({ where: w, target: a.target, click: false }); break;
      case "pickRow": out.push({ where: w, target: a.pick.rows, click: false }); break;
      case "press": if (a.target) out.push({ where: w, target: a.target, click: false }); break;
      case "wait": if (a.wait.kind === "visible" || a.wait.kind === "hidden" || a.wait.kind === "filled") out.push({ where: w, target: a.wait.target, click: false }); break;
      case "readTable": out.push({ where: w, target: a.table.rows, click: false }); break;
      case "human":
        if (a.appears) out.push({ where: `${w} 이 화면일 때만`, target: a.appears, click: false });
        if (a.done.kind !== "url") out.push({ where: `${w} 끝났다는 표시`, target: a.done.target, click: false });
        break;
      case "walletApprove":
        if (a.done.kind !== "url") out.push({ where: `${w} 끝났다는 표시`, target: a.done.target, click: false });
        break;
      case "goto": case "closeWindow": break;
    }
  });
  return out;
}

export function compile(flow: Flow): CompiledFlow {
  const problems: string[] = [];
  const node = new Map(flow.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, Edge[]>(flow.nodes.map((n) => [n.id, []]));
  const outgoing = new Map<string, Edge[]>(flow.nodes.map((n) => [n.id, []]));

  if (flow.nodes.length === 0) problems.push("노드가 하나도 없습니다");

  // ── 엣지 ──
  const seen = new Set<string>();
  for (const e of flow.edges) {
    const w = `엣지 ${e.id}`;
    const from = node.get(e.from.node);
    const to = node.get(e.to.node);
    if (!from) problems.push(`${w}: 출발 노드 "${e.from.node}"가 없습니다`);
    if (!to) problems.push(`${w}: 도착 노드 "${e.to.node}"가 없습니다`);
    if (!from || !to) continue;
    if (from.id === to.id) { problems.push(`${w}: ${nodeLabel(from)}이 자기 자신으로 이어집니다`); continue; }
    if (!outPorts(from).includes(e.from.port)) {
      problems.push(`${w}: ${nodeLabel(from)}에는 "${e.from.port}" 포트가 없습니다 (있는 포트: ${outPorts(from).join(" · ")})`);
      continue;
    }
    const key = `${e.from.node}\0${e.from.port}\0${e.to.node}`;
    if (seen.has(key)) { problems.push(`${w}: 같은 연결이 이미 있습니다`); continue; }
    seen.add(key);
    outgoing.get(from.id)!.push(e);
    incoming.get(to.id)!.push(e);
  }

  // ── 조건 노드의 갈래 ↔ 엣지 ──
  for (const n of flow.nodes) {
    if (n.type !== "condition") continue;
    const branches = [...n.config.cases.map((c) => ({ port: c.id, label: `갈래 '${c.label}'`, then: c.then })), { port: ELSE_PORT, label: "그 밖(else)", then: n.config.else.then }];
    for (const b of branches) {
      const edges = outgoing.get(n.id)!.filter((e) => e.from.port === b.port);
      if (b.then.kind === "next" && edges.length === 0) problems.push(`${nodeLabel(n)}: ${b.label}이 «다음 노드로»인데 이어진 노드가 없습니다`);
      if (b.then.kind === "end" && edges.length > 0) problems.push(`${nodeLabel(n)}: ${b.label}은 «워크플로우 종료»인데 뒤에 노드가 이어져 있습니다`);
    }
  }

  // ── 순서 (Kahn) ──
  const index = new Map(flow.nodes.map((n, i) => [n.id, i]));
  const indeg = new Map(flow.nodes.map((n) => [n.id, incoming.get(n.id)!.length]));
  const ready = flow.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const e of outgoing.get(id)!) {
      const d = indeg.get(e.to.node)! - 1;
      indeg.set(e.to.node, d);
      if (d === 0) ready.push(e.to.node);
    }
  }
  const ancestors = new Map<string, Set<string>>();
  const outputs = new Map<string, Set<string>>();

  if (order.length < flow.nodes.length) {
    const stuck = flow.nodes.filter((n) => !order.includes(n.id)).map(nodeLabel);
    problems.push(`순환이 있습니다 — 워크플로우는 되돌아갈 수 없습니다: ${stuck.join(", ")}`);
    // ★순환 위에서 참조 검사를 하면 헛소리가 나온다. 여기서 멈춘다
    return { flow, order, node, incoming, outgoing, ancestors, outputs, problems };
  }

  // ── 조상 · 출력 (순서대로 한 번 훑으면 된다) ──
  const inputs = new Map<string, Set<string>>();
  for (const id of order) {
    const n = node.get(id)!;
    const anc = new Set<string>();
    const inp = new Set<string>();
    for (const e of incoming.get(id)!) {
      anc.add(e.from.node);
      for (const a of ancestors.get(e.from.node)!) anc.add(a);
      // 막힘 갈래 — 그 노드가 받은 값 + 막힌 까닭(그 노드가 읽은 것은 없다)
      if (e.from.port === BLOCKED_PORT) { for (const f of inputs.get(e.from.node)!) inp.add(f); for (const f of BLOCKED_OUTPUTS) inp.add(f); }
      else for (const f of outputs.get(e.from.node)!) inp.add(f);
    }
    ancestors.set(id, anc);
    inputs.set(id, inp);
    switch (n.type) {
      // ★앞 페이지에서 이어서 — 앞 노드가 넘긴 것도 함께 넘긴다(노드를 나눠도 읽은 값이 뒤로 이어지게 · 사용자 요청 2026-10-22)
      case "web": outputs.set(id, new Set([...(n.config.start.kind === "continue" ? inp : []), ...n.config.actions.flatMap((a) => (a.kind === "read" || a.kind === "readTable" ? [a.output] : []))])); break;
      case "condition": outputs.set(id, new Set(inp)); break;
      case "custom": outputs.set(id, new Set(n.config.outputs)); break;
      case "extension": outputs.set(id, new Set(n.config.outputs)); break;
      case "fileWrite": outputs.set(id, new Set(STORE_OUTPUTS)); break;
      case "fileRead": outputs.set(id, new Set(FILE_READ_OUTPUTS)); break;
      case "flowCall": outputs.set(id, new Set(FLOW_CALL_OUTPUTS)); break;
      case "http": outputs.set(id, new Set(HTTP_OUTPUTS)); break;
      case "transform": outputs.set(id, new Set(TRANSFORM_OUTPUTS)); break;
      case "approval": outputs.set(id, new Set([...inp, ...APPROVAL_OUTPUTS])); break;
      case "check": outputs.set(id, new Set([...inp, ...CHECK_OUTPUTS])); break;   // 받은 것 + 맞은 수 · 틀린 수   // 받은 것 + 승인(가운데 끼워도 뒤가 앞의 값을 쓴다)
    }
  }

  // ── 일정 — 실행 입력이 맞나 ──
  for (const s of flow.settings.schedules) {
    const w = `일정 ${s.id}(${s.cron})`;
    for (const k of Object.keys(s.params)) if (!flow.params.some((p) => p.name === k)) problems.push(`${w}: 실행 입력 "${k}"가 정의되지 않았습니다`);
    for (const p of flow.params) if (p.required && (s.params[p.name] ?? "").trim() === "") problems.push(`${w}: 필수 실행 입력 '${p.label}'(${p.name})의 값이 없습니다`);
  }
  if (new Set(flow.settings.schedules.map((s) => s.id)).size !== flow.settings.schedules.length) problems.push("일정 id가 겹칩니다");

  // ── 변수 — 이 플로우의 것 · 쓰겠다고 한 공용 변수(값은 돌릴 때 서버가 채운다) ──
  const shared = new Set(flow.sharedVars ?? []);
  const hasVar = (name: string) => name in flow.vars || shared.has(name);
  for (const name of shared) if (name in flow.vars) problems.push(`변수 "${name}": 이 워크플로우의 변수와 공용 변수에 함께 있습니다 — 하나만 쓰세요`);

  // ── 지갑 — 키 시크릿(글자) · 방식과 브라우저가 맞나(테스트 지갑은 띄우는 브라우저 · MetaMask는 지갑 브라우저) ──
  const wallet = flow.settings.wallet;
  const browser = flow.settings.browser;
  if (wallet) {
    const what = wallet.mode === "metamask" ? "MetaMask 지갑" : "테스트 지갑";
    const keyWord = wallet.mode === "metamask" ? "개인키 또는 복구 문구" : "개인키";
    const sec = flow.secrets.find((s) => s.name === wallet.secret);
    if (!sec) problems.push(`${what}: 시크릿 "${wallet.secret}"이(가) 정의되지 않았습니다 — ${keyWord}를 담을 글자 시크릿을 만드세요`);
    else if (sec.kind !== "text") problems.push(`${what}: 시크릿 "${wallet.secret}"은(는) 글자 하나(${keyWord})여야 합니다`);
    if (wallet.mode === "inject" && browser === "attach") problems.push("테스트 지갑: 사람의 크롬에 붙는 워크플로우에는 넣지 않습니다 — 그 크롬의 메타마스크를 쓰고 «사람 기다리기»로 승인하세요");
    if (wallet.mode === "inject" && browser === "app") problems.push("테스트 지갑: 앱 안 브라우저에는 넣지 않습니다 — 블록체인 사이트는 «띄우기»(테스트 지갑)나 «지갑 브라우저(MetaMask)»로 돌리세요");
    if (wallet.mode === "inject" && browser === "wallet") problems.push("테스트 지갑: 지갑 브라우저(MetaMask)에는 페이지에 넣는 테스트 지갑을 쓰지 않습니다 — 지갑 방식을 «MetaMask 확장»으로 바꾸세요");
    if (wallet.mode === "metamask" && browser !== "wallet") problems.push("MetaMask 지갑: 브라우저를 «지갑 브라우저(MetaMask)»로 고르세요 — MetaMask는 그 브라우저에만 실립니다");
  }
  if (browser === "wallet" && wallet?.mode !== "metamask") problems.push("지갑 브라우저: 워크플로우 설정의 지갑을 «MetaMask 확장» 방식으로 정하세요(키 시크릿 · 체인)");
  for (const n of flow.nodes) {
    if (n.type !== "web" || browser === "wallet") continue;
    n.config.actions.forEach((a, i) => {
      if (a.kind === "walletApprove") problems.push(`${nodeLabel(n)} 동작 ${i + 1}(${a.id}): MetaMask 승인은 지갑 브라우저(MetaMask)에서만 씁니다 — 사람의 크롬이면 «사람 기다리기»로 승인하세요`);
    });
  }

  // ── 다른 플로우가 끝나면 · 파일이 생기면 — 실행 입력이 맞나 ──
  for (const a of flow.settings.after ?? []) {
    const w = `«다른 워크플로우가 끝나면» ${a.id}`;
    if (a.flowId === flow.id) problems.push(`${w}: 자기 자신이 끝나면 다시 도는 것은 안 됩니다(끝없이 돈다)`);
    for (const [k, v] of Object.entries(a.params)) {
      if (!flow.params.some((p) => p.name === k)) problems.push(`${w}: 실행 입력 "${k}"가 정의되지 않았습니다`);
      let refs: Ref[];
      try { refs = refsOf(v); } catch (e) { if (e instanceof ExprError) { problems.push(`${w} '${k}': ${e.message}`); continue; } throw e; }
      for (const r of refs) {
        if (r.root === "$vars") { if (!hasVar(r.path[0]!)) problems.push(`${w} '${k}': "${r.raw}" — 변수 "${r.path[0]}"가 없습니다`); }
        else if (r.root !== "$input") problems.push(`${w} '${k}': "${r.raw}" — 앞 워크플로우의 결과($input) · 변수($vars)만 쓸 수 있습니다`);
      }
    }
    for (const p of flow.params) if (p.required && p.default === "" && (a.params[p.name] ?? "").trim() === "") problems.push(`${w}: 필수 실행 입력 '${p.label}'(${p.name})의 값이 없습니다`);
  }
  for (const f of flow.settings.fileTriggers ?? []) {
    const w = `«파일이 생기면» ${f.id}`;
    if (f.param !== null && !flow.params.some((p) => p.name === f.param)) problems.push(`${w}: 실행 입력 "${f.param}"가 정의되지 않았습니다`);
    for (const p of flow.params) if (p.required && p.default === "" && p.name !== f.param) problems.push(`${w}: 필수 실행 입력 '${p.label}'(${p.name})에 넣을 값이 없습니다 — 기본값을 두세요`);
  }

  // ── 노드마다 ──
  const secretKind = new Map(flow.secrets.map((s) => [s.name, s.kind]));
  const checkSecret = (w: string, r: Ref) => {
    const kind = secretKind.get(r.path[0]!);
    if (kind === undefined) { problems.push(`${w}: "${r.raw}" — 시크릿 "${r.path[0]}"가 정의되지 않았습니다`); return; }
    const parts = SECRET_PARTS[kind];
    const part = r.path[1];
    if (parts.length === 0 && part !== undefined) problems.push(`${w}: "${r.raw}" — ${kind} 시크릿은 칸 없이 씁니다`);
    if (parts.length > 0 && (part === undefined || !parts.includes(part))) problems.push(`${w}: "${r.raw}" — ${kind} 시크릿은 ${parts.map((p) => `.${p}`).join(" · ")} 중 하나를 붙여 씁니다`);
  };

  // ── 알림 주소 — 변수 · 시크릿만(실행 입력 · 노드 출력은 실행마다 달라 알림 주소로 쓰지 않는다) ──
  for (const rule of flow.settings.notify) {
    const w = `알림 ${rule.id} 주소`;
    let refs: Ref[];
    try { refs = refsOf(rule.url); } catch (e) { if (e instanceof ExprError) { problems.push(`${w}: ${e.message}`); continue; } throw e; }
    for (const r of refs) {
      if (r.root === "$secrets") checkSecret(w, r);
      else if (r.root === "$vars") { if (!hasVar(r.path[0]!)) problems.push(`${w}: "${r.raw}" — 변수 "${r.path[0]}"가 없습니다`); }
      else problems.push(`${w}: "${r.raw}" — 알림 주소에는 변수($vars) · 시크릿($secrets)만 쓸 수 있습니다`);
    }
  }
  const forbidden = flow.settings.forbiddenLabels.map((s) => new RegExp(s, "u"));

  for (const id of order) {
    const n = node.get(id)!;
    const who = nodeLabel(n);
    const anc = ancestors.get(id)!;

    if (n.type === "web" && n.config.start.kind === "tab" && flow.settings.browser !== "attach") {
      problems.push(`${who}: «사람이 연 탭에서»는 워크플로우 설정이 «사람의 브라우저에 붙기»일 때만 쓸 수 있습니다`);
    }
    if (n.type === "web" && n.config.start.kind === "continue") {
      const hasPage = [...anc].some((a) => { const x = node.get(a)!; return x.type === "web" || (x.type === "custom" && x.config.usesPage); });
      if (!hasPage) problems.push(`${who}: «앞 페이지에서 이어서»인데 앞에 웹페이지 노드가 없습니다 — 시작 주소를 정하세요`);
    }

    for (const t of targetsOf(n)) {
      if (t.target.locators.some((l) => l.value.includes("{{"))) problems.push(`${who} ${t.where}: 위치에는 표현식을 쓸 수 없습니다`);
      if (!t.click) continue;
      const words = [t.target.label, t.target.fingerprint?.text ?? ""];
      const hit = forbidden.find((re) => words.some((w) => re.test(w)));
      if (hit) problems.push(`${who} ${t.where}: ${t.target.label} — 금지 버튼(${hit.source})을 누르도록 되어 있습니다`);
    }

    if (n.type === "flowCall" && n.config.flowId === flow.id) problems.push(`${who}: 자기 자신을 부를 수 없습니다`);

    for (const { where, template, secrets, item } of templatesOf(n)) {
      const w = `${who} ${where}`;
      let refs;
      try { refs = refsOf(template); } catch (e) { if (e instanceof ExprError) { problems.push(`${w}: ${e.message}`); continue; } throw e; }
      for (const r of refs) {
        switch (r.root) {
          case "$input": {
            if (incoming.get(id)!.length === 0) problems.push(`${w}: "${r.raw}" — 이 노드로 들어오는 엣지가 없어 입력이 없습니다`);
            else if (r.path.length > 0 && !inputs.get(id)!.has(r.path[0]!)) problems.push(`${w}: "${r.raw}" — 앞 노드들이 "${r.path[0]}"를 내놓지 않습니다 (들어오는 것: ${[...inputs.get(id)!].join(" · ") || "없음"})`);
            break;
          }
          case "$node": {
            const [ref, field] = r.path as [string, string];
            if (!node.has(ref)) problems.push(`${w}: "${r.raw}" — 노드 "${ref}"가 없습니다`);
            else if (!anc.has(ref)) problems.push(`${w}: "${r.raw}" — ${nodeLabel(node.get(ref)!)}는 이 노드보다 앞에 있지 않습니다(조상 노드만 참조할 수 있습니다)`);
            else if (!outputs.get(ref)!.has(field)) problems.push(`${w}: "${r.raw}" — ${nodeLabel(node.get(ref)!)}는 "${field}"를 내놓지 않습니다`);
            break;
          }
          case "$params":
            if (!flow.params.some((p) => p.name === r.path[0])) problems.push(`${w}: "${r.raw}" — 실행 입력 "${r.path[0]}"가 정의되지 않았습니다`);
            break;
          case "$item":
            if (!item) problems.push(`${w}: "${r.raw}" — $item은 «다른 워크플로우 실행»이 행마다 돌 때 실행 입력 값에서만 씁니다`);
            break;
          case "$vars":
            if (!hasVar(r.path[0]!)) problems.push(`${w}: "${r.raw}" — 변수 "${r.path[0]}"가 없습니다(이 워크플로우의 변수 · 쓰겠다고 한 공용 변수)`);
            break;
          case "$secrets": {
            if (!secrets) { problems.push(`${w}: "${r.raw}" — 시크릿은 «넣기» · «고르기» · HTTP 헤더 · 쿼리 · 본문에서만 쓸 수 있습니다`); break; }
            checkSecret(w, r);
            break;
          }
        }
      }
    }
  }

  return { flow, order, node, incoming, outgoing, ancestors, outputs, problems };
}
