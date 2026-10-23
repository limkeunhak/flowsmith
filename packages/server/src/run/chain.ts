/**
 * **다른 플로우가 끝나면 · 파일이 생기면** — 일정 · 웹훅 말고 실행을 시작하는 두 길 (PLAN §37).
 *
 *   Chainer      앞 플로우의 **게시된 버전** 실행이 성공(또는 실패)하면 뒤 플로우의 게시된 버전을 돌린다(Jenkins upstream · Airflow Dataset).
 *                실행 입력은 표현식 — `$input`이 앞 플로우의 결과. 공용이거나 같은 팀일 때만 · 순환 · 너무 깊은 줄은 막는다.
 *   FileWatcher  공유 폴더(files/shared/<dir>)에 이름이 맞는 **새** 파일이 들어오면 돌린다(Airflow FileSensor).
 *                다 써질 때까지(크기가 두 번 같을 때) 기다린다 · 켜기 전에 있던 파일 · 폴더 · 꼴을 바꾸기 전에 있던 파일로는 돌지 않는다.
 *
 * ★둘 다 게시된 버전만 돌린다(초안 시험은 편집 화면의 일). 시작하지 못하면 실행 기록에 «실패»로 남긴다(조용히 안 돌면 아무도 모른다).
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { evaluate, explainProblems, problemLine } from "@flowsmith/core";
import { StoreError, type Store } from "../storage/store.ts";
import type { Secrets } from "../storage/secrets.ts";
import { sameTeamOrShared, type Runs } from "./runs.ts";

/** 다른 플로우가 끝나면 — 이보다 길게 이어지면 멈춘다(실수로 줄이 끝없이 늘지 않게) */
const MAX_CHAIN = 5;

const why = (e: unknown): string => (e instanceof StoreError ? [e.message, ...explainProblems(e.problems).map(problemLine)].join(" · ") : e instanceof Error ? e.message : String(e));

export interface Finished {
  flowId: string;
  runId: string;
  /** null이면 초안 시험 — 뒤 플로우를 깨우지 않는다 */
  version: number | null;
  status: "success" | "failure" | "cancelled" | "blocked";
  output: Record<string, unknown>;
  /** 이 실행에 이르기까지의 플로우 줄(다른 플로우가 끝나서 · 다른 플로우 실행) */
  chain: string[];
  /** 다른 플로우가 부른 실행 — 부른 쪽이 끝날 때 따로 깨운다(같은 일을 두 번 하지 않게) */
  parentRunId: string | null;
}

export class Chainer {
  readonly #store: Store;
  readonly #runs: Runs;
  readonly #secrets: Secrets;
  constructor(store: Store, runs: Runs, secrets: Secrets) {
    this.#store = store;
    this.#runs = runs;
    this.#secrets = secrets;
  }

