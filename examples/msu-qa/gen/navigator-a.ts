/** Navigator — 04-detail-pages · 05-not-found · 06-owner-listing · 07-character-detail · 09-watchlist (원본 tests/navigator/). navigator.ts가 합친다 */
import { NAV, WEB, T, check, click, cookie, custom, flow, goto, item, judge, noLeak, openAt, pause, read, web, where, type Part } from "./lib.ts";

const part: Part = { flows: [], items: [], notes: [] };
export default part;

/** 탭 — `<li role="tab">`. 캐릭터 상세엔 «Info»가 두 단계에 있어 문서 순서 첫 것(원본 .first()와 같다 — 상위 탭) */
const tab = (l: string) => T(`탭 «${l}»`, "xpath", `(//li[@role="tab"][normalize-space(.)="${l}"])[1]`);
const key = (l: string) => l.replace(/[^A-Za-z]/g, "");
const notFound = T("«Page Not Found»", "xpath", '(//h2[contains(normalize-space(.),"Page Not Found")])[1]');
const firstLink = (kind: string) => T(`첫 ${kind} 링크`, "xpath", `(//a[contains(@href,"/navigator/${kind}/")])[1]`);

const DETAIL_TABS = ["Info", "History", "Activity"];
const OWNER_TABS = ["Character", "Items", "Nicknames", "Watchlist"];
const CHARACTER_TABS = ["Info", "Holding items", "History", "Activity"];

/**
 * 원본 selectedTab(labels) — 목록 순서로 처음 aria-selected="true"인 탭. «그 탭이다»는
 * 그 탭이 true이고 앞 탭들이 true가 아니라는 뜻이라 둘 다 본다
 */
const selReads = (labels: string[], p: string) => labels.map((l) => read(`${p}${key(l)}`, tab(l), { strategy: "attribute", attribute: "aria-selected" }));
const selIs = (labels: string[], want: string, ref: string, p: string, what: string) => {
  const at = labels.indexOf(want);
  return [
    check(`${what} — ${want} 선택`, `{{ ${ref}.${p}${key(want)} }}`, "eq", "true"),
    ...labels.slice(0, at).map((l) => check(`${what} — 앞 탭 ${l}는 선택 아님`, `{{ ${ref}.${p}${key(l)} }}`, "ne", "true")),
  ];
};

/**
 * 원본 someCharacterId() · ownerWithPaging()의 길 — 랜딩 아이템 랭킹 → 그 아이템의 소유자 → 소유자의 Character 목록.
 * QA는 Character Rankings가 비어 있어 원본도 이 길로 돈다. 못 찾으면 원본처럼 멈춘다(오류)
 */
const seed = (needMore: boolean) => {
  const c = custom("seed", needMore ? "2페이지 이상인 지갑 찾기" : "캐릭터 · 소유자 찾기", [
    `const base = ${JSON.stringify(WEB)}; const open = async (u) => { await page.goto(new URL(u, base).href, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000); };`,
    "const hrefs = async (k) => [...new Set(await page.locator(`a[href*=\"/navigator/${k}/\"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href'))))];",
    `await open(${JSON.stringify(NAV)});`,
    "await page.locator('a[href*=\"/navigator/nft/\"]').first().waitFor({ state: 'attached', timeout: 30000 });",
    "const items = await hrefs('nft'); const seen = [];",
    "for (const it of items.slice(0, 5)) {",
    "  await open(it);",
    "  const o = await page.locator('a[href*=\"/navigator/owner/\"]').first().getAttribute('href', { timeout: 15000 }).catch(() => null);",
    "  if (!o || seen.includes(o)) continue; seen.push(o);",
    "  await open(o);",
    "  await page.locator('a[href*=\"/navigator/character/\"]').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});",
    "  const chars = await hrefs('character'); if (!chars.length) continue;",
    needMore ? "  if (!(await page.getByRole('button', { name: 'More', exact: true }).first().isVisible().catch(() => false))) continue;" : "",
    "  return { character: chars[0].split('/navigator/character/')[1], characterUrl: new URL(chars[0], base).href, owner: o.split('/navigator/owner/')[1], ownerUrl: new URL(o, base).href };",
    "}",
    `throw new Error('랭킹 아이템 ' + items.length + '개의 소유자(' + seen.length + '명) 중 ${needMore ? "캐릭터 목록이 2페이지 이상인" : "캐릭터를 가진"} 지갑이 없습니다');`,
  ].filter(Boolean), ["character", "characterUrl", "owner", "ownerUrl"]);
  c.config.timeoutMs = 180000;
  return c;
};
/** 랜딩 아이템 랭킹 첫 링크(원본 rankedNftId) — 절대 주소로 */
const findNft = () => web("find", "랜딩에서 랭킹 아이템 고르기", [pause(5000), cookie(), read("nft", firstLink("nft"), { optional: false, strategy: "link" })], openAt(NAV));

