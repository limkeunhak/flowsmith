/** 마켓플레이스 — 원본 tests/marketplace/ */
import { MARKET, T, check, click, cookie, custom, fill, flow, goto, item, judge, openAt, pause, press, read, web, type Service } from "./lib.ts";

const svc: Service = {
  file: "marketplace",
  suite: { name: "MSU QA · 마켓플레이스 (msu-e2e-test)", description: "msu-e2e-test tests/marketplace/의 visitor 시나리오 — 대상 qa.msu.io/marketplace" },
  flows: [],
  items: [],
  notes: [],
};
export default svc;

/** QA에 있는 NFT 하나(Neophyte Ring #131) — 원본은 .env의 MSU_NFT_TOKEN_ID. 상세 페이지는 판매 여부와 상관없이 열린다 */
const NFT_TOKEN = "8467190164900413392626111038978";

/** Sign in 모달 — 원본 src/utils/msu-signin.ts. 늘 DOM에 숨어 있는 것과 갈라 보이는 것만 */
const signInModal = T("Sign in 모달", "css", "#w3a-modal:visible, .w3a-modal-container:visible");
/** 목록 카드의 북마크 단추 — 첫 카드 */
const firstBookmark = T("첫 카드의 북마크", "css", "button.bookmark >> nth=0");
const detailBookmark = T("상세의 북마크", "css", '[data-gtm-target="bookmark_btn"]:visible >> nth=0');
const keywordBox = T("목록 검색 칸(keyword)", "css", 'input[name="keyword"]:visible >> nth=0');
const headerConnect = T("헤더의 Connect", "css", 'header button:has-text("Connect")');

/** 로그인 상태(localStorage msu_auth_store) · 지금 주소 · 제목 — 웹페이지 동작에 없어서 코드로 */
const auth = (nodeId: string) =>
  custom(nodeId, "로그인 상태 · 지금 주소", [
    "const raw = await page.evaluate(() => localStorage.getItem('msu_auth_store'));",
    "let isLogin = false; try { isLogin = JSON.parse(raw)?.state?.isLogin === true; } catch {}",
    "return { isLogin, path: new URL(page.url()).pathname, url: decodeURIComponent(page.url()), title: await page.title() };",
  ], ["isLogin", "path", "url", "title"]);

/** /api/marketplace/explore/items 요청을 page에 모은다 — 이미 듣고 있으면 비우기만 */
const WATCH_EXPLORE = [
  "page.__explore = [];",
  "if (!page.__exploreOn) { page.__exploreOn = true; page.on('request', (r) => { if (/\\/api\\/marketplace\\/explore\\/items$/.test(r.url())) page.__explore.push(r.postData() || ''); }); }",
];
/** 화면의 NFT 카드 — 데스크톱 · 모바일이 같은 카드를 두 번 그려서 id로 거른다(원본 cardNames · cardPrices) */
const CARDS = [
  "const cards = await page.evaluate(() => { const m = new Map();",
  "  for (const el of document.querySelectorAll('[data-gtm-target=\"nft_card\"][data-gtm-token-id]')) { const id = el.getAttribute('data-gtm-token-id'); const n = el.getAttribute('data-gtm-item-name'); if (id && n) m.set(id, n); }",
  "  return { names: [...m.values()], ids: [...new Set([...document.querySelectorAll('article[data-gtm-target=\"nft_card\"][data-gtm-token-id]')].map((e) => e.getAttribute('data-gtm-token-id')))] }; });",
];

