/**
 * 두 지갑 거래 — 원본 tests/marketplace/03-p2p-trade-flow(member). ★아직 QA에서 돌려 보지 않았다(README «두 지갑 거래»).
 *
 * 원본은 판매자 · 구매자 브라우저를 둘 다 띄워 두지만 동시에 조작하지 않는다 — 차례를 주고받는다.
 * 그래서 «실행 하나 = 브라우저 하나 = 지갑 하나»로 쪼개고 지휘 워크플로우가 차례로 부른다:
 *
 *   역할 정하기(지갑 없음) → 판매 등록(판매자 지갑) → 구매(구매자 지갑) → 소유권 확인(지갑 없음) → 정리(판매자 지갑) → 판정
 *
 * 역할은 실행 때 정해진다(토큰을 가진 쪽이 판매자) — 지갑 워크플로우는 지갑 시크릿을 실행 입력으로 고른다(`{{ $params.wallet }}`).
 * 부르는 쪽은 실패해도 이어 가고(onError continue), 정리는 «팔리지 않은 채 우리가 올린 매물»만 내린다(원본의 finally).
 */
import {
  MARKET, T, call, check, click, cookie, custom, endIf, fill, flow, hidden, item, judge, openAt, pause, visible, waitVisible,
  waitHiddenReloading, waitVisibleReloading, walletApprove, web, type Param, type Service,
} from "./lib.ts";

/** QA 지갑 둘 — 시크릿 이름. 값(복구 문구 · 개인키)은 서버의 시크릿에 넣는다 */
const WALLETS = ["msu_qa_wallet_a", "msu_qa_wallet_b"];
/** 이 거래들끼리 줄을 세운다 — 같은 지갑 · 같은 자산을 동시에 만지지 않게(오퍼 · FT · 비드도 같은 이름을 쓴다) */
const LOCK = "msu-qa-wallets";
/**
 * QA 체인 — 원본 docs/4. METAMASK-NOTES.md(MSUQA · 807424 · NXPC). 새 MetaMask는 이 체인을 몰라 RPC로 먼저 더한다.
 * 거래(NFT 승인 같은 것)도 이 체인에서만 누른다 — QA 테스트넷 전용
 */
const QA_CHAIN = { chainId: 807424, name: "MSUQA", rpcUrl: "https://qa-testnet-rpc.msu.io", allowTx: true, symbol: "NXPC" };

const walletParam: Param = { name: "wallet", label: "지갑", type: "select", options: WALLETS, default: WALLETS[0], help: "이 실행이 쓸 지갑(시크릿) — 지휘 워크플로우가 역할에 따라 고른다" };
const walletFlow = {
  // 팀 공용 값 — 키는 한 번만 넣고 지갑 워크플로우 셋이 같이 쓴다(워크플로우마다 넣지 않는다)
  secrets: WALLETS.map((name) => ({ name, kind: "text", shared: true, description: "MSU QA 테스트 지갑 — 복구 문구 또는 개인키(QA 체인 전용) · 팀 공용 값에 넣는다" })),
  settings: { browser: "wallet", wallet: { mode: "metamask", secret: "{{ $params.wallet }}", announceAs: "MetaMask", defaultChainId: QA_CHAIN.chainId, chains: [QA_CHAIN] } },
};
const detailUrl = `${MARKET}/{{ $params.kind }}/{{ $params.tokenId }}`;
const assetParams: Param[] = [
  { name: "kind", label: "자산 종류", type: "select", options: ["nft", "character"], default: "nft", help: "상세 경로 /marketplace/<kind>/<tokenId>" },
  { name: "tokenId", label: "토큰 id" },
];

/** 헤더 Connect → 로그인 창의 «MetaMask Installed» → 연결 · SIWE 서명. 이미 로그인돼 있으면 아무것도 누르지 않는다 */
const headerConnect = T("헤더의 Connect", "css", 'header button:has-text("Connect")');
const login = () => web("login", "로그인(MetaMask)", [
  pause(5000), cookie(),
  click(headerConnect, true), pause(1500),
  click(T("로그인 창의 «MetaMask Installed»", "xpath", '(//button[contains(.,"MetaMask") and contains(.,"Installed")])[1]'), true),
  walletApprove(hidden(headerConnect), 120000),
], openAt(MARKET));

const cancelListing = T("Cancel Listing", "css", 'button:has-text("Cancel Listing")');
const buyNow = T("Buy Now", "role", "button", "Buy Now");
const confirmBuy = T("구매 확인의 Buy", "role", "button", "Buy");

