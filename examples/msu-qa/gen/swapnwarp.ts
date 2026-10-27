/** Swap & Warp — 원본 tests/swapnwarp/ */
import { SWAP, T, check, click, cookie, custom, fill, flow, goto, item, judge, openAt, pause, press, read, waitVisible, web, type Service } from "./lib.ts";

const svc: Service = {
  file: "swapnwarp",
  suite: { name: "MSU QA · Swap & Warp (msu-e2e-test)", description: "msu-e2e-test tests/swapnwarp/의 visitor 시나리오 — 대상 qa.msu.io/swapnwarp" },
  flows: [],
  items: [],
  notes: [],
};
export default svc;

/** 로그인 상태(localStorage msu_auth_store) · 지금 주소 · 제목 */
const AUTH = [
  "const raw = await page.evaluate(() => localStorage.getItem('msu_auth_store'));",
  "let isLogin = false; try { isLogin = JSON.parse(raw)?.state?.isLogin === true; } catch {}",
];
const auth = (nodeId: string) =>
  custom(nodeId, "로그인 상태 · 지금 주소", [...AUTH, "return { isLogin, url: decodeURIComponent(page.url()), title: await page.title() };"], ["isLogin", "url", "title"]);

// ── 01-swap-page ──────────────────────────────────────────────────────────
svc.flows.push(
  flow("swapnwarp-01-visitor", "Swap & Warp · 비회원 스왑 화면 — 지갑 연결 안내",
    "01-swap-page: 비회원에게 스왑 화면이 열리고 폼이 지갑 연결을 요구한다 · 헤더에 Connect",
    [
      web("open", "Swap & Warp 열기", [pause(5000), cookie(),
        read("cta", T("«Connect Wallet to Swap»", "css", 'button:has-text("Connect Wallet to Swap")')),
        read("connect", T("헤더의 Connect", "css", 'header button:has-text("Connect")'))], openAt(SWAP)),
      auth("auth"),
      judge([
        check("제목이 Swap & Warp", "{{ $input.title }}", "matches", "[Ss][Ww][Aa][Pp]\\s*&\\s*[Ww][Aa][Rr][Pp]"),
        check("전제: 로그인하지 않았다", "{{ $input.isLogin }}", "isFalse"),
        check("스왑 폼이 지갑 연결을 요구한다", "{{ $node.open.cta }}", "notEmpty"),
        check("헤더에 Connect 버튼", "{{ $node.open.connect }}", "contains", "Connect"),
      ]),
    ]),
  flow("swapnwarp-01-tabs", "Swap & Warp · 워프 · 트랜잭션 경로",
    "01-swap-page: /swapnwarp/warp · /swapnwarp/transactions 가 각자의 경로로 열린다(원본처럼 주소로 들어간다)",
    [
      web("warp", "워프 열기", [pause(4000), cookie(), goto(`${SWAP}/warp`), pause(3000)], openAt(SWAP)),
      auth("w_warp"),
      web("tx", "트랜잭션 열기", [goto(`${SWAP}/transactions`), pause(3000)]),
      auth("w_tx"),
      judge([
        check("워프 경로", "{{ $node.w_warp.url }}", "contains", "/swapnwarp/warp"),
        check("트랜잭션 경로", "{{ $node.w_tx.url }}", "contains", "/swapnwarp/transactions"),
      ]),
    ]),
);
svc.items.push(
  item("s01a", "swapnwarp-01-visitor", "[01-swap-page] 로그인하지 않은 방문자에게 스왑 화면과 지갑 연결 안내가 보인다"),
  item("s01b", "swapnwarp-01-tabs", "[01-swap-page] 스왑 · 워프 · 트랜잭션 탭이 각각의 경로로 열린다"),
);

// ── 04-transaction-filters ────────────────────────────────────────────────
/** 거래 내역 조회(/swapnwarp/api/swap/transaction?…)의 응답을 page에 모은다 — 이미 듣고 있으면 비우기만 */
const WATCH_TX = [
  "page.__tx = [];",
  "if (!page.__txOn) { page.__txOn = true; page.on('response', async (r) => { if (!/\\/swapnwarp\\/api\\/swap\\/transaction\\?/.test(r.url())) return;",
  "  let entries = []; try { entries = (await r.json()).transactions ?? []; } catch {} page.__tx.push({ url: r.url(), entries }); }); }",
];
/** 그려진 행(가상 스크롤이라 화면에 있는 것만) — 주소 · 지불 · 수령 */
const ROWS = [
  "const rows = await page.locator('#swap_table [role=\"row\"][aria-label^=\"Swap transaction row for\"]').evaluateAll((els) => els.map((row) => {",
  "  const cells = [...row.querySelectorAll('[role=\"cell\"]')].map((c) => (c.innerText || '').replace(/\\s+/g, ' ').trim());",
  "  const a = (cells[1] || '').match(/[\\d,]+(?:\\.\\d+)?/g) || [];",
  "  return { address: (row.getAttribute('aria-label') || '').replace('Swap transaction row for ', ''), pay: a[0] || '', receive: a[1] || '' }; }));",
];
/** 이 동작 뒤에 온 조회 응답(15초까지 기다림) — 가장 마지막 것 */
const TAKE_TX = [
  "const until = Date.now() + 15000;",
  "while (!page.__tx.length && Date.now() < until) await page.waitForTimeout(300);",
  "const got = page.__tx.splice(0); const last = got[got.length - 1] ?? { url: '', entries: [] };",
  "const req = last.url ? new URL(last.url).searchParams : new URLSearchParams();",
  "const here = new URL(page.url()).searchParams;",
  "const notice = await page.locator('[role=\"status\"][aria-label^=\"No transaction items found\"]').first().isVisible().catch(() => false);",
  "const tableCount = await page.locator('#swap_table').count();",
];