// ── 03-p2p-trade-flow ─────────────────────────────────────────────────────
svc.flows.push(
  flow("marketplace-03-detail-visitor", "마켓플레이스 · 판매 중 NFT 상세(비회원)",
    "03-p2p-trade-flow: 목록 맨 위 카드의 상세가 그 아이템으로 열린다",
    [
      web("list", "NFT 목록 · 첫 카드", [pause(5000), cookie(),
        { ...read("tokenId", firstBookmark, { optional: false, strategy: "attribute", attribute: "data-gtm-token-id" }), timeoutMs: 30000 }], openAt(`${MARKET}/nft`)),
      web("detail", "상세 열기", [goto(`${MARKET}/nft/{{ $input.tokenId }}`), pause(5000), cookie()]),
      auth("where"),
      judge([
        check("상세 경로 /marketplace/nft/<토큰>", "{{ $input.url }}", "contains", `/marketplace/nft/{{ $node.list.tokenId }}`),
        check("제목이 «| Details | MSU Marketplace»", "{{ $input.title }}", "matches", "\\| Details \\| MSU Marketplace"),
        check("아이템 이름(제목 앞부분)이 비어 있지 않다", "{{ $input.title }}", "matches", "^\\s*[^|\\s][^|]*\\|"),
      ]),
    ]),
);
svc.items.push(item("m03a", "marketplace-03-detail-visitor", "[03-p2p-trade-flow] 판매 중인 NFT의 상세 페이지가 아이템 정보와 거래 이력을 보여준다"));

// ── 04-bookmark ───────────────────────────────────────────────────────────
svc.flows.push(
  flow("marketplace-04-bookmark-visitor", "마켓플레이스 · 비회원 북마크 → Sign in",
    "04-bookmark: 로그인하지 않고 상세의 북마크를 누르면 저장되지 않고 Sign in 모달이 열린다 — 토큰은 실행 입력",
    [
      web("open", "NFT 상세 열기", [pause(5000), cookie(),
        { ...read("before", detailBookmark, { optional: false, strategy: "attribute", attribute: "aria-label" }), timeoutMs: 20000 }],
        openAt(`${MARKET}/nft/{{ $params.tokenId }}`)),
      auth("auth"),
      web("press", "북마크 누르기", [click(detailBookmark), pause(4000),
        read("modal", signInModal),
        read("after", detailBookmark, { strategy: "attribute", attribute: "aria-label" })]),
      judge([
        check("전제: 로그인하지 않았다", "{{ $node.auth.isLogin }}", "isFalse"),
        check("누르기 전 북마크되어 있지 않다", "{{ $node.open.before }}", "ne", "Remove Bookmark"),
        check("Sign in 모달이 열린다", "{{ $input.modal }}", "notEmpty"),
        check("누른 뒤에도 북마크되지 않는다", "{{ $input.after }}", "ne", "Remove Bookmark"),
      ]),
    ],
    [{ name: "tokenId", label: "NFT 토큰 id", default: NFT_TOKEN, help: "qa.msu.io/marketplace/nft/<토큰>으로 열리는 NFT" }]),
);
svc.items.push(item("m04a", "marketplace-04-bookmark-visitor", "[04-bookmark] 로그인하지 않은 방문자가 북마크를 누르면 저장되지 않고 Sign in 모달이 열린다", { tokenId: NFT_TOKEN }));

// ── 05-explore-tabs ───────────────────────────────────────────────────────
type Tab = "nft" | "character" | "nickname" | "ft" | "bid";
/** 탭마다 늘 그리는 것(원본 MsuMarketplacePage.TABS) — 목록 탭은 자기 검색 칸, ft · bid는 한 자산으로 넘어가서 버튼 */
const HOOK: Record<Tab, [string, string]> = {
  nft: ['input[name="keyword"][placeholder="Search Items"]:visible >> nth=0', "placeholder"],
  character: ['input[name="keyword"][placeholder="Search Characters"]:visible >> nth=0', "placeholder"],
  nickname: ['input[name="keyword"][placeholder="Search Nicknames"]:visible >> nth=0', "placeholder"],
  ft: ['[data-gtm-target="refresh_btn"]:visible >> nth=0', "data-gtm-target"],
  bid: ['[data-gtm-target="heart_btn"]:visible >> nth=0', "data-gtm-target"],
};
const tabOpen = (tab: Tab) =>
  web(`t_${tab}`, `${tab} 탭 열기`, [goto(`${MARKET}/${tab}`), pause(6000), cookie(),
    read("hook", T(`${tab} 탭의 표식`, "css", HOOK[tab][0]), { strategy: "attribute", attribute: HOOK[tab][1] })]);
