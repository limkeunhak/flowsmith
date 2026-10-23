#!/usr/bin/env node
/**
 * 플로우를 터미널에서 돌린다 — 서버(M2) 전까지의 실행 창구.
 *
 *   node packages/engine/src/cli.ts run <flow.json> [--param k=v]… [--var k=v]… [--secrets <file.json>] [--headed] [--json]
 *   node packages/engine/src/cli.ts check <flow.json>
 *
 * --secrets 파일 모양: { "shop": { "username": "kim", "password": "…" }, "token": "…" }
 * ☆M2부터는 시크릿 저장소(암호화)에서 꺼낸다. 이 파일은 손으로 시험할 때만 쓴다.
 */
import { readFileSync } from "node:fs";
import { checkFlow, FlowError, parseFlow, type SecretValue } from "@flowsmith/core";
import { RunInputError, runFlow, type RunEvent } from "./run.ts";

const USAGE = `쓰는 법:
  flowsmith run <flow.json> [--param k=v]… [--var k=v]… [--secrets <file.json>] [--headed] [--json]
  flowsmith check <flow.json>`;

function kv(s: string, flag: string): [string, string] {
  const i = s.indexOf("=");
  if (i <= 0) throw new Error(`${flag}는 이름=값 꼴이어야 합니다: "${s}"`);
  return [s.slice(0, i), s.slice(i + 1)];
}

function parseArgs(argv: string[]) {
  const [cmd, file, ...rest] = argv;
  const params: Record<string, string> = {};
  const vars: Record<string, string> = {};
  let secretsFile: string | null = null;
  let headed = false;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const next = () => { const v = rest[++i]; if (v === undefined) throw new Error(`${a} 뒤에 값이 없습니다`); return v; };
    if (a === "--param") { const [k, v] = kv(next(), a); params[k] = v; }
    else if (a === "--var") { const [k, v] = kv(next(), a); vars[k] = v; }
    else if (a === "--secrets") secretsFile = next();
    else if (a === "--headed") headed = true;
    else if (a === "--json") json = true;
    else throw new Error(`모르는 옵션: ${a}`);
  }
  return { cmd, file, params, vars, secretsFile, headed, json };
}

const ICON: Record<string, string> = { succeeded: "✓", failed: "✗", skipped: "·", cancelled: "-", pending: "?", running: "…" };

function printEvent(e: RunEvent): void {
  switch (e.kind) {
    case "node:start": console.log(`\n▶ ${e.nodeId}`); break;
    case "step": console.log(`   ${String(e.step.index).padStart(2)}. ${e.step.note}  (${e.step.ms}ms)`); break;
    case "log": console.log(`   │ ${e.text}`); break;
    case "node:end": {
      const n = e.node;
      console.log(`${ICON[n.status] ?? "?"} ${n.name} — ${n.status} (${n.ms}ms)`);
      if (n.failure) {
        console.log(`   ✗ ${n.failure.message}`);
        if (n.failure.url) console.log(`     주소: ${n.failure.url}`);
        for (const c of n.failure.candidates) console.log(`     후보 ${c.locator.kind}=${c.locator.value}${c.locator.name ? `[${c.locator.name}]` : ""} → 지금 ${c.count}개 (자동으로 쓰지 않습니다)`);
      }
      break;
    }
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || (args.cmd !== "run" && args.cmd !== "check")) { console.error(USAGE); return 2; }
  const json = JSON.parse(readFileSync(args.file, "utf8"));

  if (args.cmd === "check") {
    const problems = checkFlow(json);
    if (problems.length === 0) { console.log("문제 없습니다"); return 0; }
    for (const p of problems) console.log(`- ${p}`);
    return 1;
  }

  const flow = parseFlow(json);
  Object.assign(flow.vars, args.vars);
  const secrets = args.secretsFile ? (JSON.parse(readFileSync(args.secretsFile, "utf8")) as Record<string, SecretValue>) : {};
  const result = await runFlow(flow, {
    params: args.params, secrets, headless: !args.headed,
    ...(args.json ? {} : { onEvent: printEvent }),
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`\n${result.status === "success" ? "성공" : "실패"}${result.message ? ` — ${result.message}` : ""} (${result.ms}ms)`);
    if (result.status === "success") console.log(JSON.stringify(result.output, null, 2));
  }
  return result.status === "success" ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => {
  if (e instanceof FlowError || e instanceof RunInputError) { console.error(e.message); process.exit(1); }
  console.error(e);
  process.exit(2);
});