/** 인벤토리의 토큰 id들 — 카드는 링크가 아니고 북마크 단추가 id를 든다(원본 inventory.page.ts) */
const inventoryIds = [
  "const ids = async (address, tab) => {",
  "  const u = new URL(`https://qa.msu.io/marketplace/inventory/${address}`);",
  "  if (tab) u.searchParams.set('tab', tab);",
  "  u.searchParams.set('tokenType', ctx.params.tokenType);",
  "  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });",
  "  await Promise.race([",
  "    page.locator('button.bookmark[data-gtm-token-id]').first().waitFor({ state: 'attached', timeout: 15000 }),",
  "    page.locator('text=/No [^.!]{0,60}(yet|found)[.!]/').first().waitFor({ state: 'visible', timeout: 15000 }),",
  "  ]).catch(() => {});",
  "  return page.evaluate(() => Array.from(document.querySelectorAll('button.bookmark[data-gtm-token-id]')).map((b) => b.getAttribute('data-gtm-token-id') || '').filter(Boolean));",
  "};",
];
const tokenTypeParam: Param = { name: "tokenType", label: "인벤토리 구분", type: "select", options: ["items", "characters"], default: "items", help: "nft → items · character → characters" };
const long = (n: { config: { timeoutMs: number } }, ms: number) => { n.config.timeoutMs = ms; return n; };

const svc: Service = {
  file: "trade",
  suite: { name: "MSU QA · 거래 (msu-e2e-test)", description: "msu-e2e-test tests/marketplace/의 두 지갑 거래 — 지휘 워크플로우가 지갑마다 역할 워크플로우를 차례로 부른다. 대상 qa.msu.io/marketplace · 화면 있는 워커 필요" },
  flows: [],
  items: [],
  notes: [],
};
export default svc;