/** 목록 탭의 상태 — 카드 수, 없으면 «There are no … yet» 안내(원본 state()) · 둘 다 없으면 빈 값 */
const listState = (tab: Tab) =>
  custom(`l_${tab}`, `${tab} 목록 상태`, [
    `const cards = await page.locator('[data-gtm-target="${tab}_card"][data-gtm-token-id]').count();`,
    "const notice = await page.locator('text=/There are no .* yet/').first().isVisible().catch(() => false);",
    "return { state: cards > 0 ? `${cards}개 카드` : notice ? '매물 없음(안내 문구)' : '' };",
  ], ["state"]);
const TABS: Tab[] = ["nft", "character", "nickname", "ft", "bid"];
const LIST_TABS: Tab[] = ["nft", "character", "nickname"];

svc.flows.push(
  flow("marketplace-05-tabs-visitor", "마켓플레이스 · 탐색 탭 다섯",
    "05-explore-tabs: NFT · 캐릭터 · 닉네임 · FT · Bid 탭이 각자의 경로와 화면으로 열린다 — 목록 탭은 카드가 있거나 «없다»고 말한다",
    [
      web("start", "마켓플레이스", [pause(1000)], openAt(MARKET)),
      ...TABS.flatMap((tab) => [tabOpen(tab), auth(`w_${tab}`), ...(LIST_TABS.includes(tab) ? [listState(tab)] : [])]),
      judge(TABS.flatMap((tab) => [
        check(`${tab} 탭 경로`, `{{ $node.w_${tab}.url }}`, "contains", `/marketplace/${tab}`),
        check(`${tab} 탭의 콘텐츠가 보인다`, `{{ $node.t_${tab}.hook }}`, "notEmpty"),
        ...(LIST_TABS.includes(tab)
          ? [check(`${tab} 탭은 카드를 보여주거나 비었다고 말한다`, `{{ $node.l_${tab}.state }}`, "notEmpty")]
          : []),
      ])),
    ]),
  flow("marketplace-05-connect-visitor", "마켓플레이스 · 탭마다 로그인 진입점",
    "05-explore-tabs: 비회원에게 NFT · 캐릭터 · Bid 탭 모두 헤더에 Connect가 보인다",
    [
      web("start", "마켓플레이스", [pause(1000)], openAt(MARKET)),
      ...(["nft", "character", "bid"] as Tab[]).flatMap((tab) => [
        web(`t_${tab}`, `${tab} 탭 열기`, [goto(`${MARKET}/${tab}`), pause(5000), cookie(), read("connect", headerConnect)]),
        auth(`w_${tab}`),
      ]),
      judge((["nft", "character", "bid"] as Tab[]).flatMap((tab) => [
        check(`${tab}: 전제 — 로그인하지 않았다`, `{{ $node.w_${tab}.isLogin }}`, "isFalse"),
        check(`${tab} 탭에 Connect 버튼`, `{{ $node.t_${tab}.connect }}`, "contains", "Connect"),
      ])),
    ]),
);
svc.items.push(
  item("m05a", "marketplace-05-tabs-visitor", "[05-explore-tabs] NFT · 캐릭터 · 닉네임 · FT · Bid 탭이 각각의 화면으로 열린다"),
  item("m05b", "marketplace-05-connect-visitor", "[05-explore-tabs] 비로그인 방문자에게는 모든 탭에서 로그인 진입점이 노출된다"),
);

// ── 06-search-and-filter ──────────────────────────────────────────────────
svc.flows.push(
  flow("marketplace-06-keyword-visitor", "마켓플레이스 · 키워드 검색(비회원)",
    "06-search-and-filter: 첫 카드의 이름으로 검색하면 URL에 검색어가 실리고 결과가 모두 그 이름을 담는다",
    [
      web("list", "NFT 목록 · 첫 카드 이름", [pause(5000), cookie(),
        { ...read("itemName", firstBookmark, { optional: false, strategy: "attribute", attribute: "data-gtm-item-name" }), timeoutMs: 30000 }], openAt(`${MARKET}/nft`)),
      custom("term", "검색어(«#» 앞)", "return { term: String(input.itemName).split('#')[0].trim() };", ["term"], false),
      web("search", "검색", [fill(keywordBox, "{{ $input.term }}"), press(keywordBox, "Enter"), pause(4000)]),
      custom("result", "URL의 검색어 · 결과 이름", [
        "const keyword = new URL(page.url()).searchParams.get('keyword') ?? '';",
        "const names = await page.evaluate(() => [...document.querySelectorAll('button.bookmark')].map((b) => b.getAttribute('data-gtm-item-name') || '').filter(Boolean));",
        "const t = String(input.term).toLowerCase();",
        "return { keyword, names, strays: names.filter((n) => !n.toLowerCase().includes(t)) };",
      ], ["keyword", "names", "strays"]),
      judge([
        check("검색어가 URL에 반영된다", "{{ $input.keyword }}", "eq", "{{ $node.term.term }}"),
        check("검색 결과가 있다", "{{ $input.names }}", "countGte", "1"),
        check("결과가 모두 검색어를 포함한다(벗어난 결과 0)", "{{ $input.strays }}", "countEq", "0"),
      ]),
    ]),
);
svc.items.push(item("m06a", "marketplace-06-keyword-visitor", "[06-search-and-filter] 키워드로 검색하면 결과가 그 키워드로 좁혀진다"));

