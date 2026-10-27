/** Navigator — 10-ranking · 11-activity-history · 12-nickname-detail · 13-links-and-a11y · 14-responsive (원본 tests/navigator/). navigator.ts가 합친다 */
import { NAV, T, check, click, cookie, custom, fill, flow, goto, item, judge, noLeak, openAt, pause, press, read, waitUrl, web, where, type Part } from "./lib.ts";

const part: Part = { flows: [], items: [], notes: [] };
export default part;

type Json = any;

// ── 공통 ────────────────────────────────────────────────────────────────────
/** 랭킹의 첫 아이템 링크 — 원본 rankedNftId()(문서 순서 첫 /navigator/nft/ 링크) */
const firstNft = T("랭킹 첫 아이템 링크", "xpath", '(//a[contains(@href,"/navigator/nft/")])[1]');
/** 랜딩을 열고 랭킹 첫 아이템의 절대 주소를 읽는다 — 없으면 멈춘다(원본도 던진다) */
const landing = (nodeId = "landing") =>
  web(nodeId, "랜딩 · 랭킹 첫 아이템", [pause(5000), cookie(), read("nft", firstNft, { optional: false, strategy: "link" })], openAt(NAV));
const notFound = (output = "notFound") => read(output, T("«Page Not Found»", "xpath", '(//*[normalize-space(text())="Page Not Found"])[1]'));
const periodBtn = (p: string) => T(`기간 «${p}»`, "xpath", `//button[@role="option" and normalize-space(.)="${p}"]`);
const chip = (c: string) => T(`거래 종류 «${c}»`, "xpath", `//div[contains(concat(" ",normalize-space(@class)," ")," chip ") and normalize-space(.)="${c}"]`);
/** 칩이 골라졌나 — 해시 없는 «selected» 클래스(원본 isActivityTypeSelected) */
const SELECTED = "(^|\\s)selected(\\s|$)";

/** 표 읽기 — lib.ts에 없어 여기서 짓는다 */
let tseq = 0;
const table = (output: string, label: string, rows: string, columns: [string, string][], timeoutMs = 20000): Json => ({
  id: `t${++tseq}`, kind: "readTable", risk: "safe", timeoutMs, optional: false, output,
  table: { label, rows: T(`${label} 행`, "css", rows), columns: columns.map(([name, selector]) => ({ name, selector, strategy: "innerText" })), maxRows: 200 },
});
/** 표 머리 — 원본 tableHeaders(). 첫 칸 · 사이 칸은 비어 있어 넉넉히 8칸 */
const heads = (output = "heads") => table(output, "표 머리", "thead tr", Array.from({ length: 8 }, (_, i) => [`c${i + 1}`, `th:nth-child(${i + 1})`] as [string, string]));
/** 거래 표의 행마다 첫 칸(Mint · Sale · Transfer) — 원본 activityRowTypes() */
const types = (output: string) => table(output, "거래 표", "tbody tr", [["type", "td:nth-child(1)"]]);
const hasColumns = (ref: string, cols: string[]) => cols.map((c) => check(`${c} 열이 있어야 한다`, ref, "anyEq", c));

// ── 10-ranking ─────────────────────────────────────────────────────────────
/** 기간을 누르고 그사이 나간 /ranking/ 요청을 모은다 — 요청 엿보기는 동작에 없어 코드로 */
const periodSwitch = (nodeId: string, p: string, dur: string) =>
  custom(nodeId, `${p} 누르고 조회 보기`, [
    "const asked = []; const on = (r) => { const u = new URL(r.url()); if (u.pathname.includes('/ranking/')) asked.push(u.search); };",
    "page.on('request', on);",
    `await page.locator('button[role=option]').filter({ hasText: /^${p}$/ }).first().click();`,
    "await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(3500); page.off('request', on);",
    `const hit = (t) => asked.some((s) => s.includes('type=' + t) && s.includes('duration=${dur}'));`,
    "return { asked: asked.join(' | ') || '요청 없음', equipment: hit('equipment'), decoration: hit('decoration') };",
  ], ["asked", "equipment", "decoration"]);
const firstRanked = T("랭킹 첫 항목", "xpath", '(//a[contains(@href,"/navigator/nft/") or contains(@href,"/navigator/character/")])[1]');
const afterPeriod = (nodeId: string, p: string) =>
  web(nodeId, `${p} 상태 읽기`, [read("selected", periodBtn(p), { strategy: "attribute", attribute: "aria-selected" }), read("ranked", firstRanked, { strategy: "link" })]);