  /** 실행이 끝났다 — 이 플로우를 기다리는 뒤 플로우들을 깨운다. 시작한 실행 id들 */
  finished(f: Finished): string[] {
    if (f.version === null || f.parentRunId !== null || f.status === "cancelled") return [];
    const started: string[] = [];
    for (const { id: flowId, version } of this.#store.activeFlows()) {
      let flow;
      try { flow = this.#store.getVersion(flowId, version); } catch { continue; }
      for (const t of flow.settings.after ?? []) {
        if (!t.enabled || t.flowId !== f.flowId || !(t.on as string[]).includes(f.status)) continue;   // 막힘은 이어 가지 않는다(성공도 실패도 아니다)
        const tag = `«${f.flowId}»이(가) ${f.status === "success" ? "성공" : "실패"}해서`;
        let params: Record<string, string> = {};
        const reject = (message: string) => started.push(this.#runs.recordRejected(flowId, version, "after", params, `${tag} — ${message}`));
        if (!sameTeamOrShared(this.#store, f.flowId, flowId)) continue;   // 남의 팀 플로우의 결과로는 깨지 않는다(결과가 새지 않게)
        if (f.chain.includes(flowId) || flowId === f.flowId) { reject(`순환 — ${[...f.chain, f.flowId, flowId].join(" → ")}. 돌리지 않았습니다`); continue; }
        if (f.chain.length + 1 >= MAX_CHAIN) { reject(`너무 길게 이어집니다(${MAX_CHAIN}단까지) — ${[...f.chain, f.flowId].join(" → ")}`); continue; }
        try {
          params = Object.fromEntries(Object.entries(t.params).map(([k, tpl]) => {
            const v = evaluate(tpl, { input: f.output, nodes: {}, params: {}, vars: this.#secrets.withShared(flowId, flow).flow.vars, secrets: {} }).value;
            return [k, v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)];
          }));
        } catch (e) { reject(`실행 입력을 만들지 못했습니다: ${why(e)}`); continue; }
        try {
          started.push(this.#runs.start(flowId, { version, params, trigger: "after", chain: [...f.chain, f.flowId] }));
        } catch (e) { reject(`시작하지 못했습니다: ${why(e)}`); }
      }
    }
    return started;
  }
}

/** 파일 이름 꼴(* · ?) → 정규식 — 대소문자를 가리지 않는다(Windows 공유 폴더) */
export function globToRegex(pattern: string): RegExp {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "iu");
}

export class FileWatcher {
  readonly #store: Store;
  readonly #runs: Runs;
  /** 공유 폴더(files/shared) */
  readonly #shared: string;
  /** 다 써졌는지 — 처음 본 크기(다음 번에도 같으면 돌린다) */
  readonly #pending = new Map<string, number>();
  #timer: NodeJS.Timeout | null = null;

  constructor(store: Store, runs: Runs, filesRoot: string) {
    this.#store = store;
    this.#runs = runs;
    this.#shared = resolve(filesRoot, "shared");
  }

  start(tickMs = 10_000): void {
    this.#timer = setInterval(() => { try { this.tick(); } catch (e) { console.error("파일 확인 실패:", e); } }, tickMs);
    this.#timer.unref();
  }
  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }

  /** 한 번 둘러본다 — 시작한 실행 id들 */
  tick(): string[] {
    const started: string[] = [];
    for (const { id: flowId, version } of this.#store.activeFlows()) {
      let flow;
      try { flow = this.#store.getVersion(flowId, version); } catch { continue; }
      for (const t of flow.settings.fileTriggers ?? []) {
        if (!t.enabled) continue;
        const dir = resolve(this.#shared, t.dir);
        if (dir !== this.#shared && !dir.startsWith(this.#shared + sep)) continue;   // 공유 폴더 밖은 보지 않는다(검문소도 막는다)
        const re = globToRegex(t.pattern);
        let files: { name: string; size: number }[];
        try {
          files = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && re.test(d.name)).map((d) => ({ name: d.name, size: statSync(join(dir, d.name)).size }));
        } catch { continue; }   // 폴더가 아직 없다
        // 폴더 · 꼴이 바뀌었거나 처음이면 — 지금 있는 것은 «본 것»으로 두고 시작한다(켜기 전 파일로는 돌지 않는다)
        const signature = `${t.dir}\u0000${t.pattern}`;
        if (this.#store.fileTriggerSignature(flowId, t.id) !== signature) {
          this.#store.resetFileTrigger(flowId, t.id, signature, files.map((f) => f.name));
          continue;
        }
        const seen = this.#store.seenFiles(flowId, t.id);
        for (const f of files) {
          if (seen.has(f.name)) continue;
          const key = `${flowId}\u0000${t.id}\u0000${f.name}`;
          if (this.#pending.get(key) !== f.size) { this.#pending.set(key, f.size); continue; }   // 아직 쓰는 중일 수 있다
          this.#pending.delete(key);
          this.#store.markFileSeen(flowId, t.id, f.name);
          const params = t.param ? { [t.param]: f.name } : {};
          try {
            started.push(this.#runs.start(flowId, { version, params, trigger: "file" }));
          } catch (e) {
            started.push(this.#runs.recordRejected(flowId, version, "file", params, `파일 «${f.name}»이(가) 생겨서 — 시작하지 못했습니다: ${why(e)}`));
          }
        }
      }
    }
    return started;
  }
}