// ── 07-bid-signed-out ─────────────────────────────────────────────────────
const heart = T("Watch List(heart_btn)", "css", '[data-gtm-target="heart_btn"]:visible >> nth=0');
svc.flows.push(
  flow("marketplace-07-watchlist-visitor", "마켓플레이스 · Bid Watch List는 로그인 요구",
    "07-bid-signed-out: 비회원이 Bid 페이지의 Watch List(하트)를 누르면 Sign in 모달이 열린다",
    [
      web("open", "Bid 탭 · 하트 누르기", [pause(6000), cookie(),
        read("heart", heart, { strategy: "attribute", attribute: "data-gtm-target" }),
        click(heart), pause(4000),
        read("modal", signInModal)], openAt(`${MARKET}/bid`)),
      judge([
        check("Watch List 버튼이 보인다", "{{ $input.heart }}", "notEmpty"),
        check("Watch List는 로그인을 요구한다(Sign in 모달)", "{{ $input.modal }}", "notEmpty"),
      ]),
    ]),
);
svc.items.push(item("m07a", "marketplace-07-watchlist-visitor", "[07-bid-signed-out] Watch List 는 로그인을 요구한다"));

// ── 09-search-filters ─────────────────────────────────────────────────────
svc.flows.push(
  flow("marketplace-09-filters-visitor", "마켓플레이스 · 비회원은 키워드만, 상세 필터는 안 걸린다",
    "09-search-filters: 비회원의 키워드 검색은 조회 요청을 보내고 결과를 좁힌다 · 가격 필터 Search는 요청 · URL · 목록 · 모달 어느 것도 바꾸지 않는다",
    [
      web("list", "NFT 목록", [pause(6000), cookie(),
        read("firstName", T("첫 카드 이름", "xpath", '(//*[@data-gtm-target="nft_card" and @data-gtm-token-id and @data-gtm-item-name])[1]'), { strategy: "attribute", attribute: "data-gtm-item-name" })],
        openAt(`${MARKET}/nft`)),
      custom("prep", "로그인 상태 · 검색어 · 요청 듣기", [
        "const raw = await page.evaluate(() => localStorage.getItem('msu_auth_store'));",
        "let isLogin = false; try { isLogin = JSON.parse(raw)?.state?.isLogin === true; } catch {}",
        ...WATCH_EXPLORE,
        "return { isLogin, term: String(input.firstName || 'AbsoLab Piercing Spear').split('#')[0].trim() };",
      ], ["isLogin", "term"]),
      web("search", "키워드 검색", [fill(keywordBox, "{{ $input.term }}"), press(keywordBox, "Enter"), pause(5000)]),
      custom("kw", "키워드 검색 결과 · 나간 요청", [
        "const calls = page.__explore.splice(0);",
        ...CARDS,
        "const t = String(input.term).toLowerCase();",
        "const notice = cards.names.length ? '' : await page.locator('text=/No (search )?results|There are no .* yet/i').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => '없음 안내', () => '');",
        "return { notice, keyword: new URL(page.url()).searchParams.get('keyword') ?? '', callCount: calls.length, lastBody: calls[calls.length - 1] ?? '',",
        "  hits: cards.names, firstHit: cards.names[0] ?? '', strays: cards.names.filter((n) => !n.toLowerCase().includes(t)) };",
      ], ["keyword", "callCount", "lastBody", "hits", "firstHit", "strays", "notice"]),
      web("reopen", "NFT 목록 다시", [goto(`${MARKET}/nft`), pause(6000)]),
      custom("before", "필터 전 URL · 카드 수", [...CARDS, ...WATCH_EXPLORE, "return { url: page.url(), cards: cards.ids.length };"], ["url", "cards"]),
      web("filter", "가격 상한 · 필터 Search", [
        fill(T("가격 상한(priceRange.1)", "css", 'input[name="priceRange.1"]:visible >> nth=0'), "{{ $params.priceMax }}"),
        click(T("필터 Search", "xpath", '//button[normalize-space(.)="Search"]')), pause(3000),
        read("modal", signInModal)]),
      custom("after", "필터 후 요청 · URL · 카드 수", [...CARDS, "return { callCount: page.__explore.splice(0).length, url: page.url(), cards: cards.ids.length };"], ["callCount", "url", "cards"]),
      judge([
        check("전제: 로그인하지 않았다", "{{ $node.prep.isLogin }}", "isFalse"),
        check("검색어가 URL에 실린다", "{{ $node.kw.keyword }}", "eq", "{{ $node.prep.term }}"),
        check("키워드 검색은 조회 요청을 보낸다", "{{ $node.kw.callCount }}", "gt", "0"),
        check("조회 요청에 검색어가 담긴다", "{{ $node.kw.lastBody }}", "contains", "{{ $node.prep.term }}"),
        check("결과가 모두 검색어를 포함한다(벗어난 결과 0)", "{{ $node.kw.strays }}", "countEq", "0"),
        check("결과가 있거나, 없으면 없다고 말한다", "{{ $node.kw.firstHit }}{{ $node.kw.notice }}", "notEmpty"),
        check("비회원의 필터 Search는 조회 요청을 보내지 않는다", "{{ $node.after.callCount }}", "eq", "0"),
        check("비회원의 필터 Search는 URL을 바꾸지 않는다", "{{ $node.after.url }}", "eq", "{{ $node.before.url }}"),
        check("목록도 그대로다(카드 수)", "{{ $node.after.cards }}", "eq", "{{ $node.before.cards }}"),
        check("로그인 창을 띄우지도 않는다(현재 동작)", "{{ $node.filter.modal }}", "empty"),
      ]),
    ],
    [{ name: "priceMax", label: "가격 상한(NESO)", default: "2", help: "원본 MSU_FILTER_PRICE_MAX 기본값" }]),
);
svc.items.push(item("m09a", "marketplace-09-filters-visitor", "[09-search-filters] 비로그인에서는 키워드 검색만 동작하고 상세 필터는 적용되지 않는다", { priceMax: "2" }));