svc.flows.push(
  // ── 역할 정하기 — 두 지갑의 인벤토리를 읽어 토큰을 가진 쪽이 판매자 ──
  flow("trade-p2p-roles", "거래 · 역할 정하기 — 토큰을 가진 쪽이 판매자",
    "03-p2p-trade-flow resolveRoles: 지갑 둘의 보유 목록에서 거래할 토큰을 고른다. 이미 판매 중이면(앞 실행이 죽음) 그것을 이어 쓴다",
    [
      web("open", "마켓 열기", [pause(3000), cookie()], openAt(MARKET)),
      long(custom("roles", "인벤토리 읽기", [
        ...inventoryIds,
        `const wallets = [{ wallet: '${WALLETS[0]}', address: ctx.params.addressA }, { wallet: '${WALLETS[1]}', address: ctx.params.addressB }];`,
        "for (const w of wallets) {",
        "  const owned = await ids(w.address);",
        "  if (owned.length === 0) continue;",
        "  const onSale = await ids(w.address, 'onsale');",
        "  const pool = ctx.params.pinnedTokenId ? owned.filter((id) => id === ctx.params.pinnedTokenId) : owned;",
        "  const tokenId = pool.find((id) => !onSale.includes(id)) ?? pool[0];",
        "  if (!tokenId) continue;",
        "  const other = wallets.find((x) => x !== w);",
        "  return { seller: w.wallet, sellerAddress: w.address, buyer: other.wallet, buyerAddress: other.address, tokenId, alreadyListed: String(onSale.includes(tokenId)) };",
        "}",
        "throw new Error(`거래할 ${ctx.params.tokenType}이 두 지갑 어디에도 없습니다 — ${ctx.params.addressA} · ${ctx.params.addressB}`);",
      ], ["seller", "sellerAddress", "buyer", "buyerAddress", "tokenId", "alreadyListed"]), 120000),
    ],
    [
      { name: "addressA", label: `지갑 A 주소(${WALLETS[0]}의 주소)` }, { name: "addressB", label: `지갑 B 주소(${WALLETS[1]}의 주소)` },
      tokenTypeParam, { name: "pinnedTokenId", label: "고정할 토큰 id", required: false, help: "비우면 보유한 첫 토큰" },
    ]),

  // ── 판매 등록 — 판매자 지갑 ──
  flow("trade-p2p-list", "거래 · 판매 등록 — 판매자 지갑",
    "03-p2p-trade-flow 1/3: 상세에서 List for sale → 가격 → Confirm → MetaMask 승인(NFT 승인 · 등록 서명 — 몇 개든). 끝 표시는 «Cancel Listing»",
    [
      endIf("resume", "앞 실행의 매물?", [{ left: "{{ $params.alreadyListed }}", op: "eq", right: "true" }], "success", "앞 실행이 남긴 판매 중 매물을 이어 씁니다"),
      login(),
      web("list", "판매 등록", [
        pause(5000), cookie(),
        waitVisible(T("List for sale", "css", 'button:has-text("List for sale")'), 30000),
        click(T("List for sale", "css", 'button:has-text("List for sale")')),
        fill(T("가격 칸", "css", 'input[name="price"]'), "{{ $params.price }}"),
        click(T("Confirm", "css", 'button:has-text("Confirm"):visible')),
        walletApprove(visible(cancelListing), 180000, 1),
      ], openAt(detailUrl)),
      custom("at", "등록 시각", "return { listedAt: String(Date.now()), created: 'true' };", ["listedAt", "created"], false),
    ],
    [walletParam, ...assetParams, { name: "price", label: "가격(NESO)", default: "1" }, { name: "alreadyListed", label: "이미 판매 중", default: "false", required: false }],
    walletFlow),

  // ── 구매 — 구매자 지갑 ──
  flow("trade-p2p-buy", "거래 · 구매 — 구매자 지갑",
    "03-p2p-trade-flow 2/3: Buy Now가 보일 때까지 새로고침 → 등록 뒤 정책 대기(non-KYC 60~120초) → Buy Now → Buy → MetaMask 승인. 끝 표시는 확인 창이 닫히는 것",
    [
      endIf("done", "앞 시도에서 샀나", [{ left: "{{ $params.skip }}", op: "eq", right: "true" }], "success", "앞 시도에서 이미 샀습니다"),
      endIf("go", "판매 등록이 됐나", [{ left: "{{ $params.listed }}", op: "ne", right: "true" }], "failure", "판매 등록이 되지 않아 사지 않습니다"),
      login(),
      web("watch", "판매 중이 될 때까지", [pause(4000), cookie(), waitVisibleReloading(buyNow, 20000, 300000)], openAt(detailUrl)),
      long(custom("floor", "등록 뒤 구매 차단 대기", [
        "const at = Number(ctx.params.listedAt) || 0;",
        "const rest = at ? at + Number(ctx.params.floorMs) - Date.now() : 0;",
        "if (rest > 0) await page.waitForTimeout(rest);",
        "return { waitedSec: String(Math.max(0, Math.round(rest / 1000))) };",
      ], ["waitedSec"]), 180000),   // 최대 120초를 기다린다 — 커스텀 노드 기본 60초로는 모자란다
      web("buy", "구매", [
        click(buyNow),
        waitVisible(confirmBuy, 15000),
        click(confirmBuy),
        // ★«Buy»는 누르면 처리 중 모양이 돼 곧바로 «사라짐»이 맞는다 — 승인 화면 하나는 꼭 받는다(원본도 지갑이 떴나를 본다)
        walletApprove(hidden(confirmBuy), 180000, 1),
      ]),
    ],
    [walletParam, ...assetParams, { name: "listed", label: "판매 등록 됨", default: "true" }, { name: "listedAt", label: "등록 시각(ms)", default: "0", required: false },
      { name: "floorMs", label: "등록 뒤 구매 차단(ms)", default: "120000", help: "non-KYC 지갑 60~120초 무작위 — 최악에 맞춘다(원본 MSU_BUY_FLOOR_MS)" },
      { name: "skip", label: "이미 삼(다시 시도할 때)", default: "false", required: false }],
    walletFlow),

  // ── 소유권 확인 — 지갑 없음. 화면이 저절로 바뀌지 않아 다시 연다 ──
  flow("trade-p2p-owned", "거래 · 소유권 확인 — 구매자에게 들어오고 판매자에게서 빠진다",
    "03-p2p-trade-flow 3/3: 구매자 보유 목록에 토큰이 들어올 때까지(정산 최대 180초) · 판매자 보유 목록에서 빠질 때까지(90초) 다시 읽는다. 판정은 지휘 워크플로우가 한다(불통과로 끝나면 읽은 값이 남지 않는다)",
    [
      endIf("go", "샀나", [{ left: "{{ $params.bought }}", op: "ne", right: "true" }], "failure", "구매가 끝나지 않아 소유권을 보지 않습니다"),
      web("open", "마켓 열기", [pause(3000), cookie()], openAt(MARKET)),
      long(custom("watch", "보유 목록 다시 읽기", [
        ...inventoryIds,
        "const until = async (address, want, ms) => {",
        "  const end = Date.now() + ms;",
        "  for (let polls = 1; ; polls++) {",
        "    if ((await ids(address)).includes(ctx.params.tokenId) === want) return { ok: true, polls };",
        "    if (Date.now() >= end) return { ok: false, polls };",
        "    await page.waitForTimeout(5000);",
        "  }",
        "};",
        "const arrived = await until(ctx.params.buyerAddress, true, Number(ctx.params.settleMs));",
        "const left = arrived.ok ? await until(ctx.params.sellerAddress, false, 90000) : { ok: false, polls: 0 };",
        "return { sold: String(arrived.ok), arrived: String(arrived.ok), left: String(left.ok), polls: String(arrived.polls + left.polls) };",
      ], ["sold", "arrived", "left", "polls"]), 360000),
    ],
    [{ name: "sellerAddress", label: "판매자 주소" }, { name: "buyerAddress", label: "구매자 주소" }, { name: "tokenId", label: "토큰 id" }, tokenTypeParam,
      { name: "settleMs", label: "정산 기다림(ms)", default: "180000", help: "원본 MSU_SETTLE_TIMEOUT_MS — 60초에 끊긴 실행이 모두 실패했다" },
      { name: "bought", label: "구매 됨", default: "true" }]),

  // ── 정리 — 팔리지 않은 채 우리가 올린 매물만 내린다(원본 finally) ──
  flow("trade-p2p-cancel", "거래 · 정리 — 팔리지 않은 매물 내리기",
    "03-p2p-trade-flow finally: 우리가 올렸고 팔리지 않았으면 Cancel Listing → Yes(지갑 없이 서버에서) → 사라질 때까지 다시 열기. 팔렸으면 그대로(다음 실행이 반대로 돈다)",
    [
      endIf("need", "내릴 것이 있나", [{ left: "{{ $params.created }}", op: "ne", right: "true" }, { left: "{{ $params.sold }}", op: "eq", right: "true" }], "success", "내릴 매물이 없습니다(팔렸거나 우리가 올리지 않음)"),
      login(),
      web("cancel", "판매 내리기", [
        pause(5000), cookie(),
        click(cancelListing, true),
        click(T("Yes", "role", "button", "Yes"), true),
        // QA(2026-10-27): Yes는 지갑을 부르지 않고 서버에서 내린다 · 화면은 저절로 바뀌지 않는다 — 다시 열며 사라지길 본다
        waitHiddenReloading(cancelListing, 5000, 90000),
      ], openAt(detailUrl)),
    ],
    [walletParam, ...assetParams, { name: "created", label: "우리가 올림", default: "false" }, { name: "sold", label: "팔림", default: "false" }],
    walletFlow),
);