/** 거래가 있을 수 없는 주소 — EVM 예약 주소(원본 UNUSED_ADDRESS) */
const UNUSED = "0x0000000000000000000000000000000000000001";
const searchBox = T("주소 · 해시 검색 칸", "css", 'input[placeholder="Search by Address and Tx hash"]');
const chip = T("Type 칩", "css", "#asset_chip");

svc.flows.push(
  flow("swapnwarp-04-address-filter", "Swap & Warp · 거래 내역 지갑 주소 필터",
    "04-transaction-filters: 화면 첫 행의 지갑으로 거르면 URL · 요청 · 응답 · 화면이 모두 그 지갑만 · 쓰이지 않은 주소면 «없음»",
    [
      web("open", "거래 내역 열기", [pause(6000), cookie(), pause(1000)], openAt(`${SWAP}/transactions`)),
      custom("before", "필터 전 행 · 대상 지갑 · 응답 듣기", [...AUTH, ...ROWS, ...WATCH_TX,
        "return { isLogin, rows: rows.map((r) => r.address), target: rows[0]?.address ?? '' };"], ["isLogin", "rows", "target"]),
      web("search", "그 지갑으로 검색", [fill(searchBox, "{{ $input.target }}"), press(searchBox, "Enter"), pause(4000)]),
      custom("hit", "검색 결과 — URL · 요청 · 응답 · 화면", [...TAKE_TX, ...ROWS,
        "const t = String(input.target).toLowerCase();",
        "return { searchValue: here.get('searchValue') ?? '', reqAddr: req.get('addressOrTxhash') ?? '', entries: last.entries.map((e) => e.walletAddress),",
        "  strays: last.entries.filter((e) => String(e.walletAddress).toLowerCase() !== t).map((e) => e.walletAddress),",
        "  shown: rows.map((r) => r.address), shownStrays: rows.filter((r) => r.address.toLowerCase() !== t).map((r) => r.address) };",
      ], ["searchValue", "reqAddr", "entries", "strays", "shown", "shownStrays"]),
      web("searchEmpty", "쓰이지 않은 주소로 검색", [fill(searchBox, UNUSED), press(searchBox, "Enter"), pause(4000)]),
      custom("empty", "빈 결과 — 응답 · 안내 · 표", [...TAKE_TX,
        "return { entries: last.entries.map((e) => e.walletAddress), notice, tableCount };"], ["entries", "notice", "tableCount"]),
      judge([
        check("전제: 로그인하지 않았다", "{{ $node.before.isLogin }}", "isFalse"),
        check("전제: 거를 대상이 있다", "{{ $node.before.rows }}", "countGte", "1"),
        check("검색어가 URL에 실린다(searchValue)", "{{ $node.hit.searchValue }}", "eq", "{{ $node.before.target }}"),
        check("조회 요청에 주소가 담긴다(addressOrTxhash)", "{{ $node.hit.reqAddr }}", "eq", "{{ $node.before.target }}"),
        check("다른 지갑의 거래가 섞여 오지 않는다", "{{ $node.hit.strays }}", "countEq", "0"),
        check("고른 지갑에는 거래가 최소 한 건", "{{ $node.hit.entries }}", "countGte", "1"),
        check("화면에도 그 지갑의 행만 남는다", "{{ $node.hit.shownStrays }}", "countEq", "0"),
        check("응답이 있으면 화면에도 행이 있다", "{{ $node.hit.shown }}", "countGte", "1"),
        check("쓰이지 않은 주소에는 거래가 없다", "{{ $node.empty.entries }}", "countEq", "0"),
        check("결과가 없으면 없다고 말한다", "{{ $node.empty.notice }}", "isTrue"),
        check("결과가 없으면 표를 그리지 않는다(현재 동작)", "{{ $node.empty.tableCount }}", "eq", "0"),
      ]),
    ]),
);