const periodChecks = (p: string, dur: string, sw: string, after: string) => [
  check(`${p}: equipment 보드를 duration=${dur} 로 조회해야 한다`, `{{ $node.${sw}.equipment }}`, "isTrue"),
  check(`${p}: decoration 보드를 duration=${dur} 로 조회해야 한다`, `{{ $node.${sw}.decoration }}`, "isTrue"),
  check(`${p} 선택 상태`, `{{ $node.${after}.selected }}`, "eq", "true"),
  check(`${p}: 랭킹이 비면 안 된다`, `{{ $node.${after}.ranked }}`, "notEmpty"),
];

part.flows.push(
  flow("navigator-10-period-refetch", "Navigator · 기간을 바꾸면 그 기간으로 다시 조회",
    "10-ranking: 30Days · All 을 누를 때마다 equipment · decoration 보드를 그 기간(duration=30 · -1)으로 다시 묻고, 선택이 옮겨가고, 랭킹이 비지 않는다",
    [
      web("open", "Navigator 열기", [pause(2500), cookie(), pause(1000)], openAt(NAV)),
      periodSwitch("sw30", "30Days", "30"), afterPeriod("st30", "30Days"),
      periodSwitch("swAll", "All", "-1"), afterPeriod("stAll", "All"),
      judge([...periodChecks("30Days", "30", "sw30", "st30"), ...periodChecks("All", "-1", "swAll", "stAll")]),
    ]),
  flow("navigator-10-boards-link", "Navigator · 랭킹 보드 노출 · 항목이 상세로",
    "10-ranking: 두 보드가 보이고, 캐릭터 랭킹은 서버가 준 것과 화면이 맞고, 랭킹 아이템 · 캐릭터가 열린다(비면 View All)",
    [
      web("open", "Navigator 열기", [pause(1000)], openAt(NAV)),
      custom("served", "캐릭터 랭킹 — 서버 vs 화면", [
        "const resp = page.waitForResponse((r) => /\\/api\\/navigator\\/ranking\\/character/.test(r.url()), { timeout: 30000 });",
        "await page.reload({ waitUntil: 'domcontentloaded' });",
        "const served = ((await (await resp).json()).ranking ?? []).length;",
        "await page.getByText('Character Rankings').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});",
        "await page.waitForTimeout(3000);",
        "const shown = await page.locator('a[href*=\"/navigator/character/\"]').count();",
        // 원본의 갈래 — 항목이 있으면 첫 캐릭터가 열려야, 없으면 View All 이 있어야
        "let characterNotFound = false, emptyWithoutViewAll = false;",
        "if (served > 0) {",
        "  const href = await page.locator('a[href*=\"/navigator/character/\"]').first().getAttribute('href');",
        "  const p = await page.context().newPage();",
        "  try { await p.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded' });",
        "    characterNotFound = await p.locator('text=Page Not Found').first().isVisible({ timeout: 10000 }).catch(() => false); } finally { await p.close(); }",
        "} else {",
        "  emptyWithoutViewAll = !(await page.locator('a[href*=\"/gamestatus/ranking\"], a:has(button:has-text(\"View All\"))').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false));",
        "}",
        "return { served, shown, agree: (shown > 0) === (served > 0), characterNotFound, emptyWithoutViewAll };",
      ], ["served", "shown", "agree", "characterNotFound", "emptyWithoutViewAll"]),
      web("boards", "보드 · 첫 아이템", [cookie(),
        read("highest", T("«Highest Price» 보드", "xpath", '(//*[contains(normalize-space(text()),"Highest Price")])[1]')),
        read("characters", T("«Character Rankings» 보드", "xpath", '(//*[contains(normalize-space(text()),"Character Rankings")])[1]')),
        read("nft", firstNft, { optional: false, strategy: "link" })]),
      web("item", "랭킹 아이템 열기", [pause(5000), notFound()], openAt("{{ $input.nft }}")),
      judge([
        check("Highest Price 보드가 있어야 한다", "{{ $node.boards.highest }}", "notEmpty"),
        check("Character Rankings 보드가 있어야 한다", "{{ $node.boards.characters }}", "notEmpty"),
        check("서버가 준 캐릭터 랭킹과 화면 항목이 맞아야 한다(있음/없음)", "{{ $node.served.agree }}", "isTrue"),
        check("랭킹의 아이템이 열려야 한다", "{{ $node.item.notFound }}", "empty"),
        check("(랭킹이 있으면) 랭킹의 캐릭터가 열려야 한다 — 404면 true", "{{ $node.served.characterNotFound }}", "isFalse"),
        check("(랭킹이 비면) View All 로 나갈 수 있어야 한다 — 없으면 true", "{{ $node.served.emptyWithoutViewAll }}", "isFalse"),
      ]),
    ]),
);
part.items.push(
  item("n10a", "navigator-10-period-refetch", "[10-ranking] 기간을 바꾸면 그 기간으로 다시 조회한다"),
  item("n10b", "navigator-10-boards-link", "[10-ranking] 랭킹 보드가 노출되고 각 항목이 상세로 연결된다"),
);
part.notes.push(
  "10-ranking: 요청 엿보기(page.on('request')) · 응답 본문(waitForResponse) · 링크 수 세기는 동작에 없어 커스텀 노드로. 기간 누르기도 엿보기와 한 몸이라 코드 안에서",
  "10-ranking «랭킹 보드가 노출되고…»: 서버 응답을 잡으려고 랜딩을 한 번 더 불러온다(reload). 원본의 갈래(랭킹 있음 → 캐릭터 열기 · 없음 → View All)는 코드가 «해당 갈래가 어긋났나»를 true/false로 내고 검사가 본다 — QA는 캐릭터 랭킹이 비어 View All 쪽만 탄다",
);

