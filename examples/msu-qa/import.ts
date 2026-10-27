#!/usr/bin/env node
/**
 * MSU QA 파일럿을 서버에 올린다 — 워크플로우 9개를 만들거나(있으면 초안을 바꿔) 버전으로 굳혀 게시하고,
 * 같은 이름의 Suite가 있으면 시나리오를 바꾸고 없으면 만든다. 여러 번 돌려도 된다.
 *
 *   node examples/msu-qa/import.ts [--server http://127.0.0.1:4400] [--run]
 *
 *   --run             올린 뒤 Suite를 한 번 돌리고 시나리오마다 판정을 보여 준다
 *   FLOWSMITH_TOKEN   로그인이 켜진 서버면 API 토큰(fsa_…)
 */
import { readdirSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const server = (opt("--server") ?? "http://127.0.0.1:4400").replace(/\/+$/, "");
const token = process.env["FLOWSMITH_TOKEN"];
const dir = new URL("./", import.meta.url);

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${server}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status >= 400 && res.status !== 409) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, data };
}

// 워크플로우 — 만들기(이미 있으면 409 → 초안 바꾸기) → 버전(같으면 마지막 버전) → 게시
for (const file of readdirSync(new URL("flows/", dir)).filter((f) => f.endsWith(".json")).sort()) {
  const draft = JSON.parse(readFileSync(new URL(`flows/${file}`, dir), "utf8"));
  const made = await api("POST", "/flows", { draft, team: null });
  if (made.status === 409) await api("PUT", `/flows/${draft.id}/draft`, { draft });
  const v = await api("POST", `/flows/${draft.id}/versions`, { note: "examples/msu-qa" });
  // 바뀐 것이 없으면 409 — 가장 높은 버전(목록은 최신순이지만 순서에 기대지 않는다)
  const version = v.data?.version ?? Math.max(...(await api("GET", `/flows/${draft.id}`)).data.versions.map((x: { version: number }) => x.version));
  await api("POST", `/flows/${draft.id}/deploy`, { version });
  console.log(`워크플로우 ${draft.id} — v${version} 게시`);
}

// Suite — 이름으로 찾는다
const suite = JSON.parse(readFileSync(new URL("suite.json", dir), "utf8"));
const found = ((await api("GET", "/suites")).data as { id: string; name: string }[]).find((s) => s.name === suite.name);
const id = found?.id ?? (await api("POST", "/suites", { name: suite.name })).data.id;
await api("PUT", `/suites/${id}`, { description: suite.description, items: suite.items });
console.log(`Suite ${suite.name} — 시나리오 ${suite.items.length}개 · ${server}/#/tests/${id}`);

if (argv.includes("--run")) {
  const { suiteRunId } = (await api("POST", `/suites/${id}/runs`, {})).data;
  let run: any;
  do {
    await new Promise((r) => setTimeout(r, 5000));
    run = (await api("GET", `/suite-runs/${suiteRunId}`)).data;
  } while (run.status === "running");
  const word: Record<string, string> = { pass: "통과", fail: "불통과", error: "오류" };
  for (const it of run.items) console.log(`${word[it.verdict] ?? it.verdict}\t${it.label}`);
  console.log(`결과: ${word[run.status] ?? run.status}`);
  if (run.status !== "pass") process.exitCode = 1;
}