type Dir = "NXPC_TO_NESO" | "NESO_TO_NXPC";
const DIRS: Dir[] = ["NXPC_TO_NESO", "NESO_TO_NXPC"];
const pickType = (d: Dir) => {
  const [from, to] = d.split("_TO_");
  // 화살표 글리프를 글자 그대로 맞추지 않는다(원본 TYPE_OPTION_PATTERNS) — 앞 토큰 · 끝 토큰으로
  const opt = `//*[@role="option" and starts-with(normalize-space(.),"${from}") and substring(normalize-space(.), string-length(normalize-space(.)) - 3) = "${to}"]`;
  const chipSays = `//*[@id="asset_chip" and starts-with(normalize-space(.),"${from}")]`;
  return web(`pick_${d}`, `Type ${from} → ${to}`, [click(chip), click(T(`옵션 ${from} → ${to}`, "xpath", opt)),
    waitVisible(T(`칩이 ${from} → ${to}`, "xpath", chipSays), 10000), pause(3000)]);
};
const typeState = (d: Dir) =>
  custom(`s_${d}`, `${d} 결과 — URL · 요청 · 응답 · 화면`, [...TAKE_TX, ...ROWS,
    `const want = 'SWAP_TYPE_${d}'; const num = (v) => Number(String(v).replace(/,/g, ''));`,
    "return { transactionType: here.get('transactionType') ?? '', swapType: req.get('swapType') ?? '',",
    "  others: [...new Set(last.entries.filter((e) => e.swapType !== want).map((e) => e.swapType))],",
    "  respHas: last.entries.length > 0, shownHas: rows.length > 0,",
    `  wrongWay: rows.filter((r) => ${d === "NXPC_TO_NESO" ? "num(r.receive) <= num(r.pay)" : "num(r.receive) >= num(r.pay)"}).map((r) => r.pay + '→' + r.receive),`,
    "  rowsOrNotice: rows.length ? rows.length + '행' : notice ? '없음 안내' : '' };",
  ], ["transactionType", "swapType", "others", "respHas", "shownHas", "wrongWay", "rowsOrNotice"]);

svc.flows.push(
  flow("swapnwarp-04-type-filter", "Swap & Warp · 거래 내역 유형 필터",
    "04-transaction-filters: Type을 NXPC → NESO · NESO → NXPC로 바꾸면 URL · 요청 · 응답 · 화면이 그 방향만 — 기본은 All",
    [
      web("start", "Swap & Warp", [pause(2000)], openAt(SWAP)),
      custom("watch", "응답 듣기", [...WATCH_TX, "return { watching: true };"], ["watching"]),
      web("open", "거래 내역 열기", [goto(`${SWAP}/transactions`), pause(6000), cookie(), read("chip", chip)]),
      custom("all", "처음 조회(All)", [...AUTH, ...TAKE_TX, "return { isLogin, swapType: req.get('swapType') ?? '' };"], ["isLogin", "swapType"]),
      ...DIRS.flatMap((d) => [pickType(d), typeState(d)]),
      judge([
        check("전제: 로그인하지 않았다", "{{ $node.all.isLogin }}", "isFalse"),
        check("기본값은 방향을 지정하지 않는다", "{{ $node.all.swapType }}", "eq", "SWAP_TYPE_UNSPECIFIED"),
        check("기본값은 All", "{{ $node.open.chip }}", "matches", "^All"),
        ...DIRS.flatMap((d) => {
          const want = `SWAP_TYPE_${d}`;
          const n = `$node.s_${d}`;
          return [
            check(`${d}: 고른 유형이 URL에 실린다`, `{{ ${n}.transactionType }}`, "eq", want),
            check(`${d}: 조회 요청에 유형이 담긴다`, `{{ ${n}.swapType }}`, "eq", want),
            check(`${d}: 응답에 다른 유형이 섞이지 않는다`, `{{ ${n}.others }}`, "countEq", "0"),
            check(`${d}: 응답이 있으면 화면에도 행이 있다(있음 여부가 같다)`, `{{ ${n}.shownHas }}`, "eq", `{{ ${n}.respHas }}`),
            check(`${d}: 지불 · 수령 크기가 방향과 맞다`, `{{ ${n}.wrongWay }}`, "countEq", "0"),
            check(`${d}: 행이 있거나, 없으면 없다고 말한다`, `{{ ${n}.rowsOrNotice }}`, "notEmpty"),
          ];
        }),
      ]),
    ]),
);
svc.items.push(
  item("s04a", "swapnwarp-04-address-filter", "[04-transaction-filters] Transactions 페이지에서 지갑 주소로 필터링할 수 있다"),
  item("s04b", "swapnwarp-04-type-filter", "[04-transaction-filters] Transactions 페이지에서 트랜잭션 유형으로 필터링할 수 있다"),
);

svc.notes.push(
  "01 · 04: 로그인 상태(localStorage msu_auth_store) · 지금 주소는 웹페이지 동작에 없어 커스텀 노드로",
  "04-transaction-filters: 조회 요청 쿼리 · 응답 본문 확인은 커스텀 노드가 page에 응답 듣개를 달아 모은다(네트워크를 보는 동작이 없다)",
  "04-transaction-filters: «모두 그 지갑 · 그 방향»은 견주는 법에 «모두»가 없어 커스텀 노드가 벗어난 것을 골라 «0개»로 본다",
  "공통: 원본의 settle · waitForTransactions 대신 고정 3~6초 기다리기",
);