svc.notes.push(
  "04-bookmark: 원본은 토큰을 .env MSU_NFT_TOKEN_ID에서 읽는다 — QA에서 열리는 NFT(Neophyte Ring #131, 8467…8978)를 Suite 입력으로 고정",
  "03 · 04 · 05 · 09: 로그인 상태(localStorage msu_auth_store) · 지금 주소는 웹페이지 동작에 없어 커스텀 노드로",
  "05-explore-tabs: 원본의 «20초까지 기다리며 다시 보기»(expect.poll) 대신 탭마다 고정 6초 기다린 뒤 읽기",
  "06 · 09: «결과가 모두 검색어를 포함»은 견주는 법에 «모두»가 없어 커스텀 노드가 벗어난 이름을 골라 «0개»로 본다",
  "09-search-filters: explore/items 요청 감시는 커스텀 노드가 page에 듣개를 달아 모은다(네트워크를 보는 동작이 없다)",
  "03-p2p-trade-flow: 제목과 달리 원본도 거래 이력(Trade History)은 보지 않는다 — 원본 expect(주소 · 제목 · 이름)만 옮김. 판매 중 매물이 없으면 첫 카드 읽기에서 오류(원본도 시간 초과)",
  "05-explore-tabs: Connect 버튼은 헤더 안으로 좁혔다(원본은 페이지 전체의 첫 «Connect»)",
  "공통: 원본의 networkidle · settle 대신 고정 4~6초 기다리기",
);