// ── 04-detail-pages ─────────────────────────────────────────────────────────
part.flows.push(
  flow("navigator-04-nft-tabs", "Navigator · NFT 상세 탭 전환",
    "04-detail-pages: 랭킹 아이템의 NFT 상세가 열리고 기본 Info에서 History로 전환된다",
    [
      findNft(),
      web("nft", "NFT 상세 · History 누르기", [pause(5000), cookie(),
        ...selReads(DETAIL_TABS, "b"),
        click(tab("History")), pause(3000),
        ...selReads(DETAIL_TABS, "a")], openAt("{{ $node.find.nft }}")),
      where(),
      judge([
        check("제목에 «| MSU Navigator»", "{{ $input.title }}", "contains", "| MSU Navigator"),
        ...selIs(DETAIL_TABS, "Info", "$node.nft", "b", "기본 탭은 Info"),
        ...selIs(DETAIL_TABS, "History", "$node.nft", "a", "History 누른 뒤"),
      ]),
    ]),
  flow("navigator-04-nft-history-param", "Navigator · ?tab=history로 History 바로 열기",
    "04-detail-pages: NFT 상세 주소에 ?tab=history를 붙이면 History 탭으로 열린다",
    [
      findNft(),
      web("nft", "?tab=history로 열기", [pause(5000), cookie(), ...selReads(DETAIL_TABS, "s")], openAt("{{ $node.find.nft }}?tab=history")),
      judge(selIs(DETAIL_TABS, "History", "$node.nft", "s", "History 로 열려야 한다")),
    ]),
  flow("navigator-04-character", "Navigator · 캐릭터 상세 열기",
    "04-detail-pages: 캐릭터 상세가 404 없이 열린다 — 캐릭터는 아이템 랭킹 → 소유자 → Character 목록에서 고름",
    [
      seed(false),
      web("open", "캐릭터 상세", [pause(5000), cookie(), read("notFound", notFound)], openAt("{{ $node.seed.characterUrl }}")),
      where(),
      judge([
        check("캐릭터 상세 주소", "{{ $input.url }}", "contains", "/navigator/character/{{ $node.seed.character }}"),
        check("404 가 아니어야 한다", "{{ $node.open.notFound }}", "empty"),
        check("제목에 «| MSU Navigator»", "{{ $input.title }}", "contains", "| MSU Navigator"),
      ]),
    ]),
  flow("navigator-04-owner-tabs", "Navigator · 소유자 상세 탭 4종",
    "04-detail-pages: 랭킹 아이템의 소유자 상세에 Character · Items · Nicknames · Watchlist 탭이 있고 기본은 Character",
    [
      findNft(),
      web("nft", "아이템 상세에서 소유자 링크", [pause(5000), cookie(), read("owner", firstLink("owner"), { strategy: "link" })], openAt("{{ $node.find.nft }}")),
      web("owner", "소유자 상세", [pause(5000), cookie(), read("notFound", notFound),
        ...selReads(OWNER_TABS, "s"),
        ...OWNER_TABS.map((l) => read(`tab${key(l)}`, T(`보이는 탭 «${l}»`, "xpath", `(//li[@role="tab"][normalize-space(.)="${l}"])[1]`)))], openAt("{{ $node.nft.owner }}")),
      judge([
        check("아이템 상세에 소유자 링크가 있어야 한다", "{{ $node.nft.owner }}", "contains", "/navigator/owner/"),
        check("404 가 아니어야 한다", "{{ $node.owner.notFound }}", "empty"),
        ...selIs(OWNER_TABS, "Character", "$node.owner", "s", "기본 탭은 Character"),
        ...OWNER_TABS.map((l) => check(`${l} 탭이 있어야 한다`, `{{ $node.owner.tab${key(l)} }}`, "eq", l)),
      ]),
    ]),
);
part.items.push(
  item("n04a", "navigator-04-nft-tabs", "[04-detail-pages] NFT 상세가 열리고 Info · History · Activity 탭을 오갈 수 있다"),
  item("n04b", "navigator-04-nft-history-param", "[04-detail-pages] URL의 tab 파라미터로 History 탭에 바로 진입할 수 있다"),
  item("n04c", "navigator-04-character", "[04-detail-pages] 캐릭터 상세가 열린다"),
  item("n04d", "navigator-04-owner-tabs", "[04-detail-pages] 소유자 상세에 보유 자산 탭 4종과 더보기가 있다"),
);