// ── 11-activity-history ─────────────────────────────────────────────────────
const activity = (nodeId: string, name: string, actions: Json[]) =>
  web(nodeId, name, [pause(5000), cookie(), ...actions], openAt("{{ $node.landing.nft }}?tab=activity"));

part.flows.push(
  flow("navigator-11-activity-table", "Navigator · Activity 탭 거래 표",
    "11-activity-history: 랭킹 아이템의 Activity 탭에 Price · From · To · Date 열의 거래 표가 있고, 거래 종류는 아는 것만",
    [
      landing(),
      activity("act", "Activity 탭", [heads(), types("rows")]),
      custom("kinds", "모르는 거래 종류", [
        "const known = ['All', 'Mint', 'Sale', 'Transfer'];",
        "const t = input.rows.map((r) => r.type ?? '');",
        "return { types: t.join(', '), unknown: t.filter((x) => !known.includes(x)).join(', ') };",
      ], ["types", "unknown"], false),
      judge([
        check("거래 표가 있어야 한다", "{{ $node.act.rows }}", "countGte", "1"),
        ...hasColumns("{{ $node.act.heads }}", ["Price", "From", "To", "Date"]),
        check("랭킹에 오른 아이템에 거래 내역이 있어야 한다", "{{ $node.act.rows }}", "countGte", "1"),
        check("알 수 없는 거래 종류가 없어야 한다", "{{ $node.kinds.unknown }}", "empty"),
      ]),
    ]),
  flow("navigator-11-activity-filter", "Navigator · 거래 종류 필터 — 그 종류만 · 주소 반영",
    "11-activity-history: Mint 를 고르면 Mint 만 남고 activityType=mint 가 주소에, Sale 을 더하면 mint%2Csales 로 넓어지고 Mint 는 남는다",
    [
      landing(),
      activity("mint", "Mint 고르기", [click(chip("Mint")), pause(3500),
        read("cls", chip("Mint"), { strategy: "attribute", attribute: "class" }), types("rows")]),
      custom("afterMint", "주소 · Mint만?", [
        "const t = input.rows.map((r) => r.type ?? '');",
        "return { url: page.url(), distinct: [...new Set(t)].join(','), count: t.length };",
      ], ["url", "distinct", "count"]),
      web("sale", "Sale 더하기", [click(chip("Sale")), pause(3500), types("rows")]),
      custom("afterSale", "주소", "return { url: page.url() };", ["url"]),
      judge([
        check("Mint 가 선택 상태여야 한다", "{{ $node.mint.cls }}", "matches", SELECTED),
        check("Mint 가 주소에 반영되어야 한다", "{{ $node.afterMint.url }}", "contains", "activityType=mint"),
        check("Mint 내역이 있어야 한다", "{{ $node.mint.rows }}", "countGte", "1"),
        check("Mint 만 남아야 한다", "{{ $node.afterMint.distinct }}", "eq", "Mint"),
        check("두 종류가 함께 주소에 담겨야 한다", "{{ $node.afterSale.url }}", "contains", "activityType=mint%2Csales"),
        check("고른 종류를 더하면 내역이 줄면 안 된다", "{{ $node.sale.rows }}", "countGte", "{{ $node.afterMint.count }}"),
        check("Mint 내역은 그대로 남아야 한다", "{{ $node.sale.rows }}", "anyEq", "Mint"),
      ]),
    ]),
  flow("navigator-11-filter-link", "Navigator · 필터 걸린 주소를 그대로 열기",
    "11-activity-history: Mint 필터가 걸린 주소를 새로 열어도 Mint 가 선택되고 같은 결과가 나온다",
    [
      landing(),
      activity("mint", "Mint 고르기", [click(chip("Mint")), pause(3500), types("rows")]),
      custom("linked", "걸린 주소", "return { link: page.url(), expected: input.rows.map((r) => r.type ?? '').join(',') };", ["link", "expected"]),
      web("reopen", "그 주소 새로 열기", [pause(5000), cookie(),
        read("cls", chip("Mint"), { strategy: "attribute", attribute: "class" }), types("rows")], openAt("{{ $input.link }}")),
      custom("again", "다시 연 결과", "return { actual: input.rows.map((r) => r.type ?? '').join(',') };", ["actual"], false),
      judge([
        check("링크로 열어도 Mint 가 선택되어야 한다", "{{ $node.reopen.cls }}", "matches", SELECTED),
        check("링크로 열어도 같은 결과여야 한다", "{{ $node.again.actual }}", "eq", "{{ $node.linked.expected }}"),
      ]),
    ]),
  flow("navigator-11-history-table", "Navigator · History 탭 아이템 이력",
    "11-activity-history: 랭킹 아이템(최대 5개)을 차례로 History 탭으로 열어 이력이 있는 것을 찾고 — 있으면 Item History · Character · Date 열, 없으면 «No history to display.»",
    [
      web("landing", "랜딩", [pause(5000), cookie(), read("nft", firstNft, { optional: false, strategy: "link" })], openAt(NAV)),
      custom("find", "이력 있는 아이템 찾기", [
        "const hrefs = await page.locator('a[href*=\"/navigator/nft/\"]').evaluateAll((els) => els.map((a) => a.href));",
        "const ids = [...new Set(hrefs)].slice(0, 5); const tabs = []; let withHistory = '';",
        "for (const h of ids) {",
        "  const u = new URL(h); u.searchParams.set('tab', 'history');",
        "  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(3000);",
        "  tabs.push((await page.getByRole('tab', { name: 'History', exact: true }).first().getAttribute('aria-selected').catch(() => null)) === 'true' ? 'History' : 'X');",
        "  if ((await page.locator('tbody tr').count()) > 0) { withHistory = h; break; }",
        "}",
        "const seen = (l) => l.first().waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);",
        "const headers = withHistory ? await page.evaluate(() => Array.from(document.querySelectorAll('thead th, thead td, table tr:first-child th')).map((c) => c.innerText.trim()).filter(Boolean)) : [];",
        "const titleShown = withHistory ? await seen(page.getByText('Item History')) : false;",
        "const noticeShown = withHistory ? false : await seen(page.getByText(/No history to display/i));",
        "return { checked: ids.length, tabs: tabs.join(','), withHistory: withHistory || '없음',",
        "  noTitle: !!withHistory && !titleShown, noCharacter: !!withHistory && !headers.includes('Character'), noDate: !!withHistory && !headers.includes('Date'),",
        "  silentEmpty: !withHistory && !noticeShown };",
      ], ["checked", "tabs", "withHistory", "noTitle", "noCharacter", "noDate", "silentEmpty"]),
      judge([
        check("선택 탭은 History", "{{ $input.tabs }}", "matches", "^History(,History)*$"),
        check("(이력이 있으면) 아이템 이력 제목 — 없으면 true", "{{ $input.noTitle }}", "isFalse"),
        check("(이력이 있으면) Character 열이 있어야 한다 — 없으면 true", "{{ $input.noCharacter }}", "isFalse"),
        check("(이력이 있으면) Date 열이 있어야 한다 — 없으면 true", "{{ $input.noDate }}", "isFalse"),
        check("(이력이 없으면) 없다고 말해야 한다 — 빈 칸이면 true", "{{ $input.silentEmpty }}", "isFalse"),
      ]),
    ]),
);
part.items.push(
  item("n11a", "navigator-11-activity-table", "[11-activity-history] Activity 탭에 거래 내역이 표로 나온다"),
  item("n11b", "navigator-11-activity-filter", "[11-activity-history] 거래 종류를 고르면 그 종류만 남고 주소에 반영된다"),
  item("n11c", "navigator-11-filter-link", "[11-activity-history] 필터가 걸린 주소를 그대로 열면 같은 결과가 나온다"),
  item("n11d", "navigator-11-history-table", "[11-activity-history] History 탭에 아이템 이력이 표로 나온다"),
);
part.notes.push(
  "11-activity-history: 열 · 거래 종류는 표 읽기로. «모두 아는 종류» · «Mint만» · 결과 견주기는 연산이 없어 커스텀 노드가 목록을 글자로 접는다. 지금 주소도 코드로",
  "11-activity-history «거래 종류를 고르면…»: QA에서 «Mint 내역은 그대로 남아야 한다»가 불통과 — Mint+Sale 표 첫 쪽 30행이 모두 Sale이고 Mint는 More 뒤 쪽에 있다. 원본도 첫 쪽만 보므로 똑같이 깨진다(제품 결함보다 원본 가정 문제로 보임) — 검사는 그대로 둔다",
  "11-activity-history «History 탭…»: 후보 5개를 차례로 여는 반복 · 갈래는 코드로. 갈래 검사는 «해당 갈래가 어긋났나»를 true/false로 낸다 — QA 랭킹 아이템은 모두 이력이 없어 «No history» 쪽만 탄다",
);

