#!/usr/bin/env node
/**
 * 서비스 파일들 → flows/*.json · suites/*.json · NOTES.md. 손으로 JSON을 고치지 말고 여기를 고쳐 다시 짓는다.
 *
 *   node examples/msu-qa/gen/main.ts [msuweb navigator …]   — 서비스를 주면 그것만(flows/는 그 서비스 것만 다시 쓴다)
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { Service } from "./lib.ts";

const ALL = ["msuweb", "marketplace", "swapnwarp", "navigator", "trade"];
const only = process.argv.slice(2);
const root = new URL("../", import.meta.url);
mkdirSync(new URL("flows/", root), { recursive: true });
mkdirSync(new URL("suites/", root), { recursive: true });

const services: Service[] = [];
for (const name of ALL) services.push((await import(`./${name}.ts`)).default as Service);

for (const svc of services) {
  if (only.length && !only.includes(svc.file)) continue;
  const ids = new Set(svc.flows.map((f) => f.id));
  if (ids.size !== svc.flows.length) throw new Error(`${svc.file}: 워크플로우 id가 겹칩니다`);
  for (const it of svc.items) if (!ids.has(it.flowId)) throw new Error(`${svc.file}: 시나리오 ${it.id}의 워크플로우 ${it.flowId}가 없습니다`);
  if (new Set(svc.items.map((i) => i.id)).size !== svc.items.length) throw new Error(`${svc.file}: 시나리오 id가 겹칩니다`);

  // 이 서비스의 옛 JSON은 지우고 다시 쓴다(이름을 바꾼 워크플로우가 남지 않게)
  for (const f of readdirSync(new URL("flows/", root))) if (f.startsWith(`${svc.file}-`)) rmSync(new URL(`flows/${f}`, root));
  for (const f of svc.flows) {
    if (!f.id.startsWith(`${svc.file}-`)) throw new Error(`${f.id}: 워크플로우 id는 «${svc.file}-»로 시작해야 합니다`);
    writeFileSync(new URL(`flows/${f.id}.json`, root), JSON.stringify(f, null, 2) + "\n");
  }
  if (svc.items.length) writeFileSync(new URL(`suites/${svc.file}.json`, root), JSON.stringify({ ...svc.suite, items: svc.items }, null, 2) + "\n");
  console.log(`${svc.file}: 워크플로우 ${svc.flows.length} · 시나리오 ${svc.items.length}`);
}

// 옮기지 못한 것 · 원본과 다른 것 — 서비스마다
const notes = services.filter((s) => s.notes.length).map((s) => `## ${s.suite.name}\n\n${s.notes.map((n) => `- ${n}`).join("\n")}\n`).join("\n");
writeFileSync(new URL("NOTES.md", root), `# 원본과 다른 것 · 옮기지 못한 것\n\n[gen/](gen/)의 서비스 파일에 적은 것을 모았다(gen/main.ts가 짓는다).\n\n${notes}`);
