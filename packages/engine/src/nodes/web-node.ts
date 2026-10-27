/**
 * 웹페이지 노드 — 시작 주소로 가서(또는 앞 페이지에서 이어서) 녹화된 동작을 차례로 한다 (PLAN §3.4).
 *
 * ★동작 하나가 실패하면 노드가 실패한다. 다음 동작으로 넘어가지 않는다 —
 *  «조회»를 못 눌렀는데 «상태 읽기»를 하면 앞 화면의 값을 읽는다.
 * ★창(B1): 누르기가 팝업을 열면 그 창으로 옮겨 가고, 창이 닫히면(닫기 단추가 창을 닫아도) 연 창으로 돌아온다.
 *  노드가 끝날 때 머문 창을 실행기에 알린다 — 다음 노드의 «이어서»가 거기서 시작한다.
 */
import type { Page } from "playwright";
import { checkRule, durationText, evaluate, HUMAN_TIMEOUT, WALLET_APPROVE_TIMEOUT, type DialogAnswer, type HumanDone, type Output, type ProbeFinding, type Scope, type Target, type WebAction, type WebNode } from "@flowsmith/core";
import { describeLocator, locateAll } from "../browser/locate.ts";
import { pause, PROBLEMS, retryable, RunStopped, StepError, toFailure } from "../errors.ts";
import type { Primitives } from "../browser/primitives.ts";
import { inspectTarget, ProbeStop, probeTargets } from "../probe.ts";
import { FileStoreError, opsOf, rootedPath, UID_RE, type FileStoreOptions } from "./file-common.ts";

const josa = (w: string) => `${w}을(를)`;
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
/** «있을 때만»을 잴 때 기다리는 시간 */
const OPTIONAL_WAIT_MS = 2_000;
/** 사람 기다리기 — «이 화면일 때만»을 잴 때(로그인 화면이 늦게 그려질 수 있어 조금 넉넉하게) · 끝났나를 다시 보는 간격 */
const HUMAN_APPEARS_MS = 3_000;
const HUMAN_POLL_MS = 300;

/** 사람 기다리기 — 실행기가 «기다림 · 끝»을 바깥(편집 화면 · 실행 화면 · 알림)에 알린다 */
export interface HumanHooks {
  waiting(w: { index: number; actionId: string; prompt: string; deadline: string }): void;
  finished(w: { index: number; actionId: string; prompt: string; outcome: "done" | "timeout" | "stopped" | "failed" }): void;
}

/**
 * 그 요소가 **녹화 때의 그것으로** 보이나 — 보이고, 녹화 때 글자가 있었으면 그 앞부분이 들어 있어야 한다.
 * ★자리만 가리키는 CSS(`#banner > div:nth-of-type(2) > … > h3`)는 단계마다 제목을 바꿔 넣는 사이트에서 **다른 단계의 제목**을 잡는다
 *  (2026-10-17 실제 사이트 — 인증 팝업 뒤에 이미 있던 앞 단계 제목이 «끝났다는 표시»로 잡혀 11ms 만에 끝났다)
 */
async function seen(page: Page, t: Target): Promise<boolean> {
  const el = locateAll(page, t).first();
  if (!(await el.isVisible().catch(() => false))) return false;
  const want = norm(t.fingerprint?.text ?? "").slice(0, 12);
  if (want === "") return true;
  const got = norm(await el.innerText({ timeout: 1_000 }).catch(() => ""));
  return got.includes(want);
}

/** 끝났다는 표시가 지금 맞나 */
async function humanDone(page: Page, d: HumanDone): Promise<boolean> {
  if (d.kind === "url") return new RegExp(d.pattern, "u").test(page.url());
  const v = await seen(page, d.target);
  return d.kind === "visible" ? v : !v;
}

/**
 * 사람이 끝냈나 — 끝 표시가 맞고, **로그인 화면(«이 화면일 때만»)이 사라졌어야** 한다.
 * ★인증 팝업 뒤의 페이지에 끝 표시가 이미 보일 수 있다 — 팝업이 떠 있는 한 끝나지 않았다
 */
async function humanFinished(page: Page, a: Extract<WebAction, { kind: "human" }>): Promise<boolean> {
  if (!(await humanDone(page, a.done))) return false;
  return !(a.appears && (await seen(page, a.appears)));
}

/** 누른 뒤 확인창이 늦게 뜰 수 있어 이만큼 더 기다린다 */
const DIALOG_WAIT_MS = 5_000;

/**
 * 누르기가 띄우는 브라우저 확인창(alert · confirm)에 답한다 — 듣기는 바로 시작하고, done()이 «떴나 · 문구가 맞나»를 본다.
 * ★문구가 기대와 다르면 «취소»로 닫고 멈춘다 — 다른 경고 알림을 등록 확인으로 넘기지 않는다
 */