// ── 05-not-found ────────────────────────────────────────────────────────────
part.flows.push(
  flow("navigator-05-unknown-no-leak", "Navigator · 없는 id 조회 — 내부 정보 미노출",
    "05-not-found: 존재하지 않는 NFT · 캐릭터 · 지갑 주소를 열어도 내부 오류 정보가 화면에 나오지 않는다 — 경로는 실행 입력",
    [
      web("open", "없는 id 열기", [pause(6000), read("body", T("본문 전체", "css", "body"))], openAt(`${NAV}/{{ $params.path }}`)),
      judge(noLeak("{{ $node.open.body }}")),
    ],
    [{ name: "path", label: "없는 대상 경로", default: "nft/ITEMdoesnotexist000000000", help: "nft/ITEMdoesnotexist000000000 · character/CHARdoesnotexist000000000 · owner/0xdeadbeef" }]),
  flow("navigator-05-not-found-404", "Navigator · 없는 NFT · 지갑 주소는 404",
    "05-not-found: 존재하지 않는 NFT · 지갑 주소는 Page Not Found로 처리된다",
    [
      web("nft", "없는 NFT", [pause(8000), read("notFound", notFound)], openAt(`${NAV}/nft/ITEMdoesnotexist000000000`)),
      web("owner", "없는 지갑 주소", [goto(`${NAV}/owner/0xdeadbeef`), pause(8000), read("notFound", notFound)]),
      judge([
        check("NFT: 404 페이지여야 한다", "{{ $node.nft.notFound }}", "contains", "Page Not Found"),
        check("지갑 주소: 404 페이지여야 한다", "{{ $node.owner.notFound }}", "contains", "Page Not Found"),
      ]),
    ]),
);
part.items.push(
  item("n05a", "navigator-05-unknown-no-leak", "[05-not-found] 존재하지 않는 NFT 조회 시 내부 정보가 노출되지 않는다", { path: "nft/ITEMdoesnotexist000000000" }),
  item("n05b", "navigator-05-unknown-no-leak", "[05-not-found] 존재하지 않는 캐릭터 조회 시 내부 정보가 노출되지 않는다", { path: "character/CHARdoesnotexist000000000" }),
  item("n05c", "navigator-05-unknown-no-leak", "[05-not-found] 존재하지 않는 지갑 주소 조회 시 내부 정보가 노출되지 않는다", { path: "owner/0xdeadbeef" }),
  item("n05d", "navigator-05-not-found-404", "[05-not-found] 존재하지 않는 NFT · 지갑 주소는 404 로 처리된다"),
);