// ── 지휘 — Suite에 넣는 것. 부품을 차례로 부르고 실패해도 정리까지 간다 ──
const r = (node: string, key: string) => `{{ $node.${node}.${key} }}`;
const roleOut = (key: string) => `{{ $node.roles.results.0.output.${key} }}`;
const first = (out: string[]) => [
  "const r = input.results?.[0];",
  "const o = r?.output ?? {};",
  `return { ok: String(r?.status === 'success'), message: r?.message ?? '', ${out.map((k) => `${k}: String(o.${k} ?? '')`).join(", ")} };`,
];
svc.flows.push(
  flow("trade-p2p", "거래 · P2P — 등록하고 상대 지갑이 사면 소유권이 넘어간다",
    "03-p2p-trade-flow: 역할 → 판매 등록(판매자) → 구매(구매자) → 소유권 확인 → 정리 → 판정. 부품은 trade-p2p-*. 지갑 주소 둘은 실행 입력",
    [
      call("roles", "역할 정하기", "trade-p2p-roles", {
        addressA: "{{ $params.addressA }}", addressB: "{{ $params.addressB }}", tokenType: "{{ $params.tokenType }}",
      }, "stop"),
      call("list", "판매 등록(판매자)", "trade-p2p-list", {
        wallet: roleOut("seller"), kind: "{{ $params.kind }}", tokenId: roleOut("tokenId"), price: "{{ $params.price }}", alreadyListed: roleOut("alreadyListed"),
      }),
      custom("listed", "등록 결과", first(["listedAt", "created"]), ["ok", "message", "listedAt", "created"], false),
      call("buy", "구매(구매자)", "trade-p2p-buy", {
        wallet: roleOut("buyer"), kind: "{{ $params.kind }}", tokenId: roleOut("tokenId"), listed: r("listed", "ok"), listedAt: r("listed", "listedAt"),
      }),
      custom("tried", "첫 구매 결과", first([]), ["ok", "message"], false),
      // 거절되면 한 번 더(원본: 20초 간격 재시도) — 다시 로그인 · 판매 중 확인을 거치니 정책의 «10초에 한 번»은 저절로 지켜진다
      call("buyAgain", "구매 다시(구매자)", "trade-p2p-buy", {
        wallet: roleOut("buyer"), kind: "{{ $params.kind }}", tokenId: roleOut("tokenId"), listed: r("listed", "ok"), listedAt: r("listed", "listedAt"), skip: r("tried", "ok"),
      }),
      custom("bought", "구매 결과", first([]), ["ok", "message"], false),
      call("owned", "소유권 확인", "trade-p2p-owned", {
        sellerAddress: roleOut("sellerAddress"), buyerAddress: roleOut("buyerAddress"), tokenId: roleOut("tokenId"), tokenType: "{{ $params.tokenType }}", bought: r("bought", "ok"),
      }),
      custom("moved", "소유권 결과", first(["sold", "arrived", "left"]), ["ok", "message", "sold", "arrived", "left"], false),
      call("cleanup", "정리(판매자)", "trade-p2p-cancel", {
        wallet: roleOut("seller"), kind: "{{ $params.kind }}", tokenId: roleOut("tokenId"), created: r("listed", "created"), sold: r("moved", "sold"),
      }),
      judge([
        check("판매 등록이 반영됐다", r("listed", "ok"), "isTrue"),
        check("구매자가 샀다(지갑 승인까지)", r("bought", "ok"), "isTrue"),
        check("구매자 보유 목록에 들어왔다", r("moved", "arrived"), "isTrue"),
        check("판매자 보유 목록에서 빠졌다", r("moved", "left"), "isTrue"),
        check("정리가 끝났다", "{{ $node.cleanup.failed }}", "eq", "0"),
      ]),
    ],
    [
      { name: "addressA", label: "지갑 A 주소", help: `${WALLETS[0]}의 주소(원본 SELLER_ADDRESS)` },
      { name: "addressB", label: "지갑 B 주소", help: `${WALLETS[1]}의 주소(원본 BUYER_ADDRESS)` },
      assetParams[0]!, tokenTypeParam, { name: "price", label: "가격(NESO)", default: "1" },
    ],
    { settings: { locks: [LOCK] } }),
);

