/**
 * **알림** — 실행이 끝나거나 변경 감시가 «사이트가 바뀜»을 찾으면 플로우 설정의 규칙대로 보낸다 (PLAN §15 · core notify.ts).
 *
 *   언제   실패 · 회복(실패 뒤 성공) · 성공 · 멈춤 · 사이트가 바뀜 · 사람을 기다림(사람 기다리기 동작 — 끝나기 전에 보낸다)
 *   어디로 Slack(Incoming Webhook) · Teams(Workflows 웹훅 — Adaptive Card) · 웹훅(JSON) · 메일(서버의 SMTP — 결과를 엑셀로 붙일 수 있다)
 *
 * ★게시된 버전의 실행 · 점검만 알린다. 초안 시험 · 다른 플로우가 부른 실행은 알리지 않는다(부른 쪽이 알린다).
 * ★실패 · 사이트 바뀜이 이어지면 처음 한 번만(firstOnly) — 회복하면 다시 처음부터.
 * ★보낸 것은 notice에 남긴다(됐나 · 왜 안 됐나). **주소는 남기지 않는다** — Slack 웹훅 주소는 그 자체가 열쇠다.
 * ☆실행을 붙잡지 않는다 — 뒤에서 보내고, 못 보내면 기록만 남긴다(한 번 더 해 본다).
 */
import {
  EMAIL_RE, evaluate, NOTIFY_EVENT_LABEL, recipientsOf, redact, tablesOf, toXlsx, XLSX_TYPE,
  type Flow, type NotifyChannel, type NotifyEvent, type NotifyRule, type ProbeReport, type SecretValue, durationText, ROLE_LABEL, TRIGGER_LABEL,
} from "@flowsmith/core";
import { enginePolicy, type RunResult } from "@flowsmith/engine";
import type { Secrets } from "../storage/secrets.ts";
import type { NoticeRow, RunTrigger, Store } from "../storage/store.ts";
import type { MailMessage, Mailer } from "./mailer.ts";

/** 알림 한 건의 내용 — 채널마다 모양만 다르게 싼다 */
export interface Notice {
  event: NotifyEvent | "test";
  title: string;
  /** 줄마다 — 「무엇: …」 */
  facts: { name: string; value: string }[];
  link: string;
  flow: { id: string; name: string; version: number | null };
  run?: { id: string; status: string; message: string; trigger: string; ms: number | null; failedNode: string | null };
  probe?: { id: string; status: string; source: string; message: string };
  at: string;
}

/** 알림 속 «고치려면» — 실패 카드의 단추와 같은 말 */
const FIX_STEP: Partial<Record<string, string>> = {
  missing: "링크를 눌러 실패 카드의 [다시 지정]으로 그 요소를 페이지에서 다시 고르세요(입력값이 틀려도 이렇게 될 수 있습니다)",
  many: "링크를 눌러 실패 카드의 [다시 지정]으로 더 정확히 고르세요",
  notFilled: "링크를 눌러 실패 카드의 [다시 지정]으로 칸을 다시 고르세요",
  timeout: "사이트가 잠깐 느렸다면 다음 실행에서 됩니다 — 계속되면 링크에서 [다시 해 보기 켜기]",
  refused: "사이트 문제가 아니라 입력값의 문제입니다 — 입력값을 확인하세요",
  mismatch: "사이트 문제가 아니라 입력값의 문제입니다 — 입력값을 확인하세요",
};

const EMOJI: Record<Notice["event"], string> = { failure: "❌", recovered: "✅", success: "✅", cancelled: "⏹️", blocked: "🚫", drift: "⚠️", human: "🙋", approval: "🛡️", test: "🔔" };
const when = (d: Date) => d.toLocaleString("ko-KR", { hour12: false });
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