// ── 12-nickname-detail ──────────────────────────────────────────────────────
/** 지갑의 Nicknames 탭 → 첫 닉네임 링크 — 원본은 랭킹 캐릭터의 보유 지갑을 훑는다. 여기서는 지갑을 Suite 입력으로 */
const nicknameTab = () =>
  web("owner", "지갑 → Nicknames 탭", [pause(5000), cookie(),
    click(T("«Nicknames» 탭", "role", "tab", "Nicknames")), pause(3500),
    read("href", T("첫 닉네임 링크", "xpath", '(//a[contains(@href,"/navigator/nickname/")])[1]'), { optional: false, strategy: "link" })],
  openAt(`${NAV}/owner/{{ $params.owner }}`));
const ownerParam = [{ name: "owner", label: "닉네임을 가진 지갑", default: "0x18B8958F05263D89281f1bdd97AFfc5879394292", help: "QA — 캐릭터 43개 · 닉네임 evaans" }];
const OWNER = { owner: "0x18B8958F05263D89281f1bdd97AFfc5879394292" };

part.flows.push(
  flow("navigator-12-nickname-from-wallet", "Navigator · 지갑 Nicknames 탭 → 닉네임 상세",
    "12-nickname-detail: 지갑의 Nicknames 탭에서 닉네임을 누르면 /navigator/nickname/<이름> 으로 가고, 404가 아니며 이름이 화면에 있다",
    [
      nicknameTab(),
      web("go", "닉네임 누르기", [click(T("첫 닉네임 링크", "xpath", '(//a[contains(@href,"/navigator/nickname/")])[1]')),
        waitUrl("/navigator/nickname/", 20000), pause(4000), notFound()]),
      custom("here", "닉네임 · 주소 · 본문", [
        "const url = decodeURIComponent(page.url()).split('?')[0];",
        "const name = url.split('/navigator/nickname/')[1] ?? '';",
        "const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();",
        "return { url, name, bodyHasName: !!name && body.includes(name.toLowerCase()) };",
      ], ["url", "name", "bodyHasName"]),
      judge([
        check("누른 닉네임의 상세로 간다", "{{ $node.owner.href }}", "endsWith", "/navigator/nickname/{{ $input.name }}"),
        check("닉네임 상세가 열려야 한다", "{{ $node.go.notFound }}", "empty"),
        check("닉네임이 화면에 있어야 한다", "{{ $input.bodyHasName }}", "isTrue"),
      ]),
    ], ownerParam),
  flow("navigator-12-nickname-activity", "Navigator · 닉네임 상세 발행 · 거래 내역",
    "12-nickname-detail: 닉네임 상세에 Price · From · To · Date 열의 표가 있고 Mint 기록이 있다",
    [
      nicknameTab(),
      web("detail", "닉네임 상세 열기", [pause(5000), cookie(), notFound(), heads(), types("rows")], openAt("{{ $input.href }}")),
      judge([
        check("닉네임 상세가 열려야 한다", "{{ $input.notFound }}", "empty"),
        ...hasColumns("{{ $input.heads }}", ["Price", "From", "To", "Date"]),
        check("발행 내역이라도 있어야 한다", "{{ $input.rows }}", "countGte", "1"),
        check("Mint 기록이 있어야 한다", "{{ $input.rows }}", "anyEq", "Mint"),
      ]),
    ], ownerParam),
  flow("navigator-12-nickname-404", "Navigator · 없는 닉네임은 404",
    "12-nickname-detail: 존재하지 않는 닉네임은 Page Not Found 이고 내부 정보를 흘리지 않는다",
    [
      web("open", "없는 닉네임 열기", [pause(6000), notFound(), read("body", T("본문 전체", "css", "body"))], openAt(`${NAV}/nickname/zzqq-not-a-nickname-zzqq`)),
      judge([check("404 여야 한다", "{{ $input.notFound }}", "notEmpty"), ...noLeak("{{ $input.body }}")]),
    ]),
);
part.items.push(
  item("n12a", "navigator-12-nickname-from-wallet", "[12-nickname-detail] 지갑의 Nicknames 탭에서 닉네임 상세로 들어갈 수 있다", OWNER),
  item("n12b", "navigator-12-nickname-activity", "[12-nickname-detail] 닉네임 상세에 발행 · 거래 내역이 나온다", OWNER),
  item("n12c", "navigator-12-nickname-404", "[12-nickname-detail] 존재하지 않는 닉네임은 404 로 처리된다"),
);
part.notes.push(
  "12-nickname-detail: 원본은 랭킹 캐릭터 → 보유 지갑을 훑어 닉네임 가진 지갑을 찾는다 — QA 캐릭터 랭킹이 비어 지갑을 Suite 입력으로 고정(0x18B8…4292). 닉네임은 그 지갑 Nicknames 탭의 첫 링크에서 읽는다",
);