// ── 06-owner-listing ────────────────────────────────────────────────────────
/** 소유자 탭 하나를 누르고 → 선택 상태를 읽는 웹 노드 + 지금 주소 */
const ownerTabStep = (l: string, i: number) => [
  web(`t${i}`, `${l} 누르기`, [click(tab(l)), pause(3000), ...selReads(OWNER_TABS, "s")], i === 0 ? openAt("{{ $node.seed.ownerUrl }}") : undefined),
  where(`w${i}`),
];
part.flows.push(
  flow("navigator-06-owner-tab-url", "Navigator · 지갑 상세 탭 전환 → 주소 반영",
    "06-owner-listing: 지갑 상세의 탭을 차례로 누르면 선택이 옮겨 가고, 주소는 유지된 채 ?tab=<탭>이 붙는다",
    [
      seed(false),
      ...OWNER_TABS.flatMap((l, i) => {
        const [w, wh] = ownerTabStep(l, i);
        if (i === 0) w.config.actions.unshift(pause(5000), cookie());
        return [w, wh];
      }),
      judge(OWNER_TABS.flatMap((l, i) => [
        ...selIs(OWNER_TABS, l, `$node.t${i}`, "s", `${l} 선택 상태`),
        check(`${l}: 주소가 유지되어야 한다`, `{{ $node.w${i}.url }}`, "contains", "{{ $node.seed.owner }}"),
        check(`${l}: 탭이 주소에 반영되어야 한다`, `{{ $node.w${i}.url }}`, "contains", `tab=${l.toLowerCase()}`),
      ])),
    ]),
);