/** 채널마다의 본문 */
export function payloadFor(channel: NotifyChannel, n: Notice): unknown {
  switch (channel) {
    case "slack": {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const lines = [`*${esc(n.title)}*`, ...n.facts.map((f) => `• ${esc(f.name)}: ${esc(f.value)}`), `<${n.link}|Flowsmith에서 열기>`];
      return { text: lines.join("\n") };
    }
    case "teams":
      return {
        type: "message",
        attachments: [{
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
            body: [
              { type: "TextBlock", text: n.title, weight: "Bolder", size: "Medium", wrap: true },
              { type: "FactSet", facts: n.facts.map((f) => ({ title: f.name, value: f.value })) },
            ],
            actions: [{ type: "Action.OpenUrl", title: "Flowsmith에서 열기", url: n.link }],
          },
        }],
      };
    case "webhook":
    case "email":
      return n;
  }
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 메일 — 글자판과 HTML판(표) */
export function mailFor(n: Notice): Pick<MailMessage, "subject" | "text" | "html"> {
  const text = [n.title, "", ...n.facts.map((f) => `${f.name}: ${f.value}`), "", `Flowsmith에서 열기: ${n.link}`].join("\n");
  const rows = n.facts.map((f) => `<tr><th align="left" style="padding:4px 12px 4px 0;color:#666;font-weight:normal;white-space:nowrap;vertical-align:top">${html(f.name)}</th><td style="padding:4px 0">${html(f.value)}</td></tr>`).join("");
  return {
    subject: n.title, text,
    html: `<div style="font-family:'Malgun Gothic',sans-serif;font-size:14px"><h2 style="font-size:17px;margin:0 0 12px">${html(n.title)}</h2><table style="border-collapse:collapse">${rows}</table><p style="margin-top:16px"><a href="${html(n.link)}">Flowsmith에서 열기</a></p></div>`,
  };
}

export interface SendResult { ok: boolean; status: number | null; error: string }

export interface NotifierOptions {
  /** 알림 속 링크의 앞부분 — FLOWSMITH_PUBLIC_URL(없으면 서버 주소) */
  publicUrl: () => string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 못 보냈을 때 다시 해 보기 전에 쉬는 시간 */
  retryDelayMs?: number;
  /** 메일 채널 — 서버에 SMTP가 정해져 있을 때만(없으면 «보낼 서버가 없음») */
  mailer?: Mailer | null;
}

export interface RunFinished {
  flow: Flow;
  version: number | null;
  runId: string;
  parentRunId: string | null;
  trigger: RunTrigger;
  status: "success" | "failure" | "cancelled" | "blocked";
  message: string;
  result: RunResult | null;
  ms: number | null;
}

export interface HumanWaiting {
  flow: Flow;
  version: number | null;
  runId: string;
  trigger: RunTrigger;
  /** 무엇을 해 달라는지(동작의 안내 문구) · 어느 노드 · 언제까지 */
  prompt: string;
  nodeName: string;
  deadline: string;
}

export interface ApprovalWaiting {
  flow: Flow;
  version: number | null;
  runId: string;
  trigger: RunTrigger;
  message: string;
  nodeName: string;
  minRole: "runner" | "editor" | "admin";
  deadline: string;
}

export interface ProbeFinished {
  flow: Flow;
  version: number | null;
  probeId: string;
  source: "probe" | "run";
  report: ProbeReport;
}

export class Notifier {
  readonly #store: Store;
  readonly #secrets: Secrets;
  readonly #opts: NotifierOptions;
  readonly #pending = new Set<Promise<unknown>>();

  constructor(store: Store, secrets: Secrets, opts: NotifierOptions) {
    this.#store = store;
    this.#secrets = secrets;
    this.#opts = opts;
  }