// ── 13-links-and-a11y ───────────────────────────────────────────────────────
const noAlt = (nodeId: string, where: string) =>
  custom(nodeId, `${where} alt 누락`, [
    "await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});",
    "const missing = await page.evaluate(() => Array.from(document.querySelectorAll('img')).filter((i) => !!i.offsetParent).filter((i) => i.getAttribute('alt') === null).map((i) => (i.getAttribute('src') || '').split('?')[0].slice(-50)));",
    "return { missing: missing.join(', ') };",
  ], ["missing"]);

part.flows.push(
  flow("navigator-13-footer-links", "Navigator · 헤더 · 푸터 외부 링크는 새 창 · noopener",
    "13-links-and-a11y: 헤더 · 푸터의 외부(http) 링크가 있고, 모두 target=_blank 이며 rel 에 noopener 가 있다",
    [
      web("open", "Navigator 열기", [pause(5000), cookie()], openAt(NAV)),
      custom("links", "헤더 · 푸터 링크", [
        "const links = await page.locator('header a, footer a').evaluateAll((els) => els.map((e) => ({ text: (e.innerText || '').trim().replace(/\\s+/g, ' '), href: e.getAttribute('href') || '', target: e.getAttribute('target') || '', rel: e.getAttribute('rel') || '' })));",
        "const ext = links.filter((l) => /^https?:\\/\\//.test(l.href)); const show = (l) => (l.text || '(무텍스트)') + ' → ' + l.href;",
        "return { external: ext.length, sameTab: ext.filter((l) => l.target !== '_blank').map(show).join(', '), missingRel: ext.filter((l) => !l.rel.includes('noopener')).map(show).join(', ') };",
      ], ["external", "sameTab", "missingRel"]),
      judge([
        check("외부 링크가 있어야 한다", "{{ $input.external }}", "gt", "0"),
        check("외부 링크는 새 창으로 열려야 한다", "{{ $input.sameTab }}", "empty"),
        check("target=\"_blank\" 링크에는 rel=\"noopener\" 가 있어야 한다", "{{ $input.missingRel }}", "empty"),
      ]),
    ]),
  flow("navigator-13-marketplace-handoff", "Navigator · 아이템 상세 → 마켓플레이스의 같은 아이템",
    "13-links-and-a11y: 아이템 상세의 Marketplace 링크가 /marketplace/nft/<토큰> 을 새 창으로 가리키고, 따라가면 같은 이름의 아이템이다",
    [
      landing(),
      web("detail", "아이템 상세", [pause(5000), cookie(),
        read("href", T("마켓플레이스 링크", "css", 'a[href*="/marketplace/"]'), { optional: false, strategy: "attribute", attribute: "href" }),
        read("target", T("마켓플레이스 링크", "css", 'a[href*="/marketplace/"]'), { strategy: "attribute", attribute: "target" })], openAt("{{ $input.nft }}")),
      custom("name", "아이템 이름(문서 제목 앞)", "const title = await page.title(); return { name: title.split('|')[0].trim(), title };", ["name", "title"]),
      web("follow", "링크 따라가기", [
        { ...click(T("마켓플레이스 링크", "css", 'a[href*="/marketplace/"]')), popup: true, timeoutMs: 45000 },
        waitUrl("/marketplace/nft/", 45000), pause(5000)]),
      where("arrived"),
      judge([
        check("마켓플레이스의 아이템 페이지를 가리켜야 한다", "{{ $node.detail.href }}", "matches", "/marketplace/nft/\\d+"),
        check("새 창으로 열려야 한다", "{{ $node.detail.target }}", "eq", "_blank"),
        check("새 창이 그 토큰의 페이지에 도착한다", "{{ $input.url }}", "startsWith", "{{ $node.detail.href }}"),
        check("마켓플레이스에도 같은 아이템이어야 한다", "{{ $input.title }}", "contains", "{{ $node.name.name }}"),
      ]),
    ]),
  flow("navigator-13-img-alt", "Navigator · 보이는 이미지의 alt 속성",
    "13-links-and-a11y: 랜딩 · 아이템 상세 · 캐릭터 상세에서 보이는 이미지에 alt 속성이 빠진 것이 없다(alt=\"\"는 지정으로 본다)",
    [
      landing(),
      noAlt("altLanding", "랜딩"),
      web("nft", "아이템 상세", [pause(5000), cookie()], openAt("{{ $node.landing.nft }}")),
      noAlt("altNft", "아이템 상세"),
      web("character", "캐릭터 상세", [pause(5000), cookie()], openAt(`${NAV}/character/{{ $params.character }}`)),
      noAlt("altCharacter", "캐릭터 상세"),
      judge([
        check("랜딩: alt 속성이 없는 이미지가 있으면 안 된다", "{{ $node.altLanding.missing }}", "empty"),
        check("아이템 상세: alt 속성이 없는 이미지가 있으면 안 된다", "{{ $node.altNft.missing }}", "empty"),
        check("캐릭터 상세: alt 속성이 없는 이미지가 있으면 안 된다", "{{ $node.altCharacter.missing }}", "empty"),
      ]),
    ],
    [{ name: "character", label: "캐릭터 id", default: "CHARd0311l7p0t3s73a6tds0", help: "QA — blahh" }]),
);
part.items.push(
  item("n13a", "navigator-13-footer-links", "[13-links-and-a11y] 푸터의 외부 링크는 새 창으로, 보안 속성과 함께 열린다"),
  item("n13b", "navigator-13-marketplace-handoff", "[13-links-and-a11y] 아이템 상세에서 마켓플레이스의 같은 아이템으로 이어진다"),
  item("n13c", "navigator-13-img-alt", "[13-links-and-a11y] 화면에 보이는 이미지에는 대체 텍스트가 지정되어 있다", { character: "CHARd0311l7p0t3s73a6tds0" }),
);
part.notes.push(
  "13-links-and-a11y: 링크 목록 · 이미지 alt 훑기는 여러 요소를 세는 일이라 커스텀 노드로(원본도 evaluate). axe-core는 원본도 쓰지 않는다",
  "13-links-and-a11y «화면에 보이는 이미지…»: 원본은 캐릭터를 랭킹(비면 아이템 소유자)에서 고른다 — QA 캐릭터 랭킹이 비어 Suite 입력으로 고정(CHARd0311…, blahh)",
  "13-links-and-a11y «마켓플레이스…»: 마켓플레이스 점검 화면 감지(assertServiceAvailable)는 빠짐",
);