const paging = custom("paging", "More 끝까지 · 서버 응답 건수 세기", [
  "let total = 0;",
  "const on = async (res) => { if (!/\\/inventory\\/[^/]+\\/characters-v2/.test(res.url())) return; try { const b = await res.json(); total += (b.characters ?? []).length; } catch {} };",
  "page.on('response', on);",
  "await page.goto(input.ownerUrl, { waitUntil: 'domcontentloaded' });",
  "await page.locator('a[href*=\"/navigator/character/\"]').first().waitFor({ state: 'attached', timeout: 20000 });",
  "await page.waitForTimeout(3000);",
  "const dd = page.locator('dt:text-is(\"Character\") + dd').first();",
  "const raw = (await dd.innerText({ timeout: 15000 }).catch(() => '')).replace(/[,\\s]/g, '');",
  "const held = raw && !Number.isNaN(Number(raw)) ? Number(raw) : null;",
  "const firstPage = total;",
  "const budget = held && firstPage ? Math.ceil(held / firstPage) + 3 : 10;",
  "const more = page.getByRole('button', { name: 'More', exact: true }).first();",
  "let clicks = 0;",
  "while (clicks < budget && (await more.isVisible().catch(() => false))) { await more.click(); await page.waitForTimeout(3000); clicks += 1; }",
  "await page.waitForTimeout(1500); page.off('response', on);",
  "const moreLeft = await more.isVisible().catch(() => false);",
  "return { held: held ?? '', firstPage, total, clicks, budget, moreLeft };",
], ["held", "firstPage", "total", "clicks", "budget", "moreLeft"]);
paging.config.timeoutMs = 180000;
part.flows.push(
  flow("navigator-06-owner-more", "Navigator · 지갑 상세 More 페이징",
    "06-owner-listing: Character 목록의 More를 누르면 서버가 더 보내 주고, 다 불러오면 More가 사라진다 — 응답 건수 세기는 코드로",
    [
      seed(true),
      paging,
      judge([
        check("More 를 한 번은 눌렀어야 한다", "{{ $input.clicks }}", "gt", "0"),
        check("More 를 누르면 더 불러와야 한다", "{{ $input.total }}", "gt", "{{ $input.firstPage }}"),
        check("예산 안에 More 가 사라져야 한다", "{{ $input.moreLeft }}", "isFalse"),
        check("More 가 사라졌으면 보유한 수만큼 다 불러왔어야 한다", "{{ $input.total }}", "eq", "{{ $input.held }}"),
      ]),
    ]),
  flow("navigator-06-owner-roundtrip", "Navigator · 탭 왕복 뒤에도 불러온 목록",
    "06-owner-listing: More로 다 불러온 뒤 Items에 갔다 Character로 돌아와도 불러온 목록에 다시 닿을 수 있다",
    [
      seed(true),
      web("open", "지갑 상세", [pause(5000), cookie()], openAt("{{ $node.seed.ownerUrl }}")),
      custom("round", "More 끝까지 → Items 갔다 Character로", [
        "const links = page.locator('a[href*=\"/navigator/character/\"]'); const more = page.getByRole('button', { name: 'More', exact: true }).first();",
        "const tab = (n) => page.getByRole('tab', { name: n, exact: true }).first();",
        "await links.first().waitFor({ state: 'attached', timeout: 20000 });",
        "let clicks = 0; while (clicks < 10 && (await more.isVisible().catch(() => false))) { await more.click(); await page.waitForTimeout(3000); clicks += 1; }",
        "// 가상 스크롤 — DOM 링크 수는 스크롤 위치 따라 줄고 는다(실측 26 → 6). 위에서 아래로 훑어 서로 다른 캐릭터 수를 센다",
        "const sweep = async () => { const seen = new Set(); await page.evaluate(() => window.scrollTo(0, 0)); for (let i = 0; i < 60; i++) { for (const h of await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) seen.add(h); await page.mouse.wheel(0, 300); await page.waitForTimeout(150); } await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500); return seen.size; };",
        "const loaded = await sweep();",
        "await tab('Items').click(); await page.waitForTimeout(3000); await tab('Character').click(); await page.waitForTimeout(3000);",
        "const backDom = await links.count();",
        "const moreAgain = await more.isVisible().catch(() => false);",
        "const back = await sweep();",
        "return { loaded, clicks, backDom, back, moreAgain, reachable: back >= loaded || moreAgain };",
      ], ["loaded", "clicks", "backDom", "back", "moreAgain", "reachable"]),
      judge([
        check("복귀한 탭이 비어 있으면 안 된다", "{{ $input.backDom }}", "gt", "0"),
        check("불러온 만큼 다시 닿을 수 있어야 한다(복귀 후 개수 ≥ 불러온 개수 또는 More)", "{{ $input.reachable }}", "isTrue"),
      ]),
    ]),
);
part.items.push(
  item("n06a", "navigator-06-owner-tab-url", "[06-owner-listing] 탭을 전환하면 주소는 유지된 채 해당 목록으로 바뀐다"),
  item("n06b", "navigator-06-owner-more", "[06-owner-listing] More 를 누르면 목록이 늘어나고 더 불러올 것이 없으면 사라진다"),
  item("n06c", "navigator-06-owner-roundtrip", "[06-owner-listing] 탭을 전환했다 돌아와도 불러온 목록에 다시 닿을 수 있다"),
);

// ── 07-character-detail ─────────────────────────────────────────────────────
const TAB_PARAM: Record<string, string> = { Info: "information", "Holding items": "holding_items", History: "history", Activity: "activity" };
const SUB = ["Skill", "Collection", "Quest", "EQUIP", "DEC.", "PET"];
const CATS = ["Weapon", "Armor", "Decoration", "Utility", "Set-up", "Consumable"];
const visReads = (labels: string[]) => labels.map((l) => read(`v${key(l)}`, tab(l)));
const visChecks = (labels: string[], ref: string, what: (l: string) => string) => labels.map((l) => check(what(l), `{{ ${ref}.v${key(l)} }}`, "eq", l));