function answerDialog(page: Page, d: DialogAnswer, label: string): { done(): Promise<string>; stop(): void } {
  let seen: { type: string; message: string } | null = null;
  let wrong = false;
  const onDialog = (dlg: import("playwright").Dialog): void => {
    seen = { type: dlg.type(), message: dlg.message() };
    wrong = d.expect.trim() !== "" && !norm(dlg.message()).includes(norm(d.expect));
    void (wrong || !d.accept ? dlg.dismiss() : dlg.accept()).catch(() => undefined);
  };
  page.once("dialog", onDialog);
  const stop = (): void => { page.off("dialog", onDialog); };
  return {
    stop,
    async done() {
      const until = Date.now() + DIALOG_WAIT_MS;
      while (!seen && Date.now() < until && !page.isClosed()) await new Promise((r) => setTimeout(r, 100));
      stop();
      const s = seen as { type: string; message: string } | null;
      if (!s) throw new StepError({ problem: "other", message: `${label}: 누른 뒤 브라우저 확인창이 뜨지 않았습니다${d.expect ? ` — 기대한 문구 "${d.expect}"` : ""}`, label, locator: null, candidates: [] });
      const first = norm(s.message).slice(0, 60);
      if (wrong) throw new StepError({ problem: "mismatch", message: `${label}: 확인창 문구가 다릅니다 — 기대 "${d.expect}" · 화면 "${first}" — «취소»로 닫았습니다`, label, locator: null, candidates: [] });
      return `확인창 «${first}»에 ${d.accept ? "«확인»" : "«취소»"}`;
    },
  };
}

export interface StepLog {
  index: number;
  id: string;
  kind: WebAction["kind"] | "start";
  label: string;
  ms: number;
  /** 사람이 읽을 한 줄 — 무엇을 했나. ★시크릿이 섞일 수 있어 실행기가 가린 뒤에 내보낸다 */
  note: string;
}

export interface NodeEnv {
  prim: Primitives;
  /** 새 창의 Primitives를 만든다(같은 금지 단추 가드로) */
  primFor(page: Page): Primitives;
  /** 지금 머무는 창이 바뀌었다 — 실행기가 기억한다(다음 노드의 «이어서») */
  onPage?(page: Page, opened: boolean): void;
  /** 그 창을 연 창(아직 열린 것) — 앞 노드가 연 팝업이 이 노드에서 닫혔을 때 돌아갈 곳 */
  openerOf?(page: Page): Page | null;
  /** 동작 사이 쉬기 — 플로우 설정. 동작을 마칠 때마다 minMs~maxMs 사이에서 무작위로 */
  actionPause?: { minMs: number; maxMs: number };
  scope: Scope;
  defaultTimeoutMs: number;
  step(s: StepLog): void;
  /** 점검 실행이면 — 동작마다 요소를 살펴 알린다(되돌릴 수 없는 동작 앞에서 멈춘다) */
  probe?: { report(f: ProbeFinding): void };
  /** 멈추기 · 전체 시간 제한 — 켜지면 다음 동작 앞에서 멈춘다 */
  signal?: AbortSignal;
  /** 실패하면 다시 — 플로우 설정(동작마다 따로 정할 수 있다) */
  retry?: { count: number; delayMs: number };
  /** «파일로 저장»이 쓰는 곳 — 이 워크플로우의 폴더(files/<uuid>) */
  files?: FileStoreOptions;
  /**
   * 사람이 이 실행의 화면을 만질 수 있으면 — 사람의 크롬(attach) · 서버의 실행 화면 · 화면이 보이는 워커.
   * 없으면 «사람 기다리기»는 기다리지 않고 바로 멈춘다(아무도 로그인할 수 없다)
   */
  human?: HumanHooks;
  /**
   * 지갑 브라우저(browser: "wallet")이면 — «MetaMask 승인»이 쓴다. 사이트 페이지에서 체인을 맞추고, 끝 표시가 올 때까지
   * MetaMask 화면을 누른다(누른 화면 수를 돌려준다). 없으면 그 동작은 멈춘다
   */
  wallet?: {
    /** 시작 주소를 연 직후 — 사이트가 지갑을 부르기 전에 처음 체인으로 맞춘다(승인이 겹치지 않게) */
    prepare(page: Page): Promise<void>;
    approve(page: Page, done: () => Promise<boolean>, timeoutMs: number, atLeast?: number): Promise<number>;
  };
}

const str =(v: unknown, what: string): string => {
  if (v === undefined || v === null) throw new Error(`${what} 값이 없습니다`);
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

/** «있을 때만»이 살펴볼 요소 */
function optionalTarget(a: WebAction): Target | null {
  switch (a.kind) {
    case "click": case "fill": case "select": case "check": case "read": case "assert": return a.target;
    case "press": return a.target;
    default: return null;
  }
}

/** 숫자로 — 숫자 · 부호 · 소수점만 남긴다(「651,170원」→ 651170 · 「-12,340원」→ -12340) */
function toNumber(v: unknown, label: string): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^0-9.+-]/g, "");
  const n = s === "" ? NaN : Number(s);
  if (!Number.isFinite(n)) throw new StepError({ problem: "other", message: `${label}: "${String(v)}"를 숫자로 읽을 수 없습니다`, label, locator: null, candidates: [] });
  return n;
}

