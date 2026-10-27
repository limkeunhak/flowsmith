#!/usr/bin/env node
/**
 * MSU QA를 서버에 올린다 — flows/의 워크플로우를 만들거나(있으면 초안을 바꿔) 버전으로 굳혀 게시하고,
 * suites/의 Suite마다 같은 이름이 있으면 시나리오를 바꾸고 없으면 만든다. 여러 번 돌려도 된다.
 *
 *   node examples/msu-qa/import.ts [--server http://127.0.0.1:4400] [--run] [msuweb navigator …]
 *
 *   --run             올린 뒤 Suite마다 한 번 돌리고 시나리오마다 판정을 보여 준다
 *   msuweb …          그 서비스(suites/<이름>.json)와 그 워크플로우만
 *   FLOWSMITH_TOKEN   로그인이 켜진 서버면 API 토큰(fsa_…)
 */
import { readdirSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const server = (opt("--server") ?? "http://127.0.0.1:4400").replace(/\/+$/, "");
const token = process.env["FLOWSMITH_TOKEN"];
const dir = new URL("./", import.meta.url);
const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--server");
const picked = (name: string) => !only.length || only.some((o) => name === o || name.startsWith(`${o}-`));

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
for (const file of readdirSync(new URL("flows/", dir)).filter((f) => f.endsWith(".json") && picked(f.replace(/\.json$/, ""))).sort()) {
  const draft = JSON.parse(readFileSync(new URL(`flows/${file}`, dir), "utf8"));
  // 묶음 — 이름 앞말(«Navigator · …» → Navigator). 서비스마다 한 묶음으로 목록에 모인다
  const group = String(draft.name).split(" · ")[0]!;
  const made = await api("POST", "/flows", { draft, team: null, group });
  if (made.status === 409) {
    await api("PUT", `/flows/${draft.id}/draft`, { draft });
    await api("PUT", "/flow-group", { ids: [draft.id], group });
  }
  const v = await api("POST", `/flows/${draft.id}/versions`, { note: "examples/msu-qa" });
  // 바뀐 것이 없으면 409 — 가장 높은 버전(목록은 최신순이지만 순서에 기대지 않는다)
  const version = v.data?.version ?? Math.max(...(await api("GET", `/flows/${draft.id}`)).data.versions.map((x: { version: number }) => x.version));
  await api("POST", `/flows/${draft.id}/deploy`, { version });
  console.log(`워크플로우 ${draft.id} — v${version} 게시`);
}

// Suite — 이름으로 찾는다
const existing = (await api("GET", "/suites")).data as { id: string; name: string }[];
const word: Record<string, string> = { pass: "통과", fail: "불통과", error: "오류" };
for (const file of readdirSync(new URL("suites/", dir)).filter((f) => f.endsWith(".json") && picked(f.replace(/\.json$/, ""))).sort()) {
  const suite = JSON.parse(readFileSync(new URL(`suites/${file}`, dir), "utf8"));
  const known = existing.find((s) => s.name === suite.name)?.id;
  const id = known ?? (await api("POST", "/suites", { name: suite.name })).data.id;
  // 비워 둔 입력(지갑 주소처럼 여기 적지 않는 것)은 서버에서 넣은 값을 지킨다
  const before = known ? ((await api("GET", `/suites/${id}`)).data.items ?? []) as { id: string; params: Record<string, string> }[] : [];
  const items = suite.items.map((it: { id: string; params: Record<string, string> }) => {
    const was = before.find((b) => b.id === it.id)?.params ?? {};
    return { ...it, params: Object.fromEntries(Object.entries(it.params).map(([k, v]) => [k, v === "" ? was[k] ?? "" : v])) };
  });
  await api("PUT", `/suites/${id}`, { description: suite.description, items });
  console.log(`Suite ${suite.name} — 시나리오 ${items.length}개 · ${server}/#/tests/${id}`);

  if (!argv.includes("--run")) continue;
  const blank = items.filter((it: { params: Record<string, string> }) => Object.values(it.params).some((v) => v === ""));
  if (blank.length) { console.log(`  돌리지 않음 — 비어 있는 입력이 있습니다(${blank.length}개 시나리오). 서버에서 Suite를 열어 넣으세요`); continue; }
  const { suiteRunId } = (await api("POST", `/suites/${id}/runs`, {})).data;
  let run: any;
  do {
    await new Promise((r) => setTimeout(r, 5000));
    run = (await api("GET", `/suite-runs/${suiteRunId}`)).data;
  } while (run.status === "running");
  for (const it of run.items) console.log(`  ${word[it.verdict] ?? it.verdict}\t${it.label}`);
  console.log(`  결과: ${word[run.status] ?? run.status}`);
  if (run.status !== "pass") process.exitCode = 1;
}
