/**
 * **어디에 붙나**(4단계 · DESKTOP.md §13) — 처음 켤 때 «이 PC에서만»(로컬 모드) · «회사 서버에 붙기»를 고른다. 설정에서 바꾼다.
 *
 *   userData/desktop.json        { mode: "local" | "server", server? }
 *   userData/worker-token.enc    회사 서버의 워커 토큰 — ★Windows 사용자 암호화(safeStorage)로 잠근다 · 한 번 넣으면 다시 넣지 않는다
 *                                (암호화가 없는 PC면 worker-token · 권한 600)
 */
import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Mode = { mode: "local" } | { mode: "server"; server: string };

export class Connection {
  readonly #dir: string;
  constructor(userDir: string) { this.#dir = userDir; }

  read(): Mode | null {
    try {
      const c = JSON.parse(readFileSync(join(this.#dir, "desktop.json"), "utf8")) as { mode?: string; server?: string };
      if (c.mode === "local") return { mode: "local" };
      if (c.mode === "server" && typeof c.server === "string" && serverProblem(c.server) === null) return { mode: "server", server: c.server };
    } catch { /* 처음 · 깨짐 */ }
    return null;
  }

  save(m: Mode, token?: string): void {
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(join(this.#dir, "desktop.json"), `${JSON.stringify(m, null, 2)}\n`);
    if (token === undefined) return;
    this.#forgetToken();
    if (safeStorage.isEncryptionAvailable()) writeFileSync(join(this.#dir, "worker-token.enc"), safeStorage.encryptString(token));
    else writeFileSync(join(this.#dir, "worker-token"), `${token}\n`, { mode: 0o600 });
  }

  token(): string | null {
    try {
      const enc = join(this.#dir, "worker-token.enc");
      if (existsSync(enc) && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(readFileSync(enc));
      const plain = join(this.#dir, "worker-token");
      if (existsSync(plain)) return readFileSync(plain, "utf8").trim() || null;
    } catch { /* 풀지 못함 — 다시 넣게 한다 */ }
    return null;
  }

  #forgetToken(): void {
    for (const f of ["worker-token.enc", "worker-token"]) rmSync(join(this.#dir, f), { force: true });
  }
}

/** 회사 서버 주소가 쓸 만한가 — ★https만(이 연결로 시크릿이 오간다) · 이 PC(127.0.0.1 · localhost)는 http도 */
export function serverProblem(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "서버 주소를 읽을 수 없습니다 — https://studio.회사 처럼 넣으세요"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "서버 주소는 https://로 시작해야 합니다";
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol === "http:" && !loopback) return "https 주소만 됩니다 — 이 연결로 시크릿(비밀번호)이 오갑니다";
  return null;
}

/** 서버 주소를 고르게 — 끝의 / · 길은 버린다 */
export const originOf = (raw: string): string => new URL(raw).origin;

/** 처음 켤 때 · «연결 바꾸기» — 앱 안의 작은 화면(preload의 setup으로 답한다) */
export function setupPage(now: Mode | null, error: string | null): string {
  const server = now?.mode === "server" ? now.server : "";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><meta charset="utf-8"><title>Flowsmith — 연결</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:"Segoe UI","Malgun Gothic",sans-serif;background:#f6f7fb;color:#1f2430}
.box{width:560px;background:#fff;border:1px solid #e3e6ee;border-radius:12px;padding:28px}h1{font-size:22px;margin:0 0 4px}p{color:#5b6475;font-size:14px;margin:0 0 18px}
label.opt{display:block;border:1px solid #e3e6ee;border-radius:10px;padding:12px 14px;margin:8px 0;cursor:pointer}label.opt:has(input:checked){border-color:#2f6fed;background:#f3f7ff}
.opt b{font-size:15px}.opt span{display:block;color:#5b6475;font-size:13px;margin:4px 0 0 24px}.fields{margin:10px 0 0 24px;display:none}.fields.on{display:block}
.fields input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cfd5e1;border-radius:8px;font:13px Consolas,monospace;margin:4px 0 10px}
.fields small{color:#5b6475;font-size:12px}button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:#2f6fed;color:#fff;font-size:15px;cursor:pointer}
button:disabled{opacity:.6}#err{color:#c0392b;font-size:13px;margin-top:12px;white-space:pre-wrap}</style>
<div class="box"><h1>Flowsmith</h1><p>이 앱을 어떻게 쓸지 고르세요. 나중에 «내 설정 › 데스크톱 앱»에서 바꿀 수 있습니다.</p>
<label class="opt"><input type="radio" name="m" value="local" ${now?.mode === "server" ? "" : "checked"}> <b>이 PC에서만</b><span>워크플로우 · 실행 기록이 이 PC에 남습니다 — 혼자 쓰기 · 시험 · 데모</span></label>
<label class="opt"><input type="radio" name="m" value="server" ${now?.mode === "server" ? "checked" : ""}> <b>회사 서버에 붙기</b><span>회사 서버의 워크플로우를 열고, «내 PC에서 실행하기»로 이 PC에서 돌립니다</span>
<div class="fields" id="f"><small>서버 주소</small><input id="server" placeholder="https://studio.회사" value="${esc(server)}">
<small>워커 토큰 — 관리자에게 받은 fsw_… (이 PC에 한 번만 넣으면 됩니다)</small><input id="token" placeholder="${now?.mode === "server" ? "그대로 두면 지금 토큰을 씁니다" : "fsw_…"}" autocomplete="off"></div></label>
<button id="go">시작</button><div id="err">${esc(error ?? "")}</div></div>
<script>const f=document.getElementById("f");const sync=()=>f.className="fields"+(document.querySelector("input[name=m]:checked").value==="server"?" on":"");
document.querySelectorAll("input[name=m]").forEach((r)=>r.onchange=sync);sync();
document.getElementById("go").onclick=async()=>{const b=document.getElementById("go");const e=document.getElementById("err");b.disabled=true;e.textContent="";b.textContent="붙는 중…";
const mode=document.querySelector("input[name=m]:checked").value;
const r=await window.flowsmithDesktop.setup({mode,server:document.getElementById("server").value.trim(),token:document.getElementById("token").value.trim()});
if(!r.ok){e.textContent=r.error;b.disabled=false;b.textContent="시작";}};</script>`;
}