/** Suite 입력 — 지갑 주소는 비워 둔다(원본 .env). 서버에서 Suite를 열어 넣는다 */
const addresses = { addressA: "", addressB: "" };
svc.items.push(
  item("t1", "trade-p2p", "[03-p2p-trade-flow] NFT 아이템을 등록하고 상대 지갑이 사면 소유권이 넘어간다", { ...addresses, kind: "nft", tokenType: "items", price: "1" }),
  item("t2", "trade-p2p", "[03-p2p-trade-flow] 캐릭터를 등록하고 상대 지갑이 사면 소유권이 넘어간다", { ...addresses, kind: "character", tokenType: "characters", price: "1" }),
);
svc.notes.push(
  "03-p2p-trade-flow: QA 지갑 키 둘은 팀 공용 값(시크릿 msu_qa_wallet_a · _b)에 한 번 넣는다 — 워크플로우 입력에 키를 넣지 않는다 · 지갑 주소 둘은 Suite 입력 · 화면 있는 워커에서 돌린다",
  "03-p2p-trade-flow: 지갑 설정의 QA 체인 MSUQA(807424 · qa-testnet-rpc.msu.io)를 MetaMask에 먼저 더하고 그 체인의 거래만 누른다(원본 지갑 준비와 같게)",
  "03-p2p-trade-flow: 구매 재시도는 한 번(원본: 20초 간격 · 5분까지) — 지휘가 구매 부품을 다시 부른다(앞에서 샀으면 건너뜀). 구매 승인은 «지갑 승인 화면 하나 이상»을 받아야 끝으로 친다",
  "03-p2p-trade-flow: 구매 승인의 끝 표시는 «구매 확인 창이 닫힘» — 원본은 판매자 화면으로 소유권을 보며 승인했다. 소유권은 다음 부품(trade-p2p-owned)이 따로 본다",
  "03-p2p-trade-flow: 인벤토리의 토큰 id 읽기 · 다시 읽기 · 등록 뒤 대기는 커스텀 노드로 — 위치에 표현식을 쓸 수 없어 «이 토큰 id가 목록에 있나»를 동작으로 못 적는다",
);
