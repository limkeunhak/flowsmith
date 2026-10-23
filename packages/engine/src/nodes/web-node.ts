/**
 * 웹페이지 노드 — 시작 주소로 가서(또는 앞 페이지에서 이어서) 녹화된 동작을 차례로 한다 (PLAN §3.4).
 *
 * ★동작 하나가 실패하면 노드가 실패한다. 다음 동작으로 넘어가지 않는다 —
 *  «조회»를 못 눌렀는데 «상태 읽기»를 하면 앞 화면의 값을 읽는다.
 * ★창(B1): 누르기가 팝업을 열면 그 창으로 옮겨 가고, 창이 닫히면(닫기 단추가 창을 닫아도) 연 창으로 돌아온다.
 *  노드가 끝날 때 머문 창을 실행기에 알린다 — 다음 노드의 «이어서»가 거기서 시작한다.
 */
import type { Page } from "playwright";
import { checkRule, durationText, evaluate, HUMAN_TIMEOUT, type HumanDone, type Output, type ProbeFinding, type Scope, type Target, type WebAction, type WebNode } from "@flowsmith/core";
import { describeLocator, locateAll } from "../browser/locate.ts";
import { pause, PROBLEMS, retryable, RunStopped, StepError, toFailure } from "../errors.ts";
import type { Primitives } from "../browser/primitives.ts";
import { inspectTarget, ProbeStop, probeTargets } from "../probe.ts";

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
  scope: Scope;
  defaultTimeoutMs: number;
  step(s: StepLog): void;
  /** 점검 실행이면 — 동작마다 요소를 살펴 알린다(되돌릴 수 없는 동작 앞에서 멈춘다) */
  probe?: { report(f: ProbeFinding): void };
  /** 멈추기 · 전체 시간 제한 — 켜지면 다음 동작 앞에서 멈춘다 */
  signal?: AbortSignal;
  /** 실패하면 다시 — 플로우 설정(동작마다 따로 정할 수 있다) */
  retry?: { count: number; delayMs: number };
  /**
   * 사람이 이 실행의 화면을 만질 수 있으면 — 사람의 크롬(attach) · 서버의 실행 화면 · 화면이 보이는 워커.
   * 없으면 «사람 기다리기»는 기다리지 않고 바로 멈춘다(아무도 로그인할 수 없다)
   */
  human?: HumanHooks;
}

const str = (v: unknown, what: string): string => {
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

export async function runWebNode(node: WebNode, env: NodeEnv): Promise<Output> {
  const { scope } = env;
  let prim = env.prim;
  /** 연 창들 — 팝업으로 옮겨 가면 쌓고, 닫히면 꺼낸다 */
  const stack: Primitives[] = [];
  const goBack = (): boolean => {
    const back = stack.pop();
    if (!back) return false;
    prim = back;
    env.onPage?.(prim.page, false);
    return true;
  };
  const out: Output = {};
  const noSecrets: Scope = { ...scope, secrets: {} };

  const t0 = Date.now();
  if (node.config.start.kind === "url") {
    const url = str(evaluate(node.config.start.url, noSecrets).value, "시작 주소");
    await prim.goto(url, env.defaultTimeoutMs);
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
    const index = i + 1;
    const timeout = a.timeoutMs ?? env.defaultTimeoutMs;
    const started = Date.now();
    // ★시크릿은 넣기 · 고르기 값에서만 꺼낸다 (검문소가 이미 막지만 실행에서도 한 번 더)
    const valueOf = (template: string, what: string) =>
      str(evaluate(template, a.kind === "fill" || a.kind === "select" ? scope : noSecrets).value, what);

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
    const tries = a.risk === "safe" && a.kind !== "human" ? (a.retries ?? env.retry?.count ?? 0) : 0;
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
          if (a.popup) {
            // 팝업 — 누르는 것과 새 창을 같이 기다린다(누른 뒤에 기다리면 이미 열린 창을 놓친다)
            const [popup, r] = await Promise.all([prim.page.waitForEvent("popup", { timeout }), prim.click(a.target, timeout)]);
            await popup.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
            stack.push(prim);
            prim = env.primFor(popup);
            env.onPage?.(popup, true);
            note = `${label} 눌렀습니다 — 새 창으로 옮겼습니다(${popup.url()})${r.how === "이벤트" ? " · 이벤트로 누름" : ""}`;
          } else {
            const r = await prim.click(a.target, timeout);
            note = `${label} 눌렀습니다${r.how === "이벤트" ? " (좌표가 안 먹어 이벤트로)" : ""}`;
          }
          break;
        }
        case "fill": {
          label = a.target.label;
          const v = valueOf(a.value, label);
          const r = await prim.fill(a.target, v, timeout);
          note = `${label}에 "${v}" 넣었습니다${r.retried ? " (한 번 다시 넣음)" : ""}`;
          break;
        }
        case "select": {
          label = a.target.label;
          const v = valueOf(a.value, label);
          const r = await prim.select(a.target, v, timeout);
          note = `${label}에서 "${v}" 골랐습니다(${r.by}으로)`;
          break;
        }
        case "check":
          label = a.target.label;
          await prim.check(a.target, a.checked, timeout);
          note = `${label} ${a.checked ? "켰습니다" : "껐습니다"}`;
          break;
        case "press":
          label = a.target?.label ?? "페이지";
          await prim.press(a.target, a.key, timeout);
          note = `${label}에서 ${a.key} 눌렀습니다`;
          break;
        case "wait":
          label = "target" in a.wait ? a.wait.target.label : a.wait.kind;
          await prim.wait(a.wait, timeout);
          note = `기다렸습니다 — ${label}`;
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
          const rows = await prim.readTable(a.table, timeout);
          out[a.output] = rows;
          note = `${label} → ${a.output} (${rows.length}행)`;
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
    env.step({ index, id: a.id, kind: a.kind, label, ms: Date.now() - started, note });
  }
  return out;
}
