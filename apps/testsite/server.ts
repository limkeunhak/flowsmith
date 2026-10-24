/**
 * **시험 사이트** — 엔진 · 레코더 · 변경 감시를 진짜 브라우저로 시험하는 작은 쇼핑몰.
 *
 *   /login          아이디 · 비밀번호 · 로그인 버튼 (계정: kim / p@ss)
 *   /home           사용자 이름 (data-testid="user-name")
 *   /orders         주문번호 · 기간(select) · 취소 포함(checkbox) · 조회 → 상태 · 금액 · 품목 표
 *                   ★「주문 취소」 버튼 — 금지 버튼 시험용. 눌리면 /__stats의 cancelPosts가 는다
 *   /frame          iframe 안의 입력 칸과 값
 *   /news           네이버 뉴스 검색 결과 같은 되풀이 목록(표 아님) — 로그인 없이
 *   /dapp           지갑 로그인(«지갑 연결» → 연결 → 서명 → 주소) · «다른 체인 넣기»(목록 밖 체인) — 지갑 브라우저 시험용
 *   /__rpc?chain=N  가짜 체인 JSON-RPC(체인 id · 블록 · 잔고만) — MetaMask에 체인을 넣는 시험용
 *   /__stats        시험이 «정말 안 눌렸나»를 확인하는 곳
 *   /__layout?v=2   사이트가 바뀐 척 — 주문 상태의 id가 바뀌고 「조회」가 「검색」이 된다(변경 감시 시험용)
 *
 *   node apps/testsite/server.ts [port]     (기본 4300)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

interface Order { status: string; amount: string; items: { name: string; qty: number; price: string }[] }

const ORDERS: Record<string, Order> = {
  "A-1001": { status: "배송중", amount: "12,500원", items: [{ name: "연필", qty: 10, price: "5,000원" }, { name: "공책", qty: 3, price: "7,500원" }] },
  "A-1002": { status: "취소", amount: "0원", items: [] },
};
const USER = { id: "kim", pw: "p@ss", name: "김철수" };

export interface TestSite {
  url: string;
  stats: { cancelPosts: number; logins: number };
  /** 배치 — 2면 사이트가 바뀐 척한다 */
  setLayout(v: 1 | 2): void;
  close(): Promise<void>;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string): string => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: sans-serif; margin: 24px; }
  label { display: block; margin: 8px 0; }
  table { border-collapse: collapse; margin-top: 12px; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; }
  .err { color: #c00; }
</style></head><body>
<header>${title === "로그인" ? "" : `<a href="/home">홈</a> · <a href="/orders">주문 조회</a> · <a href="/frame">프레임</a>`}</header>
<h1>${esc(title)}</h1>
${body}
</body></html>`;

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").map((s) => s.trim().split("=")).filter((x) => x.length === 2) as [string, string][]);
}

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  let s = "";
  for await (const c of req) s += c;
  return new URLSearchParams(s);
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}

/** 가짜 체인의 답 — 지갑이 체인을 확인하고 잔고를 그리는 데 쓰는 것만 */
function rpcAnswer(m: unknown, chain: number): unknown {
  const { id = null, method = "" } = (m ?? {}) as { id?: unknown; method?: string };
  const hex = (n: number) => `0x${n.toString(16)}`;
  const result: Record<string, unknown> = {
    eth_chainId: hex(chain), net_version: String(chain), eth_blockNumber: "0x1", eth_getBalance: "0x0", eth_gasPrice: "0x1",
    eth_maxPriorityFeePerGas: "0x1", eth_getTransactionCount: "0x0", eth_getCode: "0x", eth_call: "0x", eth_estimateGas: "0x5208",
    eth_getBlockByNumber: { number: "0x1", hash: `0x${"1".repeat(64)}`, parentHash: `0x${"0".repeat(64)}`, timestamp: hex(Math.floor(Date.now() / 1000)), baseFeePerGas: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [] },
  };
  return { jsonrpc: "2.0", id, result: method in result ? result[method] : null };
}

/**
 * **dApp** — 지갑 브라우저 시험용. «지갑 연결» → 계정 연결(eth_requestAccounts) → 로그인 서명(personal_sign) → 주소를 보인다.
 * «다른 체인 넣기»는 목록에 없는 체인(99999)을 넣자고 한다 — «MetaMask 승인»이 누르지 않아야 한다
 */
const DAPP = page("지갑 로그인", `
  <p><button id="connect">지갑 연결</button> <button id="bad-chain">다른 체인 넣기</button></p>
  <p id="status">연결 안 됨</p>
  <p>주소: <span id="address" data-testid="dapp-address"></span></p>
  <p id="signed" hidden>로그인됨</p>
  <script>
    const $ = (id) => document.getElementById(id);
    const hex = (s) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
    $("connect").onclick = async () => {
      const eth = window.ethereum;
      if (!eth) { $("status").textContent = "지갑 없음"; return; }
      try {
        const [a] = await eth.request({ method: "eth_requestAccounts" });
        $("status").textContent = "서명을 기다립니다";
        await eth.request({ method: "personal_sign", params: [hex("Flowsmith 시험 로그인\\nnonce: " + Math.random().toString(36).slice(2)), a] });
        $("address").textContent = a;
        $("status").textContent = "로그인됨";
        $("signed").hidden = false;
      } catch (e) { $("status").textContent = "거절됨: " + (e && e.message); }
    };
    $("bad-chain").onclick = () => window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x1869f", chainName: "목록 밖 체인", rpcUrls: [location.origin + "/__rpc?chain=99999"], nativeCurrency: { name: "BAD", symbol: "BAD", decimals: 18 } }] }).catch(() => {});
  </script>`);

export function startTestSite(port = 0): Promise<TestSite> {
  const stats = { cancelPosts: 0, logins: 0 };
  let layout: 1 | 2 = 1;
  const sessions = new Set<string>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const sid = cookies(req)["sid"];
    const authed = sid !== undefined && sessions.has(sid);
    const needLogin = () => send(res, 302, "", { location: "/login" });

    if (url.pathname === "/__layout") {
      layout = url.searchParams.get("v") === "2" ? 2 : 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ layout }));
      return;
    }
    if (url.pathname === "/__stats") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(stats));
      return;
    }
    // 가짜 체인 RPC — MetaMask가 체인을 넣을 때 묻는 것에만 답한다(지갑 브라우저 시험 · ?chain=31337)
    if (url.pathname === "/__rpc") {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
      let raw = "";
      for await (const c of req) raw += c;
      const chain = Number(url.searchParams.get("chain") ?? "31337");
      res.writeHead(200, { "content-type": "application/json", ...cors });
      try { const j = JSON.parse(raw) as unknown; res.end(JSON.stringify(Array.isArray(j) ? j.map((x) => rpcAnswer(x, chain)) : rpcAnswer(j, chain))); }
      catch { res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); }
      return;
    }
    if (url.pathname === "/dapp") { send(res, 200, DAPP); return; }

    if (url.pathname === "/login" && req.method === "POST") {
      const f = await body(req);
      if (f.get("uid") === USER.id && f.get("pw") === USER.pw) {
        stats.logins++;
        const s = Math.random().toString(36).slice(2);
        sessions.add(s);
        send(res, 302, "", { location: "/home", "set-cookie": `sid=${s}; Path=/; HttpOnly` });
      } else {
        send(res, 200, page("로그인", loginForm("아이디 또는 비밀번호가 틀립니다")));
      }
      return;
    }
    if (url.pathname === "/news") {
      // 네이버 뉴스 검색 결과처럼 — 표가 아닌 되풀이 목록 · 해시 클래스 · 한 건 안에 같은 모양의 링크 둘(제목 · 요약) ·
      // 강조 글자(<mark>) · 화면 읽기용 숨은 글자(「새 창 열림」) · 사진이 없는 건도 있다. 로그인 없이 본다
      const blind = `<span class="blind" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">새 창 열림</span>`;
      const card = (n: { press: string; ago: string; title: string; href: string; sum: string; photo: boolean }) =>
        `<div class="sds-comps-vertical-layout sds-comps-full-layout G9AjKl_FKMqXujGm">` +
        `<div class="sds-comps-profile"><span class="press">${esc(n.press)}</span> · <span class="ago">${esc(n.ago)}</span></div>` +
        `<div class="sds-comps-base-layout sds-comps-full-layout">` +
        `<div class="sds-comps-vertical-layout sds-comps-full-layout">` +
        `<a class="t_Om6lnKIHMRgeAj iOv6ot9ABhc36Aum" href="${n.href}" target="_blank">${n.title}${blind}</a>` +
        `<a class="t_Om6lnKIHMRgeAj" href="${n.href}" target="_blank">${esc(n.sum)}${blind}</a></div>` +
        (n.photo ? `<a class="thumb" href="${n.href}"><img alt="" width="80" height="60"></a>` : "") +
        `</div></div>`;
      const NEWS = [
        { press: "KBS", ago: "18분 전", title: "[뉴스9 <mark>날씨</mark>] 내일, 다시 기온 올라…큰 일교차 주의", href: "/n/1", sum: "오늘 입은 옷이 내일과 모레는 조금 덥게 느껴질 수 있겠습니다.", photo: true },
        { press: "TV조선", ago: "21분 전", title: "[<mark>날씨</mark>] 주말까지 '포근'…일요일 요란한 가을비", href: "https://news.example/2", sum: "내일 아침 기온 서울 14도, 부산 15도로 오늘보다 높겠고요.", photo: false },
        { press: "SBS", ago: "40분 전", title: "[<mark>날씨</mark>/XR] '단풍' 작년보다 빨라…일요일 전국 비", href: "/n/3", sum: "오늘(15일) 남부 지방은 대체로 맑았지만", photo: true },
      ];
      send(res, 200, page("뉴스", `<section id="main_pack"><div class="group_news"><h2>뉴스</h2><div class="list_news">${NEWS.map(card).join("")}</div></div></section>`));
      return;
    }
    if (url.pathname === "/login" || url.pathname === "/") {
      send(res, 200, page("로그인", loginForm(null)));
      return;
    }

    if (!authed) return needLogin();

    if (url.pathname === "/home") {
      send(res, 200, page("홈", `<p>안녕하세요, <span data-testid="user-name">${esc(USER.name)}</span>님</p>`));
      return;
    }

    if (url.pathname === "/orders/cancel" && req.method === "POST") {
      stats.cancelPosts++;
      send(res, 200, page("주문 취소", `<p>취소되었습니다</p>`));
      return;
    }

    if (url.pathname === "/orders") {
      const no = url.searchParams.get("no");
      const period = url.searchParams.get("period") ?? "1m";
      const withCancelled = url.searchParams.get("cancelled") === "on";
      const o = no ? ORDERS[no] : undefined;
      const result = no === null ? "" : o === undefined || (o.status === "취소" && !withCancelled)
        ? `<p id="not-found">주문을 찾을 수 없습니다</p>`
        : `<section>
             <p>상태: <b id="${layout === 2 ? "state" : "order-status"}">${esc(o.status)}</b></p>
             <p>금액: <span id="order-amount">${esc(o.amount)}</span></p>
             <p>조회 기간: <span id="order-period">${esc(period)}</span></p>
             <table id="items"><thead><tr><th>품목</th><th>수량</th><th>금액</th></tr></thead><tbody>
               ${o.items.map((i) => `<tr class="item"><td class="name">${esc(i.name)}</td><td class="qty">${i.qty}</td><td class="price">${esc(i.price)}</td></tr>`).join("")}
             </tbody></table>
             <form method="post" action="/orders/cancel"><button type="submit">주문 취소</button></form>
           </section>`;
      send(res, 200, page("주문 조회", `
        <form method="get" action="/orders">
          <input name="no" placeholder="주문번호" value="${esc(no ?? "")}">
          <label for="period">기간</label> <select id="period" name="period">
            <option value="1m"${period === "1m" ? " selected" : ""}>1개월</option>
            <option value="3m"${period === "3m" ? " selected" : ""}>3개월</option>
            <option value="1y"${period === "1y" ? " selected" : ""}>1년</option>
          </select>
          <label><input type="checkbox" name="cancelled"${withCancelled ? " checked" : ""}> 취소 포함</label>
          <button type="submit">${layout === 2 ? "검색" : "조회"}</button>
        </form>
        ${result}`));
      return;
    }

    if (url.pathname === "/frame") {
      send(res, 200, page("프레임", `<iframe id="inner" src="/frame-inner" width="400" height="160"></iframe>`));
      return;
    }
    if (url.pathname === "/frame-inner") {
      send(res, 200, `<!doctype html><html lang="ko"><meta charset="utf-8"><body>
        <label>메모 <input id="memo"></label>
        <button id="echo" onclick="document.getElementById('out').textContent = document.getElementById('memo').value">보이기</button>
        <p id="out"></p></body></html>`);
      return;
    }

    send(res, 404, page("없음", "<p>없는 페이지입니다</p>"));
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: p } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${p}`,
        stats,
        setLayout: (v) => { layout = v; },
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
      });
    });
  });
}

function loginForm(error: string | null): string {
  return `<form method="post" action="/login">
    <label for="uid">아이디</label><input id="uid" name="uid">
    <label for="pw">비밀번호</label><input id="pw" name="pw" type="password">
    <button type="submit">로그인</button>
    ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
  </form>`;
}

// ★Windows에서는 argv[1]이 C:\…라 «file://» + 경로로 견주면 늘 틀린다 — import.meta.main(Node 24.2+)을 먼저 본다
if (import.meta.main ?? import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const site = await startTestSite(Number(process.argv[2] ?? 4300));
  console.log(`시험 사이트: ${site.url}  (계정 kim / p@ss)`);
}
