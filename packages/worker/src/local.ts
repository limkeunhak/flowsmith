/**
 * **같은 프로세스 워커** — 엔진을 이 프로세스에서 돌린다.
 * standalone 서버가 이것 하나로 돌고, 사람 PC의 워커 프로그램(agent.ts)도 안에서 이것을 쓴다.
 * 브라우저는 처음 필요할 때 띄우고 실행마다 새 컨텍스트를 쓴다.
 * 지갑 브라우저(PLAN §44)는 **창이 보이는 워커**(--headed · 화면이 있는 PC)만 연다 — MetaMask는 처음 쓸 때 받는다(metamask.ts).
 */
import { chromium, type Browser } from "playwright";
import { ExtensionRegistry, runFlow, type MetaMaskEnv, type RunEvent, type RunResult } from "@flowsmith/engine";
import type { RunHooks, RunJob, WorkerClient } from "./job.ts";
import { ensureMetaMask, hasDisplay, walletDirs } from "./metamask.ts";

export class InProcessWorker implements WorkerClient {
  readonly #headless: boolean;
  readonly #cdpUrl: string | undefined;
  readonly #extensions: ExtensionRegistry;
  readonly #filesDir: string | undefined;
  readonly #wallet: MetaMaskEnv | null;
  #browser: Promise<Browser> | null = null;

  constructor(opts: { headless?: boolean; cdpUrl?: string; extensions?: ExtensionRegistry; /** 파일 쓰기 노드의 파일 뿌리 */ filesDir?: string; /** 지갑 폴더(시험) — 없으면 이 PC의 것 */ wallet?: MetaMaskEnv } = {}) {
    this.#headless = opts.headless ?? true;
    this.#filesDir = opts.filesDir;
    this.#cdpUrl = opts.cdpUrl;
    this.#extensions = opts.extensions ?? new ExtensionRegistry();
    // ★창을 띄울 수 있을 때만 — 창 없는 크롬은 MetaMask 승인 창을 열지 않는다
    this.#wallet = !this.#headless && hasDisplay() ? opts.wallet ?? walletDirs() : null;
  }

  /** 이 워커가 할 수 있는 일 — 서버가 실행을 보낼 곳을 고를 때 본다(wallet: 지갑 브라우저) */
  get capabilities(): string[] { return this.#wallet ? ["wallet"] : []; }

  /** 이 워커에 깔린 확장 — 원격 워커가 서버에 알린다 */
  get extensions(): ExtensionRegistry { return this.#extensions; }
  /** 이 PC의 크롬(attach) · 브라우저를 창 없이 띄우나 — 원격 워커의 녹화가 같은 것을 쓴다 */
  get cdpUrl(): string | undefined { return this.#cdpUrl; }
  get headless(): boolean { return this.#headless; }

  #getBrowser(): Promise<Browser> {
    if (this.#browser === null) {
      this.#browser = chromium.launch({ headless: this.#headless }).then((b) => {
        // 브라우저가 죽으면 다음 실행에서 다시 띄운다
        b.on("disconnected", () => { this.#browser = null; });
        return b;
      }, (e) => { this.#browser = null; throw e; });
    }
    return this.#browser;
  }

  async run(job: RunJob, onEvent: (e: RunEvent) => void, hooks: RunHooks = {}): Promise<RunResult> {
    hooks.onPlaced?.(null);
    // attach 플로우는 사람의 크롬에 붙는다 — 우리 브라우저는 띄우지 않는다
    const browser = job.flow.settings.browser === "launch" ? await this.#getBrowser() : undefined;
    const where = { ...(job.flowUid ? { flowUid: job.flowUid } : {}), ...(job.flowUids ? { flowUids: job.flowUids } : {}) };
    const files = hooks.fileOps ? { ops: hooks.fileOps, ...where } : this.#filesDir ? { root: this.#filesDir, ...where } : null;
    // 지갑 브라우저 — MetaMask를 (처음이면 받아) 넘긴다. 못 여는 워커면 넘기지 않는다(엔진이 이유와 함께 멈춘다)
    const metamask = job.flow.settings.browser === "wallet" && this.#wallet ? { ...this.#wallet, extensionDir: await ensureMetaMask(this.#wallet) } : null;
    return runFlow(job.flow, {
      ...(metamask ? { metamask } : {}),
      // ★시작할 때의 확장으로 끝까지 — 도중에 플러그인이 바뀌어도(PLAN §41)
      runId: job.runId, params: job.params, secrets: job.secrets, onEvent, extensions: this.#extensions.snapshot(), probe: job.probe ?? false,
      ...(browser ? { browser } : {}), ...(this.#cdpUrl ? { cdpUrl: this.#cdpUrl } : {}),
      ...(files ? { files } : {}),
      ...(hooks.callFlow ? { callFlow: hooks.callFlow } : {}),
      ...(hooks.approval ? { approval: hooks.approval } : {}),
      ...(hooks.onPage ? { onPage: hooks.onPage } : {}),
      ...(hooks.signal ? { signal: hooks.signal } : {}),
      // 사람 기다리기 — 사람이 화면을 만질 수 있나: 사람의 크롬 · 창이 보이는 브라우저(이 PC) · 서버의 실행 화면(onPage를 받는다)
      human: job.flow.settings.browser === "attach" || !this.#headless || hooks.onPage !== undefined,
      ...(job.stopBefore ? { stopBefore: job.stopBefore } : {}), ...(job.stopAfter ? { stopAfter: job.stopAfter } : {}),
      ...(job.pins ? { pins: job.pins } : {}),
    });
  }

  async close(): Promise<void> {
    const b = this.#browser;
    this.#browser = null;
    if (b) await (await b).close().catch(() => undefined);
  }
}
