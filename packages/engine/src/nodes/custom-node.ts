/**
 * 커스텀 노드 — 사용자가 쓴 async 함수 몸통을 돌린다 (PLAN §3.6).
 *
 *   (async function (input, page, ctx) { …사용자 코드… })
 *
 * ★`page`는 **날 Playwright Page**다(결정 4). 금지 버튼 가드 밖이다.
 * ★시크릿은 안 준다 — `ctx`에 없다. 실행 결과의 가림은 실행기가 이 노드 출력에도 똑같이 건다.
 * ☆`node:vm`은 보안 경계가 아니다. 동기 무한 루프와 늦는 Promise에 시간 제한을 거는 용도다.
 */
import vm from "node:vm";
import type { BrowserContext, Page } from "playwright";
import type { CustomNode, Output } from "@flowsmith/core";

export const DEFAULT_CUSTOM_TIMEOUT_MS = 30_000;

export class CustomNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomNodeError";
  }
}

export interface CustomEnv {
  page: Page | null;
  context: BrowserContext | null;
  params: Record<string, unknown>;
  vars: Record<string, string>;
  log(text: string): void;
}

const show = (v: unknown): string => (typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());

export async function runCustomNode(node: CustomNode, input: Output, env: CustomEnv): Promise<Output> {
  const { code, outputs, usesPage } = node.config;
  const timeout = node.config.timeoutMs ?? DEFAULT_CUSTOM_TIMEOUT_MS;
  if (usesPage && env.page === null) throw new CustomNodeError("page를 쓴다고 했는데 브라우저가 없습니다");

  const log = (...a: unknown[]) => env.log(a.map(show).join(" "));
  const sandbox = vm.createContext({
    console: { log, info: log, warn: log, error: log },
    // 새 컨텍스트에는 JS 내장만 있다 — 사용자 코드가 흔히 쓰는 Node/웹 전역을 넣어 준다
    setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone,
    __input: structuredClone(input),
    __page: env.page,
    __ctx: Object.freeze({ context: env.context, params: structuredClone(env.params), vars: { ...env.vars }, log }),
  });

  let fn: vm.Script;
  try {
    fn = new vm.Script(`(async function (input, page, ctx) {\n${code}\n})(__input, __page, __ctx)`, { filename: `custom-node:${node.id}` });
  } catch (e) {
    throw new CustomNodeError(`코드를 읽을 수 없습니다 — ${(e as Error).message}`);
  }

  let timer: NodeJS.Timeout | undefined;
  let result: unknown;
  try {
    // 동기 부분은 vm의 timeout이, 비동기 부분은 아래 경주가 끊는다
    const p = fn.runInContext(sandbox, { timeout }) as Promise<unknown>;
    result = await Promise.race([
      p,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new CustomNodeError(`${timeout}ms 안에 끝나지 않았습니다`)), timeout); }),
    ]);
  } catch (e) {
    if (e instanceof CustomNodeError) throw e;
    // vm 안에서 던진 Error는 다른 realm의 것이라 instanceof가 안 맞는다 — 이름과 메시지로 옮긴다
    const err = e as { name?: string; message?: string };
    if (err?.message?.includes("Script execution timed out")) throw new CustomNodeError(`${timeout}ms 안에 끝나지 않았습니다(동기 코드)`);
    throw new CustomNodeError(`${err?.name ?? "Error"}: ${err?.message ?? String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new CustomNodeError(`객체를 돌려줘야 합니다 — 받은 것: ${show(result)?.slice(0, 80) ?? String(result)}`);
  }
  const got = result as Record<string, unknown>;
  const missing = outputs.filter((k) => !(k in got));
  if (missing.length > 0) throw new CustomNodeError(`outputs에 적은 ${missing.map((k) => `"${k}"`).join(", ")}를 돌려주지 않았습니다`);

  // ★적은 이름만 내보낸다 — 뒤 노드의 `$input.x` 검사가 outputs를 보고 했기 때문이다
  const extra = Object.keys(got).filter((k) => !outputs.includes(k));
  if (extra.length > 0) env.log(`outputs에 없는 ${extra.join(", ")}는 내보내지 않았습니다`);
  const picked = Object.fromEntries(outputs.map((k) => [k, got[k] === undefined ? null : got[k]]));
  try {
    return JSON.parse(JSON.stringify(picked)) as Output;
  } catch (e) {
    throw new CustomNodeError(`돌려준 값을 JSON으로 옮길 수 없습니다 — ${(e as Error).message}`);
  }
}