part.flows.push(
  flow("navigator-07-character-tabs", "Navigator · 캐릭터 상세 상위 · 하위 탭",
    "07-character-detail: 캐릭터 상세에 상위 탭 4종과 Info 안의 하위 탭 · 장비 구분 탭이 있고 기본은 Info",
    [
      seed(false),
      web("open", "캐릭터 상세", [pause(6000), cookie(), ...visReads([...CHARACTER_TABS, ...SUB]), ...selReads(CHARACTER_TABS, "s")], openAt("{{ $node.seed.characterUrl }}")),
      judge([
        ...visChecks(CHARACTER_TABS, "$node.open", (l) => `상위 탭 ${l}`),
        ...visChecks(SUB.slice(0, 3), "$node.open", (l) => `Info 안의 ${l} 탭`),
        ...visChecks(SUB.slice(3), "$node.open", (l) => `장비 구분 ${l} 탭`),
        ...selIs(CHARACTER_TABS, "Info", "$node.open", "s", "기본 선택 탭"),
      ]),
    ]),
  flow("navigator-07-character-tab-url", "Navigator · 캐릭터 탭 → 주소 반영 · 다시 열기",
    "07-character-detail: 상위 탭을 차례로 누르면 ?tab=<값>이 붙고, 마지막 주소로 다시 열면 Activity가 선택돼 있다",
    [
      seed(false),
      ...CHARACTER_TABS.flatMap((l, i) => [
        web(`t${i}`, `${l} 누르기`, [...(i === 0 ? [pause(6000), cookie()] : []), click(tab(l)), pause(3000), ...selReads(CHARACTER_TABS, "s")], i === 0 ? openAt("{{ $node.seed.characterUrl }}") : undefined),
        where(`w${i}`),
      ]),
      web("reopen", "같은 주소로 다시 열기", [goto(`{{ $node.w${CHARACTER_TABS.length - 1}.url }}`), pause(6000), ...selReads(CHARACTER_TABS, "s")]),
      judge([
        ...CHARACTER_TABS.flatMap((l, i) => [
          ...selIs(CHARACTER_TABS, l, `$node.t${i}`, "s", `${l} 선택 상태`),
          check(`${l} 이 주소에 반영되어야 한다`, `{{ $node.w${i}.url }}`, "contains", `tab=${TAB_PARAM[l]}`),
        ]),
        ...selIs(CHARACTER_TABS, "Activity", "$node.reopen", "s", "주소로 다시 연 탭"),
      ]),
    ]),
  flow("navigator-07-holding-items", "Navigator · Holding items 아이템 분류",
    "07-character-detail: Holding items 탭에 아이템 분류 6종이 있고, 분류를 바꿔도 상위 탭은 Holding items로 남는다",
    [
      seed(false),
      web("open", "Holding items → Weapon", [pause(6000), cookie(), click(tab("Holding items")), pause(3000), ...visReads(CATS),
        click(tab("Weapon")), pause(3000), ...selReads(CHARACTER_TABS, "s")], openAt("{{ $node.seed.characterUrl }}")),
      judge([
        ...visChecks(CATS, "$node.open", (l) => `아이템 분류 ${l}`),
        ...selIs(CHARACTER_TABS, "Holding items", "$node.open", "s", "분류를 바꿔도 상위 탭 유지"),
      ]),
    ]),
);
part.items.push(
  item("n07a", "navigator-07-character-tabs", "[07-character-detail] 캐릭터 상세는 상위 탭과 Info 안의 하위 탭을 함께 제공한다"),
  item("n07b", "navigator-07-character-tab-url", "[07-character-detail] 상위 탭을 전환하면 주소에 반영되고 같은 주소로 다시 열 수 있다"),
  item("n07c", "navigator-07-holding-items", "[07-character-detail] Holding items 탭은 아이템 분류 탭을 제공한다"),
);