  #link(flowId: string, runId?: string, panel?: "monitor"): string {
    const base = this.#opts.publicUrl().replace(/\/+$/, "");
    return `${base}/#/flows/${encodeURIComponent(flowId)}${runId ? `/runs/${encodeURIComponent(runId)}` : panel ? `/${panel}` : ""}`;
  }

  /** 실행이 끝났다 — 무엇을 알릴지 정하고 보낸다 */
  runFinished(r: RunFinished): void {
    const rules = r.flow.settings.notify.filter((x) => x.enabled);
    if (rules.length === 0 || r.version === null || r.parentRunId !== null) return;
    const prev = r.status === "cancelled" ? null : this.#store.previousRunStatus(r.flow.id, r.runId);
    const failed = r.result?.nodes.find((n) => n.failure);
    const failText = failed ? failed.failure!.message.split("\n")[0]! : "";
    // 노드 실패와 같은 말이면 «무엇»은 빼고 «멈춘 노드»만
    const what = r.message && !(failed && r.message.includes(failText)) ? r.message : !failed && r.status === "success" ? "끝까지 돌았습니다" : "";
    const facts = [
      { name: "무엇", value: what },
      ...(failed ? [{ name: "멈춘 노드", value: `${failed.name} — ${failText}` }] : []),
      ...(failed?.failure && FIX_STEP[failed.failure.problem] ? [{ name: "고치려면", value: FIX_STEP[failed.failure.problem]! }] : []),
      { name: "어떻게", value: `${TRIGGER_LABEL[r.trigger]} 실행 · 버전 ${r.version}${r.ms !== null ? ` · ${durationText(r.ms)}` : ""}` },
      { name: "언제", value: when(new Date()) },
    ].filter((f) => f.value !== "");
    // 메일에 붙일 결과 — 성공한 실행의 출력 중 목록들(목록마다 시트 한 장)
    const tables = r.status === "success" ? tablesOf(r.result?.output) : [];
    for (const rule of rules) {
      const event = this.#runEvent(rule, r.status, prev);
      if (!event) continue;
      const attach = rule.channel === "email" && rule.attach && tables.length > 0
        ? [{ filename: `${r.flow.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || r.flow.id}-결과-${stamp(new Date())}.xlsx`, content: toXlsx(tables), contentType: XLSX_TYPE }]
        : [];
      this.#send(rule, r.flow, r.runId, attach, {
        event, title: `${EMOJI[event]} ${r.flow.name} — ${NOTIFY_EVENT_LABEL[event]}`, facts, link: this.#link(r.flow.id, r.runId),
        flow: { id: r.flow.id, name: r.flow.name, version: r.version },
        run: { id: r.runId, status: r.status, message: r.message, trigger: r.trigger, ms: r.ms, failedNode: failed?.id ?? null },
        at: new Date().toISOString(),
      });
    }
  }

  /** 이 규칙이 이 결과에 무엇을 알리나 — 없으면 null */
  #runEvent(rule: NotifyRule, status: RunFinished["status"], prev: "success" | "failure" | null): NotifyEvent | null {
    // ☆«사람을 기다림»은 끝날 때가 아니라 기다리는 동안 보낸다(humanWaiting)
    if (status === "cancelled") return rule.on.includes("cancelled") ? "cancelled" : null;
    if (status === "blocked") return rule.on.includes("blocked") ? "blocked" : null;
    if (status === "failure") {
      if (!rule.on.includes("failure")) return null;
      return rule.firstOnly && prev === "failure" ? null : "failure";
    }
    if (prev === "failure" && rule.on.includes("recovered")) return "recovered";
    return rule.on.includes("success") ? "success" : null;
  }

  /**
   * 실행이 사람을 기다린다 — 보는 사람이 없는 일정 · 웹훅 실행을 위해 **기다리는 동안** 보낸다(링크로 그 실행을 열어 로그인).
   * ★게시된 버전만(초안 시험은 편집 화면에서 사람이 보고 있다). 다른 워크플로우가 부른 실행도 보낸다 — 누군가 로그인해야 부른 실행도 이어 간다
   */
  humanWaiting(h: HumanWaiting): void {
    const rules = h.flow.settings.notify.filter((x) => x.enabled && x.on.includes("human"));
    if (rules.length === 0 || h.version === null) return;
    const facts = [
      { name: "무엇", value: h.prompt },
      { name: "어디서", value: h.nodeName },
      { name: "언제까지", value: `${when(new Date(h.deadline))} — 넘으면 실행이 실패합니다` },
      { name: "하려면", value: "링크를 눌러 그 실행을 열고 «실제 화면»에서 직접 하세요(사람의 크롬에서 도는 워크플로우면 그 크롬 창에서)" },
      { name: "어떻게", value: `${TRIGGER_LABEL[h.trigger]} 실행 · 버전 ${h.version}` },
    ];
    for (const rule of rules) {
      this.#send(rule, h.flow, h.runId, [], {
        event: "human", title: `${EMOJI.human} ${h.flow.name} — ${NOTIFY_EVENT_LABEL.human}`, facts, link: this.#link(h.flow.id, h.runId),
        flow: { id: h.flow.id, name: h.flow.name, version: h.version },
        run: { id: h.runId, status: "running", message: h.prompt, trigger: h.trigger, ms: null, failedNode: null },
        at: new Date().toISOString(),
      });
    }
  }

  /** 실행이 승인을 기다린다 — 승인할 사람에게(게시된 버전만 — 초안 시험은 편집 화면에서 사람이 보고 있다) */
  approvalWaiting(a: ApprovalWaiting): void {
    const rules = a.flow.settings.notify.filter((x) => x.enabled && x.on.includes("approval"));
    if (rules.length === 0 || a.version === null) return;
    const facts = [
      { name: "무엇", value: a.message },
      { name: "어디서", value: a.nodeName },
      { name: "누가", value: `${ROLE_LABEL[a.minRole]} 이상` },
      { name: "언제까지", value: `${when(new Date(a.deadline))} — 넘으면 실행이 실패합니다` },
      { name: "하려면", value: "링크를 눌러 그 실행을 열고 [승인] 또는 [거절]을 누르세요" },
      { name: "어떻게", value: `${TRIGGER_LABEL[a.trigger]} 실행 · 버전 ${a.version}` },
    ];
    for (const rule of rules) {
      this.#send(rule, a.flow, a.runId, [], {
        event: "approval", title: `${EMOJI.approval} ${a.flow.name} — ${NOTIFY_EVENT_LABEL.approval}`, facts, link: this.#link(a.flow.id, a.runId),
        flow: { id: a.flow.id, name: a.flow.name, version: a.version },
        run: { id: a.runId, status: "running", message: a.message, trigger: a.trigger, ms: null, failedNode: null },
        at: new Date().toISOString(),
      });
    }
  }

  /** 점검이 끝났다 — 사이트가 바뀌었으면 알린다 */
  probeFinished(p: ProbeFinished): void {
    const rules = p.flow.settings.notify.filter((x) => x.enabled && x.on.includes("drift"));
    if (rules.length === 0 || p.version === null || (p.report.status !== "changed" && p.report.status !== "broken")) return;
    const prev = this.#store.previousProbeStatus(p.flow.id, p.probeId);
    const repeated = prev === "changed" || prev === "broken";
    const shown = p.report.findings.filter((f) => f.status !== "ok").slice(0, 5);
    const facts = [
      { name: "무엇", value: p.report.status === "broken" ? "요소를 못 찾거나 여러 개입니다 — 워크플로우가 멈출 수 있습니다" : "요소의 모양이 녹화 때와 다릅니다" },
      ...shown.map((f) => ({ name: f.label || f.actionId, value: f.differences.join(" · ") || (f.status === "missing" ? "못 찾음" : f.status === "many" ? "여러 개" : "바뀜") })),
      { name: "어떻게", value: `${p.source === "run" ? "실제 실행이 발견해 확인 점검" : "주기 점검"} · 버전 ${p.version}` },
      { name: "고치려면", value: "링크를 눌러 변경 감시에서 바뀐 요소마다 [다시 지정]을 누르고 페이지에서 다시 고른 뒤, 새 버전으로 게시하세요" },
      { name: "언제", value: when(new Date()) },
    ];
    for (const rule of rules) {
      if (rule.firstOnly && repeated) continue;
      this.#send(rule, p.flow, p.probeId, [], {
        event: "drift", title: `${EMOJI.drift} ${p.flow.name} — ${NOTIFY_EVENT_LABEL.drift}`, facts, link: this.#link(p.flow.id, undefined, "monitor"),
        flow: { id: p.flow.id, name: p.flow.name, version: p.version },
        probe: { id: p.probeId, status: p.report.status, source: p.source, message: p.report.message },
        at: new Date().toISOString(),
      });
    }
  }

  /** 시험 보내기 — 규칙이 맞게 닿는지. 기다렸다가 결과를 돌려준다(기록도 남긴다) */
  async test(flow: Pick<Flow, "id" | "name" | "vars" | "secrets">, rule: NotifyRule): Promise<SendResult> {
    const n: Notice = {
      event: "test", title: `${EMOJI.test} ${flow.name} — 시험 알림`,
      facts: [{ name: "무엇", value: "알림 설정을 시험합니다. 이 글이 보이면 잘 닿습니다" }, { name: "언제", value: when(new Date()) }],
      link: this.#link(flow.id), flow: { id: flow.id, name: flow.name, version: null }, at: new Date().toISOString(),
    };
    return this.#deliver(rule, flow, null, n, []);
  }

  /** 메일을 보낼 수 있나 — 화면이 «메일» 채널을 켤지 */
  get mailFrom(): string | null { return this.#opts.mailer?.from ?? null; }

  #send(rule: NotifyRule, flow: Flow, refId: string, attachments: NonNullable<MailMessage["attachments"]>, n: Notice): void {
    const p = this.#deliver(rule, flow, refId, n, attachments).catch((e: unknown) => console.error("알림 기록 실패:", e));
    this.#pending.add(p);
    void p.finally(() => this.#pending.delete(p));
  }

  async #deliver(rule: NotifyRule, flow: Pick<Flow, "id" | "vars" | "secrets"> & { sharedVars?: readonly string[] }, refId: string | null, n: Notice, attachments: NonNullable<MailMessage["attachments"]>): Promise<SendResult> {
    let secrets: Record<string, SecretValue> = {};
    let result: SendResult;
    try {
      secrets = this.#secrets.unlockFor(flow.id, flow.secrets);
      const url = String(evaluate(rule.url, { input: {}, nodes: {}, params: {}, vars: this.#secrets.withShared(flow.id, flow).flow.vars, secrets }).value ?? "").trim();
      if (rule.channel === "email") return this.#record(rule, flow, refId, n, secrets, await this.#mail(url, n, attachments));
      if (!/^https?:\/\//i.test(url)) throw new Error("알림 주소가 http(s) 주소가 아닙니다");
      result = await this.#post(url, payloadFor(rule.channel, n));
      // 연결 실패 · 429 · 5xx면 한 번 더 — 4xx는 주소 · 본문이 틀린 것이라 다시 해도 같다
      if (!result.ok && (result.status === null || result.status === 429 || result.status >= 500)) {
        await new Promise((r) => setTimeout(r, this.#opts.retryDelayMs ?? 3_000));
        result = await this.#post(url, payloadFor(rule.channel, n));
      }
    } catch (e) {
      result = { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
    }
    return this.#record(rule, flow, refId, n, secrets, result);
  }

  #record(rule: NotifyRule, flow: Pick<Flow, "id">, refId: string | null, n: Notice, secrets: Record<string, SecretValue>, r: SendResult): SendResult {
    // ★오류 글에 주소 · 시크릿이 섞여 나오지 않게
    const hide = Object.values(secrets).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v)));
    const result = { ...r, error: redact(r.error, hide).slice(0, 500) };
    this.#store.insertNotice({ flowId: flow.id, ruleId: rule.id, event: n.event, channel: rule.channel, refId, ok: result.ok, status: result.status, error: result.error });
    return result;
  }

  /** 메일 — 연결이 안 되면 한 번 더. 받는 사람이 틀린 것은 다시 해도 같다 */
  async #mail(to: string, n: Notice, attachments: NonNullable<MailMessage["attachments"]>): Promise<SendResult> {
    const mailer = this.#opts.mailer;
    if (!mailer) return { ok: false, status: null, error: "메일을 보낼 서버(SMTP)가 정해지지 않았습니다 — 서버 관리자에게 FLOWSMITH_SMTP_URL을 부탁하세요" };
    const list = recipientsOf(to);
    const bad = list.filter((x) => !EMAIL_RE.test(x));
    if (list.length === 0 || bad.length) return { ok: false, status: null, error: list.length ? `메일 주소를 읽을 수 없습니다 — ${bad.join(", ")}` : "받는 사람이 없습니다" };
    const msg: MailMessage = { to: list, ...mailFor(n), ...(attachments.length ? { attachments } : {}) };
    for (let attempt = 0; ; attempt++) {
      try { await mailer.send(msg); return { ok: true, status: null, error: "" }; } catch (e) {
        const err = e as { responseCode?: number; code?: string; message?: string };
        const permanent = typeof err.responseCode === "number" && err.responseCode >= 500 && err.responseCode < 600;
        if (attempt >= 1 || permanent || err.code === "EAUTH") {
          const why = err.code === "EAUTH" ? "메일 서버 로그인이 안 됩니다(SMTP 사용자 · 비밀번호)" : err.responseCode ? `메일 서버가 거절했습니다(${err.responseCode})` : `메일 서버에 닿지 못했습니다${err.code ? `(${err.code})` : ""}`;
          return { ok: false, status: err.responseCode ?? null, error: `${why} — ${(err.message ?? "").split("\n")[0]!.slice(0, 160)}` };
        }
        await new Promise((r) => setTimeout(r, this.#opts.retryDelayMs ?? 3_000));
      }
    }
  }

  async #post(url: string, body: unknown): Promise<SendResult> {
    try {
      // 서버 안쪽 주소로는 보내지 않는다(엔진 정책 — 사내 서버형)
      if (enginePolicy.httpGuard) await enginePolicy.httpGuard(new URL(url));
      const res = await (this.#opts.fetch ?? fetch)(url, {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8", "user-agent": "Flowsmith" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.#opts.timeoutMs ?? 10_000),
      });
      const text = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 200);
      return { ok: res.ok, status: res.status, error: res.ok ? "" : `HTTP ${res.status}${text ? ` — ${text}` : ""}` };
    } catch (e) {
      if (e instanceof Error && e.name === "BlockedAddressError") return { ok: false, status: null, error: e.message };
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      const timeout = e instanceof Error && e.name === "TimeoutError";
      return { ok: false, status: null, error: timeout ? "시간 안에 답이 없습니다" : `연결하지 못했습니다${cause ? `(${cause})` : ""}` };
    }
  }

  /**
   * Suite가 끝났다 — 규칙 하나에 요약 한 건. ★Suite에는 시크릿 · 변수가 없다 — 주소는 적힌 그대로(표현식 못 씀)
   *  보낸 기록(notice)은 워크플로우의 것이라 남기지 않는다 — 못 보내면 서버 기록에 남긴다
   */
  suiteFinished(rule: { id: string; channel: NotifyChannel; url: string }, s: { suite: { id: string; name: string }; runId: string; event: "failure" | "recovered" | "success"; title: string; facts: { name: string; value: string }[] }): void {
    const base = this.#opts.publicUrl().replace(/\/+$/, "");
    const n: Notice = {
      event: s.event, title: `${s.event === "failure" ? "🧪❌" : "🧪✅"} ${s.title}`, facts: s.facts,
      link: `${base}/#/tests/${encodeURIComponent(s.suite.id)}/runs/${encodeURIComponent(s.runId)}`,
      flow: { id: s.suite.id, name: s.suite.name, version: null }, at: new Date().toISOString(),
    };
    const send = async (): Promise<SendResult> => {
      const url = rule.url.trim();
      if (rule.channel === "email") return this.#mail(url, n, []);
      if (!/^https?:\/\//i.test(url)) return { ok: false, status: null, error: "알림 주소가 http(s) 주소가 아닙니다" };
      let r = await this.#post(url, payloadFor(rule.channel, n));
      if (!r.ok && (r.status === null || r.status === 429 || r.status >= 500)) {
        await new Promise((ok) => setTimeout(ok, this.#opts.retryDelayMs ?? 3_000));
        r = await this.#post(url, payloadFor(rule.channel, n));
      }
      return r;
    };
    const p = send().then((r) => { if (!r.ok) console.error(`Suite «${s.suite.name}» 알림(${rule.channel})을 보내지 못했습니다: ${r.error}`); }, (e: unknown) => console.error("Suite 알림 실패:", e));
    this.#pending.add(p);
    void p.finally(() => this.#pending.delete(p));
  }

  /** 시험용 — 보내는 중인 것이 끝날 때까지 */
  async drain(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }
}

export type { NoticeRow };