// ── 14-responsive ───────────────────────────────────────────────────────────
/** 화면 크기 바꾸고 다시 불러오기 — 크기는 동작에 없어 코드로 */
const viewport = () =>
  custom("viewport", "화면 크기", [
    "await page.setViewportSize({ width: Number(ctx.params.width), height: Number(ctx.params.height) });",
    "await page.reload({ waitUntil: 'domcontentloaded' });",
    "return { size: page.viewportSize() };",
  ], ["size"]);
/** 보이는 검색 칸 — 데스크톱은 헤더 · 본문 둘 다, 좁으면 본문 것만 보인다. 원본 searchInput(보이는 것 중 첫째) */
const visibleSearch = T("보이는 검색 칸", "css", ':nth-match(input[placeholder*="Item/Character Name" i]:visible, 1)');
const sizeParams = [{ name: "width", label: "가로(px)", default: "1440" }, { name: "height", label: "세로(px)", default: "900" }];

part.flows.push(
  flow("navigator-14-viewport", "Navigator · 화면 폭별 — 가로 스크롤 없이 검색 · 랭킹",
    "14-responsive: 주어진 화면 크기에서 검색 칸이 보이고 랭킹이 비지 않고 가로 스크롤이 생기지 않는다",
    [
      web("open", "Navigator 열기", [pause(1000)], openAt(NAV)),
      viewport(),
      web("look", "검색 · 랭킹", [pause(5000), cookie(),
        read("search", visibleSearch, { strategy: "attribute", attribute: "placeholder" }),
        read("ranked", firstRanked, { strategy: "link" })]),
      custom("overflow", "가로 넘침", [
        "const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);",
        "return { scrollWidth, innerWidth, overflow: scrollWidth - innerWidth > 2 };",
      ], ["scrollWidth", "innerWidth", "overflow"]),
      judge([
        check("검색창이 있어야 한다", "{{ $node.look.search }}", "notEmpty"),
        check("랭킹이 비면 안 된다", "{{ $node.look.ranked }}", "notEmpty"),
        check("가로 스크롤이 생기면 안 된다", "{{ $input.overflow }}", "isFalse"),
      ]),
    ], sizeParams),
  flow("navigator-14-mobile-search", "Navigator · 모바일 검색 → 상세",
    "14-responsive: 390×844 에서도 보이는 검색 칸으로 검색해 상세에 도달하고 404가 아니다 — 검색어는 실행 입력",
    [
      web("open", "Navigator 열기", [pause(1000)], openAt(NAV)),
      viewport(),
      web("search", "검색", [pause(5000), cookie(), fill(visibleSearch, "{{ $params.name }}"), press(visibleSearch, "Enter"),
        waitUrl("/navigator/(nickname|character|nft|owner)/"), pause(3000), notFound()]),
      where(),
      judge([
        check("검색으로 상세 페이지에 도달해야 한다", "{{ $input.url }}", "matches", "/navigator/(character|nft|nickname|owner)/"),
        check("검색 결과가 404 면 안 된다", "{{ $node.search.notFound }}", "empty"),
      ]),
    ],
    [...sizeParams.map((p) => ({ ...p, default: p.name === "width" ? "390" : "844" })), { name: "name", label: "검색할 캐릭터 이름", default: "blahh" }]),
);
part.items.push(
  item("n14a", "navigator-14-viewport", "[14-responsive] 데스크톱 1920 에서 가로 스크롤 없이 검색과 랭킹이 노출된다", { width: "1920", height: "1080" }),
  item("n14b", "navigator-14-viewport", "[14-responsive] 데스크톱 1440 에서 가로 스크롤 없이 검색과 랭킹이 노출된다", { width: "1440", height: "900" }),
  item("n14c", "navigator-14-viewport", "[14-responsive] 태블릿 768 에서 가로 스크롤 없이 검색과 랭킹이 노출된다", { width: "768", height: "1024" }),
  item("n14d", "navigator-14-viewport", "[14-responsive] 모바일 390 에서 가로 스크롤 없이 검색과 랭킹이 노출된다", { width: "390", height: "844" }),
  item("n14e", "navigator-14-mobile-search", "[14-responsive] 모바일에서도 검색으로 상세에 도달한다", { width: "390", height: "844", name: "blahh" }),
);
part.notes.push(
  "14-responsive: 화면 크기 바꾸기 · 가로 넘침은 동작에 없어 커스텀 노드로 — 원본은 처음부터 그 크기의 창을 열지만 여기서는 열고 나서 크기를 바꾸고 다시 불러온다",
  "14-responsive «모바일에서도 검색…»: 원본은 검색어(캐릭터 이름)를 화면에서 고른다 — QA 캐릭터 랭킹이 비어 Suite 입력으로 고정(blahh). 원본의 Enter 재시도 1회는 없음",
);