// ── 09-watchlist (visitor만) ────────────────────────────────────────────────
const watchBtn = T("지켜보기 버튼", "css", "button.btn-watch:visible");
part.flows.push(
  flow("navigator-09-watch-signin", "Navigator · 비로그인 지켜보기 → 로그인 창",
    "09-watchlist: 비로그인으로 NFT 상세의 지켜보기를 누르면 페이지를 떠나지 않고 로그인 창이 뜬다 — 툴팁 읽기(호버)는 코드로",
    [
      findNft(),
      web("nft", "NFT 상세", [pause(6000), cookie(), read("watch", watchBtn, { strategy: "attribute", attribute: "class" })], openAt("{{ $node.find.nft }}")),
      custom("tip", "지켜보기 툴팁", [
        "const btn = page.locator('button.btn-watch').first();",
        "await btn.hover({ timeout: 20000 }); await page.waitForTimeout(1200);",
        "return { tooltip: ((await page.locator('[role=\"tooltip\"]').first().innerText().catch(() => '')) || '').trim() };",
      ], ["tooltip"]),
      web("press", "지켜보기 누르기", [click(watchBtn), pause(4000), read("modal", T("로그인 창", "css", ".w3a-modal-container:visible"), { strategy: "attribute", attribute: "class" })]),
      where(),
      judge([
        check("지켜보기 버튼은 비로그인에도 보인다", "{{ $node.nft.watch }}", "contains", "btn-watch"),
        check("비로그인은 등록되지 않은 상태여야 한다(툴팁 Add to Watchlist)", "{{ $node.tip.tooltip }}", "eq", "Add to Watchlist"),
        check("로그인 창이 떠야 한다", "{{ $node.press.modal }}", "notEmpty"),
        check("로그인 창은 페이지를 떠나지 않고 떠야 한다", "{{ $input.url }}", "contains", "{{ $node.find.nft }}"),
      ]),
    ]),
);
part.items.push(
  item("n09a", "navigator-09-watch-signin", "[09-watchlist] 비로그인 상태에서 지켜보기를 누르면 로그인 창이 뜬다"),
);

part.notes.push(
  "04 · 06 · 07: 원본은 캐릭터를 랜딩 Character Rankings에서 먼저 찾지만 QA는 비어 있어 아이템 랭킹 → 소유자 → Character 목록 길만 옮김(커스텀 노드 «찾기»). 랭킹이 다시 차도 이 길로 찾는다",
  "06-owner-listing: 원본은 캐릭터를 거쳐 2페이지 이상 지갑을 찾는다 — 여기선 아이템 랭킹 소유자 중 More가 보이는 지갑. 응답 건수 세기 · More 반복 · 링크 세기는 코드로",
  "06-owner-listing «More …»: 원본은 More가 남으면 «아직 덜 불러옴»도 허용하지만, 예산(보유/첫 응답+3회) 안에 사라져야 한다로 좁힘",
  "06-owner-listing «탭을 전환했다 …»: 원본은 DOM 링크 수를 견주지만 가상 스크롤이라 스크롤 위치에 따라 줄어(실측 불러온 뒤 26 · 복귀 뒤 12, 훑으면 둘 다 38) 위에서 아래로 훑은 서로 다른 캐릭터 수로 견줌. «≥ 또는 More»는 검사 노드에 «또는»이 없어 코드가 낸 참/거짓을 본다",
  "05-not-found: /api/navigator/ 응답 500 이상 감시(NFT · 지갑 주소는 실패, 캐릭터는 NAV-1 기록)는 빠짐 — 네트워크 응답을 보는 기능이 없다. 404 · 빈 상세 기록(recordDetail)도 판정이 아니라 빠짐",
  "05-not-found: 404는 원본처럼 30초까지 기다리지 않고 8초 뒤 2초 동안 찾는다",
  "09-watchlist: member 시나리오 2개(등록 · 해제)는 로그인 지갑이 필요해 이 Suite(visitor)에서 빠짐. 툴팁(호버)은 코드로",
);