/** «파일로 저장» — 큰 PDF는 만드는 데 오래 걸린다(위키 PDF 내보내기). 동작에 시간 제한이 없으면 이만큼 */
const SAVE_TIMEOUT_MS = 180_000;

/** 경로 마디마다 파일 이름에 못 쓰는 글자를 바꾼다(제목이 그대로 파일 이름이 된다) — 「..」 · 빈 마디도 막는다 */
export function safeFilePath(rel: string): string {
  const parts = rel.split("/").filter((p) => p.trim() !== "").map((p) => {
    let s = p.replace(/[\\:*?"<>|\u0000-\u001f]/gu, "_").replace(/\s+/gu, " ").trim().replace(/[. ]+$/u, "");
    if (s === "" || s === "." || s === "..") s = "_";
    // 너무 긴 이름은 자른다(확장자는 남긴다) — 디스크 · 압축 도구가 255바이트를 넘기면 못 다룬다
    if (Buffer.byteLength(s) > 180) {
      const ext = /\.[A-Za-z0-9]{1,8}$/u.exec(s)?.[0] ?? "";
      let base = s.slice(0, s.length - ext.length);
      while (Buffer.byteLength(base + ext) > 180) base = base.slice(0, -1);
      s = base.trimEnd() + ext;
    }
    return s;
  });
  return parts.length ? parts.join("/") : "_";
}

async function saveFile(
  a: Extract<WebAction, { kind: "save" }>, page: Page, files: FileStoreOptions | undefined,
  value: (template: string, what: string) => string, timeoutMs: number,
): Promise<{ path: string; note: string }> {
  const fail = (message: string) => new StepError({ problem: "other", message, label: "파일로 저장", locator: null, candidates: [] });
  if (!files) throw fail("파일을 둘 곳이 없습니다 — 서버에 등록된 워크플로우로 돌리세요");
  if (!files.flowUid || !UID_RE.test(files.flowUid)) throw new FileStoreError("이 워크플로우의 폴더(uuid)를 모릅니다 — 서버에 등록된 워크플로우로 돌리세요");
  const rel = safeFilePath(value(a.path, "저장할 경로"));
  const full = rootedPath(`${files.flowUid}/${rel}`);
  if (full === null || !full.startsWith(`${files.flowUid}/`)) throw fail(`「${rel}」는 이 워크플로우의 폴더 밖입니다`);
  const fs = opsOf(files);
  if (a.skipExisting && (await fs.stat(full))?.isFile) return { path: rel, note: `이미 있어 건너뛰었습니다 — ${rel}` };
  let bytes: Buffer;
  let how: string;
  if (a.source === "url") {
    const url = new URL(value(a.url, "받을 주소"), page.url()).toString();
    // ★이 브라우저의 로그인(쿠키)으로 받는다 — 화면은 옮기지 않는다
    const res = await page.context().request.get(url, { timeout: timeoutMs, maxRedirects: 10 });
    if (!res.ok()) throw fail(`${url}을(를) 받지 못했습니다 — HTTP ${res.status()}`);
    bytes = await res.body();
    how = `${res.headers()["content-type"]?.split(";")[0] ?? "?"}`;
    // 같은 사이트의 로그인 화면으로 돌아왔다(주소가 바뀜) — 내용 검사보다 먼저 알린다
    if (/login|signin|sso/iu.test(new URL(res.url()).pathname) && !/login|signin|sso/iu.test(new URL(url).pathname)) {
      throw fail(`받으려던 주소가 로그인 화면(${res.url()})으로 넘어갔습니다 — 로그인이 풀렸거나 권한이 없습니다`);
    }
  } else {
    bytes = await page.pdf({ printBackground: true, format: "A4", timeout: timeoutMs } as Parameters<Page["pdf"]>[0]).catch((e: Error) => {
      throw fail(`지금 페이지를 PDF로 찍지 못했습니다 — 창 없는 브라우저(띄우기)에서만 됩니다. 사람의 크롬 · 창 있는 브라우저면 «주소에서 받기»를 쓰세요(${e.message.split("\n")[0]})`);
    });
    how = "페이지 PDF";
  }
  // ★.pdf인데 PDF가 아니면 쓰지 않는다 — 로그인 화면 · 오류 화면(HTML)을 PDF 이름으로 남기지 않게
  if (rel.toLowerCase().endsWith(".pdf") && bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    const head = bytes.subarray(0, 200).toString("utf8").replace(/\s+/gu, " ").trim().slice(0, 80);
    throw fail(`받은 것이 PDF가 아닙니다(${how} · ${bytes.length}바이트 · «${head}») — 로그인이 풀렸거나 권한이 없거나 내보내기가 꺼져 있습니다`);
  }
  await fs.writeBytes(full, bytes);
  return { path: rel, note: `${rel}에 저장했습니다 — ${Math.max(1, Math.round(bytes.length / 1024))}KB(${how})` };
}

/** 결과 행에 그 행의 값을 함께 — 어느 행의 결과인지 남게(객체면 칸 그대로 · 아니면 item) */
const rowOf = (item: unknown): Record<string, unknown> =>
  item !== null && typeof item === "object" && !Array.isArray(item) ? { ...(item as Record<string, unknown>) } : { item };

/** 그 행에서 시작 · 동작을 돈다 — «행마다 반복». 행마다 읽은 것을 rows로 모은다 */
async function runEach(node: WebNode, env: NodeEnv): Promise<Output> {
  const each = node.config.each!;
  const v = evaluate(each.items, { ...env.scope, secrets: {} }).value;
  let items: unknown[];
  if (Array.isArray(v)) items = v;
  else if (typeof v === "string" && v.trim().startsWith("[")) { try { items = JSON.parse(v); } catch { items = []; } }
  else throw new StepError({ problem: "other", message: `반복할 행들이 목록이 아닙니다 — ${typeof v}`, label: "행마다 반복", locator: null, candidates: [] });
  const one: WebNode = { ...node, config: { start: node.config.start, actions: node.config.actions } };
  const rows: Record<string, unknown>[] = [];
  let failed = 0;
  for (const [i, item] of items.entries()) {
    if (env.signal?.aborted) throw new RunStopped();
    const tag = `[${i + 1}/${items.length}]`;
    const rowEnv: NodeEnv = { ...env, scope: { ...env.scope, item }, step: (s) => env.step({ ...s, note: `${tag} ${s.note}` }) };
    try {
      const got = await runWebNode(one, rowEnv);
      rows.push({ ...rowOf(item), ...got, ok: true, error: "" });
    } catch (e) {
      if (e instanceof RunStopped || env.signal?.aborted || e instanceof ProbeStop) throw e;
      if (each.onError === "stop") throw e;
      failed++;
      const message = toFailure(e).message.split("\n")[0]!;
      rows.push({ ...rowOf(item), ok: false, error: message });
      env.step({ index: 0, id: "each", kind: "start", label: "행마다 반복", ms: 0, note: `${tag} 실패해 다음 행으로 — ${message}` });
    }
  }
  return { rows, succeeded: rows.length - failed, failed };
}

export async function runWebNode(node: WebNode, env: NodeEnv): Promise<Output> {
  if (node.config.each) return runEach(node, env);
  const { scope } = env;
  let prim = env.prim;
  /** 연 창들 — 팝업으로 옮겨 가면 쌓고, 닫히면 꺼낸다 */
  const stack: Primitives[] = [];
  /** 이 노드에서 이미 머문 창 — «새 창으로 옮기기»는 이것 말고 지금 창이 연 창을 찾는다 */
  const visited = new Set<Page>([prim.page]);
  const goBack = (): boolean => {
    // 이 노드가 연 창이 없으면 — 앞 노드가 연 팝업에서 시작했는데 그 창이 닫혔다. 그 창을 연 창으로
    const opener = stack.length === 0 && prim.page.isClosed() ? env.openerOf?.(prim.page) ?? null : null;
    const back = stack.pop() ?? (opener ? env.primFor(opener) : undefined);
    if (!back) return false;
    prim = back;
    env.onPage?.(prim.page, false);
    return true;
  };
  const out: Output = {};
  const noSecrets: Scope = { ...scope, secrets: {} };
  /**
   * 넣은 칸 — «넣은 칸 다시 확인»이 다시 본다. 창마다(prim) 따로다(닫힌 팝업의 칸은 볼 수 없다).
   * 같은 칸에 다시 넣으면 마지막 값만 남긴다. ★값은 메모리에만 있다(시크릿일 수 있다)
   */
  const entered: { prim: Primitives; key: string; kind: "fill" | "select" | "check"; target: Target; value: string | boolean }[] = [];
  const remember = (kind: "fill" | "select" | "check", target: Target, value: string | boolean) => {
    const key = JSON.stringify([target.frames, target.locators[0]]);
    const at = entered.findIndex((x) => x.prim === prim && x.key === key);
    if (at >= 0) entered.splice(at, 1);
    entered.push({ prim, key, kind, target, value });
  };
  /** «값이 바뀔 때까지»가 견줄 값 — 바로 앞 동작 직전에 적는다. 앞 동작을 건너뛰었으면 기다릴 까닭이 없다 */
  let before: string | null = null;
  let prevSkipped = false;

  const t0 = Date.now();
  if (node.config.start.kind === "url") {
    const url = str(evaluate(node.config.start.url, noSecrets).value, "시작 주소");
    await prim.goto(url, env.defaultTimeoutMs);
    // 지갑 브라우저 — 사이트가 «지갑 연결»을 부르기 전에 체인부터(연결 · 체인 승인이 한꺼번에 겹치면 MetaMask가 넘어가지 않는다)
    if (env.wallet && !env.probe) await env.wallet.prepare(prim.page);
    env.step({ index: 0, id: "start", kind: "start", label: "시작", ms: Date.now() - t0, note: `${url}로 갔습니다` });
  } else if (node.config.start.kind === "tab") {
    // 탭은 실행기가 이미 골라 줬다 — 주소를 옮기지 않는다
    env.step({ index: 0, id: "start", kind: "start", label: "시작", ms: 0, note: `사람이 연 탭에서 — ${prim.page.url()}` });
  } else {
    if (prim.page.url() === "about:blank") {
      throw new StepError({ problem: "noPage", message: `${PROBLEMS.noPage} — 앞 웹페이지 노드가 돌지 않았습니다(건너뛴 갈래에 있었을 수 있습니다)`, label: null, locator: null, candidates: [] });
    }
    env.step({ index: 0, id: "start", kind: "start", label: "시작", ms: 0, note: `앞 페이지에서 이어서 — ${prim.page.url()}` });
  }

  for (const [i, a] of node.config.actions.entries()) {
    if (env.signal?.aborted) throw new RunStopped();
    // 앞 동작 뒤에 팝업이 스스로 닫혔다(서버 응답을 받고 닫는 창) — 연 창에서 이어 간다
    if (prim.page.isClosed()) goBack();
    const index = i + 1;
    const timeout = a.timeoutMs ?? env.defaultTimeoutMs;
    const started = Date.now();
    // ★시크릿은 넣기 · 고르기 값에서만 꺼낸다 (검문소가 이미 막지만 실행에서도 한 번 더)
    const valueOf = (template: string, what: string) =>
      str(evaluate(template, a.kind === "fill" || a.kind === "select" ? scope : noSecrets).value, what);
    // 다음이 «값이 바뀔 때까지»면 이 동작을 하기 **전**의 값을 적어 둔다 — 누른 뒤에 적으면 이미 바뀐 값과 견주게 된다
    const nextAction = node.config.actions[i + 1];
    const watching = nextAction?.kind === "wait" && nextAction.wait.kind === "changed" ? nextAction.wait.target : null;
    const baseline = watching ? await prim.peek(watching) : null;
    const skipped = prevSkipped;
    prevSkipped = true;

    // «조건이 맞을 때만» — 안 맞으면 건너뛴다. ★조건을 못 읽으면(숫자가 아님 등) 건너뛰지 않고 멈춘다
    if (a.when) {
      let r;
      try { r = checkRule(a.when, scope); } catch (e) {
        throw new StepError({ ...toFailure(e), action: { index, id: a.id, kind: a.kind }, url: prim.page.url(), message: `동작 ${index}(${a.kind}) 조건: ${toFailure(e).message}` });
      }
      if (!r.result) {
        env.step({ index, id: a.id, kind: a.kind, label: "조건", ms: 0, note: `조건이 안 맞아 건너뛰었습니다 — ${JSON.stringify(r.left)} ${a.when.op}${a.when.right !== null ? ` ${JSON.stringify(r.right)}` : ""}` });
        continue;
      }
    }

    // «있을 때만» — 잠깐 찾아보고 없으면 건너뛴다(처음만 뜨는 안내창 같은 것)
    const opt = a.optional ? optionalTarget(a) : null;
    if (opt) {
      const there = await locateAll(prim.page, opt).first().waitFor({ state: "visible", timeout: Math.min(OPTIONAL_WAIT_MS, timeout) }).then(() => true, () => false);
      if (!there) {
        env.step({ index, id: a.id, kind: a.kind, label: opt.label, ms: Date.now() - started, note: `${opt.label} — 없어서 건너뛰었습니다(있을 때만)` });
        continue;
      }
    }

    if (env.probe) {
      // ★점검 실행에는 사람이 없다 — 로그인 같은 일 앞에서 멈춘다(그 뒤는 사람이 있을 때만 갈 수 있다)
      if (a.kind === "human") throw new ProbeStop(node.id, a.id, "사람 기다리기 앞에서 멈췄습니다 — 점검 실행에는 로그인할 사람이 없습니다");
      if (a.kind === "walletApprove") throw new ProbeStop(node.id, a.id, "MetaMask 승인 앞에서 멈췄습니다 — 점검은 지갑으로 연결 · 서명하지 않습니다");
      for (const t of probeTargets(a)) {
        const f = await inspectTarget(prim.page, t, timeout);
        env.probe.report({ ...f, nodeId: node.id, actionId: a.id });
        if (f.status === "missing" || f.status === "many") throw new ProbeStop(node.id, a.id, `${josa(t.target.label)} 찾지 못해 더 갈 수 없습니다`);
      }
      // ★되돌릴 수 없는 동작은 누르지 않는다 — 있는지만 봤다
      if (a.risk === "unsafe") throw new ProbeStop(node.id, a.id, `되돌릴 수 없는 동작 앞에서 멈췄습니다 — 누르지 않았습니다`);
    }
    let label = "";
    let note = "";
    // ★다시 해 보기는 «되돌릴 수 있는» 동작만 — 제출 · 저장을 두 번 하지 않게
    const tries = a.risk === "safe" && a.kind !== "human" && a.kind !== "walletApprove" ? (a.retries ?? env.retry?.count ?? 0) : 0;
    for (let attempt = 0; ; attempt++) {
    try {
      switch (a.kind) {
        case "goto": {
          const url = valueOf(a.url, "주소");
          label = url;
          await prim.goto(url, timeout);
          note = `${url}로 갔습니다`;
          break;
        }
        case "click": {
          label = a.target.label;
          // 확인창에 답하기 — 누르기 전에 듣기 시작한다(확인창이 떠 있는 동안 누르기가 끝나지 않는다)
          const dialog = a.dialog ? answerDialog(prim.page, a.dialog, label) : null;
          try {
            if (a.popup) {
              // 팝업 — 누르는 것과 새 창을 같이 기다린다(누른 뒤에 기다리면 이미 열린 창을 놓친다)
              const [popup, r] = await Promise.all([prim.page.waitForEvent("popup", { timeout }), prim.click(a.target, timeout)]);
              await popup.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
              visited.add(popup);
              stack.push(prim);
              prim = env.primFor(popup);
              env.onPage?.(popup, true);
              note = `${label} 눌렀습니다 — 새 창으로 옮겼습니다(${popup.url()})${r.how === "이벤트" ? " · 이벤트로 누름" : ""}`;
            } else {
              const r = await prim.click(a.target, timeout);
              note = `${label} 눌렀습니다${r.how === "이벤트" ? " (좌표가 안 먹어 이벤트로)" : ""}`;
            }
            if (dialog) note += ` — ${await dialog.done()}`;
          } finally { dialog?.stop(); }
          break;
        }
        case "fill": {
          label = a.target.label;
          const v = valueOf(a.value, label);
          const r = await prim.fill(a.target, v, timeout);
          remember("fill", a.target, v);
          note = `${label}에 "${v}" 넣었습니다${r.retried ? " (한 번 다시 넣음)" : ""}`;
          break;
        }
        case "select": {
          label = a.target.label;
          const v = valueOf(a.value, label);
          const r = await prim.select(a.target, v, timeout);
          remember("select", a.target, v);
          note = `${label}에서 "${v}" 골랐습니다(${r.by}으로)`;
          break;
        }
        case "check":
          label = a.target.label;
          await prim.check(a.target, a.checked, timeout);
          remember("check", a.target, a.checked);
          note = `${label} ${a.checked ? "켰습니다" : "껐습니다"}`;
          break;
        case "recheck": {
          label = "넣은 칸";
          const here = entered.filter((x) => x.prim === prim);
          if (here.length === 0) { note = "이 창에 넣은 칸이 없어 볼 것이 없었습니다"; break; }
          const redone: string[] = [];
          for (const x of here) {
            if (await prim.holds(x.target, x.kind, x.value, timeout)) continue;
            // 한 번만 다시 넣는다 — 넣기 · 고르기 · 체크가 각자 되읽기까지 하므로, 그래도 안 맞으면 거기서 멈춘다
            if (x.kind === "fill") await prim.fill(x.target, String(x.value), timeout);
            else if (x.kind === "select") await prim.select(x.target, String(x.value), timeout);
            else await prim.check(x.target, x.value === true, timeout);
            redone.push(x.target.label);
          }
          note = redone.length === 0 ? `넣은 칸 ${here.length}개가 그대로입니다`
            : `넣은 칸 ${here.length}개 중 ${redone.length}개가 바뀌어 있어 다시 넣었습니다 — ${redone.join(" · ")}`;
          break;
        }
        case "press":
          label = a.target?.label ?? "페이지";
          await prim.press(a.target, a.key, timeout);
          note = `${label}에서 ${a.key} 눌렀습니다`;
          break;
        case "wait":
          label = "target" in a.wait ? a.wait.target.label : a.wait.kind;
          if (a.wait.kind === "changed" && skipped) { note = `앞 동작을 건너뛰어 바뀔 것이 없으므로 기다리지 않았습니다 — ${label}`; break; }
          note = (await prim.wait(a.wait, timeout, before)) ?? `기다렸습니다 — ${label}`;
          break;
        case "read": {
          label = a.target.label;
          const raw = await prim.read(a.target, a.strategy, a.attribute, timeout);
          const v = a.transform === "number" ? toNumber(raw, label) : raw;
          out[a.output] = v;
          note = `${label} → ${a.output} = ${JSON.stringify(v)}`;
          break;
        }
        case "readTable": {
          label = a.table.label;
          const r = await prim.readTable(a.table, timeout);
          out[a.output] = r.rows;
          note = `${label} → ${a.output} (${r.rows.length}행)${r.note ? ` — ${r.note}` : ""}`;
          break;
        }
        case "switchWindow": {
          // 지금 창이 연 창 중 아직 머물지 않은 것 — 가장 최근 것. 열릴 때까지 시간 제한만큼 기다린다
          label = "새 창";
          const opener = prim.page;
          const until = Date.now() + timeout;
          let found: Page | null = null;
          for (;;) {
            for (const p of opener.context().pages()) {
              if (p === opener || p.isClosed() || visited.has(p)) continue;
              if ((await p.opener().catch(() => null)) === opener) found = p;
            }
            if (found || Date.now() > until) break;
            await pause(100, env.signal);
          }
          if (!found) {
            throw new StepError({ problem: "timeout", message: `새 창이 열리지 않았습니다(${durationText(timeout)} 기다림) — 앞 동작이 창을 여는지 확인하세요`, label: "새 창", locator: null, candidates: [] });
          }
          await found.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
          visited.add(found);
          stack.push(prim);
          prim = env.primFor(found);
          env.onPage?.(found, true);
          note = `새로 열린 창으로 옮겼습니다(${found.url()})`;
          break;
        }
        case "closeWindow": {
          label = "창";
          if (stack.length === 0) {
            throw new StepError({ problem: "noPage", message: "닫고 돌아갈 창이 없습니다 — 이 노드에서 연 팝업만 닫을 수 있습니다", label: null, locator: null, candidates: [] });
          }
          await prim.page.close().catch(() => undefined);
          goBack();
          note = "창을 닫고 연 창으로 돌아왔습니다";
          break;
        }
        case "pickRow": {
          label = a.pick.label;
          const key = a.pick.keyLabel || "키";
          const v = valueOf(a.pick.value, key);
          const r = await prim.pickRow(a.pick, v, timeout);
          note = a.pick.by === "index" ? `${label}에서 ${r.index + 1}번째 행을 골랐습니다` : `${label}에서 ${key} "${v}"인 행(${r.index + 1}번째)을 골랐습니다`;
          break;
        }
        case "human": {
          label = a.prompt;
          const waitMs = a.timeoutMs ?? HUMAN_TIMEOUT.defaultMs;
          const page = prim.page;
          // «이 화면일 때만» — 없으면 «끝났다는 표시가 사라지는 것»(로그인 단추가 사라지면)을 화면으로 본다
          const appears = a.appears ?? (a.done.kind === "hidden" ? a.done.target : null);
          if (appears) {
            const there = await locateAll(page, appears).first().waitFor({ state: "visible", timeout: HUMAN_APPEARS_MS }).then(() => seen(page, appears), () => false);
            if (!there) { note = `${appears.label}이(가) 없어 기다리지 않았습니다(이 화면일 때만)`; break; }
          } else if (await humanDone(page, a.done)) {
            note = "이미 끝나 있어 기다리지 않았습니다";
            break;
          }
          if (!env.human) {
            throw new StepError({
              problem: "other", label: a.prompt, locator: null, candidates: [],
              message: `사람을 기다려야 하는데 이 실행은 사람이 화면을 만질 수 없습니다 — 사람의 크롬(attach)에서 돌리거나, 서버 · 화면이 보이는 워커에서 돌리세요(«${a.prompt}»)`,
            });
          }
          const deadline = Date.now() + waitMs;
          env.human.waiting({ index, actionId: a.id, prompt: a.prompt, deadline: new Date(deadline).toISOString() });
          env.step({ index, id: a.id, kind: a.kind, label, ms: 0, note: `사람을 기다립니다 — «${a.prompt}» (${durationText(waitMs)}까지)` });
          let outcome: "done" | "timeout" | "stopped" | "failed" = "failed";
          try {
            // ★한 번에 오래 기다리지 않고 조금씩 본다 — 멈추기 · 창 닫힘을 바로 알고, 로그인 중 페이지가 바뀌어도 따라간다
            for (;;) {
              if (env.signal?.aborted) { outcome = "stopped"; throw new RunStopped(); }
              if (page.isClosed()) throw new StepError({ problem: "noPage", message: `사람을 기다리는 동안 창이 닫혔습니다(«${a.prompt}»)`, label: a.prompt, locator: null, candidates: [] });
              if (await humanFinished(page, a)) break;
              if (Date.now() > deadline) {
                outcome = "timeout";
                // 무엇이 안 맞았나 — 고칠 곳을 알게(로그인 화면의 요소가 로그인 뒤에도 남는 것을 골랐을 수 있다)
                const why = !(await humanDone(page, a.done)) ? `끝났다는 표시(${a.done.kind === "url" ? `주소 /${a.done.pattern}/` : a.done.target.label})가 오지 않았습니다`
                  : `«이 화면일 때만»의 ${a.appears?.label ?? "요소"}이(가) 아직 보입니다 — 로그인 화면에만 있는 요소인지 확인하세요`;
                throw new StepError({ problem: "timeout", message: `사람을 ${durationText(waitMs)} 기다렸지만 끝나지 않았습니다 — «${a.prompt}» · ${why}`, label: a.prompt, locator: null, candidates: [] });
              }
              await pause(HUMAN_POLL_MS, env.signal);
            }
            outcome = "done";
          } finally {
            env.human.finished({ index, actionId: a.id, prompt: a.prompt, outcome });
          }
          note = `사람이 끝냈습니다 — ${durationText(Date.now() - started)} 기다림`;
          break;
        }
        case "save": {
          label = "파일로 저장";
          const saved = await saveFile(a, prim.page, env.files, (t, w) => valueOf(t, w), a.timeoutMs ?? SAVE_TIMEOUT_MS);
          label = saved.path;
          note = saved.note;
          if (a.output) out[a.output] = saved.path;
          break;
        }
        case "walletApprove": {
          label = "MetaMask 승인";
          const page = prim.page;
          if (!a.atLeast && await humanDone(page, a.done)) { note = "이미 끝나 있어 승인하지 않았습니다"; break; }
          if (!env.wallet) {
            throw new StepError({ problem: "other", label, locator: null, candidates: [], message: "MetaMask 승인은 지갑 브라우저(MetaMask)에서만 됩니다 — 워크플로우 설정의 브라우저를 확인하세요" });
          }
          const n = await env.wallet.approve(page, () => humanDone(page, a.done), a.timeoutMs ?? WALLET_APPROVE_TIMEOUT.defaultMs, a.atLeast);
          note = n > 0 ? `MetaMask 화면 ${n}개를 승인했습니다 — ${durationText(Date.now() - started)}` : "승인할 화면 없이 끝났다는 표시가 왔습니다";
          break;
        }
        case "assert": {
          label = a.target.label;
          const want = valueOf(a.equals, label);
          const got = await prim.read(a.target, a.strategy, null, timeout);
          if (norm(String(got ?? "")) !== norm(want)) {
            throw new StepError({
              problem: "mismatch",
              message: `${label}: 기대 "${want}" · 화면 "${String(got ?? "")}" — ${PROBLEMS.mismatch}`,
              label, locator: a.target.locators[0]!, candidates: [],
            });
          }
          note = `${label} 확인 — "${want}"`;
          break;
        }
      }
      if (attempt > 0) note += ` — ${attempt + 1}번째에 됨`;
      break;
    } catch (e) {
      if (env.signal?.aborted || e instanceof RunStopped) throw new RunStopped();
      // 팝업이 닫히는 중에 이 동작이 그 창에서 시작했다 — 동작은 일어나지 않았다. 연 창으로 돌아가 다시 한다(창이 쌓인 만큼만)
      if (prim.page.isClosed() && goBack()) { attempt--; continue; }
      const f = toFailure(e);
      if (attempt < tries && retryable(f.problem)) {
        env.step({ index, id: a.id, kind: a.kind, label: label || a.kind, ms: Date.now() - started, note: `다시 해 봅니다(${attempt + 1}/${tries}) — ${f.message.split("\n")[0]}` });
        await pause(env.retry?.delayMs ?? 2_000, env.signal);
        continue;
      }
      const where = { action: { index, id: a.id, kind: a.kind }, url: prim.page.isClosed() ? null : prim.page.url() };
      if (e instanceof StepError) throw e.with(where);
      const target = "target" in a && a.target ? a.target : null;
      throw new StepError({
        ...f, ...where,
        label: f.label ?? (target?.label ?? (label || null)),
        locator: f.locator ?? target?.locators[0] ?? null,
        message: `동작 ${index}(${a.kind}${label ? ` · ${label}` : ""}): ${f.message.split("\n")[0]}${target ? ` — ${describeLocator(target.locators[0]!)}` : ""}${attempt > 0 ? ` (${attempt + 1}번 해 봄)` : ""}`,
      });
    }
    }
    // 창이 스스로 닫혔으면(팝업의 닫기 단추) 연 창으로 돌아간다
    if (prim.page.isClosed() && goBack()) note += " — 창이 닫혀 연 창으로 돌아왔습니다";
    before = baseline;
    prevSkipped = false;
    env.step({ index, id: a.id, kind: a.kind, label, ms: Date.now() - started, note });
    // 동작 사이 쉬기(사람이 하는 빠르기) — 멈추기를 누르면 바로 깬다
    const p = env.actionPause;
    if (p && p.maxMs > 0) await pause(p.minMs + Math.floor(Math.random() * (p.maxMs - p.minMs + 1)), env.signal);
  }
  return out;
}
