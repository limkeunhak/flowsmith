/** MSU 웹 — 02-navigation-links · 03-responsive · 04-notices · 09-accessibility (원본 tests/msuweb/). msuweb.ts가 합친다 */
import { WEB, T, check, click, cookie, custom, fill, flow, goto, item, judge, noLeak, openAt, pause, press, read, waitUrl, web, type Part } from "./lib.ts";

const part: Part = { flows: [], items: [], notes: [] };
export default part;

/** GNB 항목 — 원본 navLink: header 안 a[data-link="gnb-link"] 중 글자가 든 첫째 */
const navLink = (text: string) => T(`GNB «${text}»`, "xpath", `(//header//a[@data-link="gnb-link"][contains(normalize-space(.),"${text}")])[1]`);
/** 푸터 링크 — 원본 footerLink: footer 안 a 중 글자가 든 첫째(대소문자는 CSS라 DOM 글자로 찾는다) */
const footerLink = (text: string) => T(`푸터 «${text}»`, "xpath", `(//footer//a[contains(normalize-space(.),"${text}")])[1]`);
const href = (output: string, target: any) => read(output, target, { strategy: "attribute", attribute: "href" });
/** 헤더 · 푸터가 «보인다» — 있을 때만(보일 때만) 읽고 textContent로. 모바일 헤더는 innerText가 비어 있다(아이콘뿐) */
const shown = (output: string, css: string) => read(output, T(css, "css", css), { strategy: "text" });
/** 지금 경로 */
const pathOf = (nodeId: string) => custom(nodeId, "지금 경로", "return { path: new URL(page.url()).pathname };", ["path"]);
/** 화면 크기를 바꾸고 다시 연다 — 원본은 컨텍스트를 그 크기로 만든다 */
const resize = (w: string, h: string) => [
  `await page.setViewportSize({ width: Number(${w}), height: Number(${h}) });`,
  "await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000);",
];
/** 화면에 펼쳐진 GNB 항목 수 — 원본 visibleNavCount */
const visibleNav = "await page.locator('header a[data-link=\"gnb-link\"]').evaluateAll((els) => els.filter((e) => e.offsetParent).length)";

const NAV = [["About", "/about"], ["Notices", "/notices"], ["Builder Apps", "/builder-apps"]] as const;
const EXTERNAL = [["MSU Space", "verse8.io/msu"], ["Guide", "docs.msu.io"], ["Support", "support.msu.io"], ["WhitePaper", "docs.nexpace.io"], ["MSU Builder", "msu.io/builder"]] as const;
const SPACE_MENU = [["MSU Space", "https://verse8.io/msu"], ["MSU Resource Search", "https://resource-search.msu.io/search"], ["MSU Forum", "https://forum.msu.io"]] as const;
const key = (s: string) => s.replace(/[^A-Za-z]/g, "");

// ── 02-navigation-links ───────────────────────────────────────────────────
part.flows.push(
  flow("msuweb-02-gnb-links", "MSU 웹 · GNB 링크 주소",
    "02-navigation-links: GNB 는 지정된 메뉴를 지정된 경로로 연결한다 — href만 본다(누르지 않는다)",
    [
      web("open", "메인 열기", [pause(4000), cookie(), ...NAV.map(([t]) => href(key(t), navLink(t))), href("space", navLink("MSU Space"))], openAt(`${WEB}/`)),
      judge([
        ...NAV.map(([t, h]) => check(`GNB ${t} 의 링크`, `{{ $node.open.${key(t)} }}`, "contains", h)),
        check("GNB MSU Space 의 링크", "{{ $node.open.space }}", "contains", "verse8.io/msu"),
      ]),
    ]),
  flow("msuweb-02-gnb-click", "MSU 웹 · GNB 메뉴 누르기 → 이동",
    "02-navigation-links: GNB 메뉴(About · Notices · Builder Apps)를 누르면 그 페이지로 가고 헤더가 있다",
    NAV.flatMap(([t], i) => [
      web(`go${i}`, `${t} 누르기`, [...(i ? [goto(`${WEB}/`)] : []), pause(4000), cookie(), click(navLink(t)), pause(4000), shown("header", "header")], i ? { kind: "continue" } : openAt(`${WEB}/`)),
      pathOf(`at${i}`),
    ]).concat(judge(NAV.flatMap(([t, h], i) => [
      check(`${t} 클릭 후 경로`, `{{ $node.at${i}.path }}`, "eq", h),
      check(`${t} 페이지에도 헤더가 있어야 한다`, `{{ $node.go${i}.header }}`, "notEmpty"),
    ])))),
  flow("msuweb-02-new-badge", "MSU 웹 · MSU Space 의 NEW 배지",
    "02-navigation-links: NEW 배지는 MSU Space 에만 붙어 있다",
    [
      web("open", "메인 열기", [pause(4000), cookie(),
        read("space", navLink("MSU Space")),
        read("spaceNew", T("MSU Space 의 New", "xpath", `(//header//a[@data-link="gnb-link"][contains(normalize-space(.),"MSU Space")])[1]//*[normalize-space(.)="New" and not(*)]`), { strategy: "text" }),
        ...NAV.map(([t]) => read(`${key(t)}New`, T(`${t} 의 New`, "xpath", `(//header//a[@data-link="gnb-link"][contains(normalize-space(.),"${t}")])[1]//*[normalize-space(.)="New" and not(*)]`), { strategy: "text" }))], openAt(`${WEB}/`)),
      judge([
        check("MSU Space 메뉴가 있어야 한다", "{{ $node.open.space }}", "notEmpty"),
        check("MSU Space 에 NEW 배지가 있어야 한다", "{{ $node.open.spaceNew }}", "eq", "New"),
        ...NAV.map(([t]) => check(`${t} 에는 NEW 배지가 없어야 한다`, `{{ $node.open.${key(t)}New }}`, "empty")),
      ]),
    ]),
  flow("msuweb-02-footer-links", "MSU 웹 · 푸터 링크",
    "02-navigation-links: 푸터는 정책 · 가이드 · 외부 채널 링크를 모두 제공한다",
    [
      web("open", "메인 열기", [pause(4000), cookie(),
        ...EXTERNAL.map(([t]) => href(key(t), footerLink(t))),
        ...["terms", "privacy", "cookie", "risk"].map((p) => href(p, T(`푸터 /policy/${p}`, "css", `footer a[href="/policy/${p}"]`)))], openAt(`${WEB}/`)),
      judge([
        ...EXTERNAL.map(([t, h]) => check(`푸터 ${t} 의 링크`, `{{ $node.open.${key(t)} }}`, "contains", h)),
        ...["terms", "privacy", "cookie", "risk"].map((p) => check(`푸터에 ${p} 정책 링크가 있어야 한다`, `{{ $node.open.${p} }}`, "eq", `/policy/${p}`)),
      ]),
    ]),
  flow("msuweb-02-space-menu", "MSU 웹 · MSU Space 메뉴 → Resource Search · Forum",
    "02-navigation-links: MSU Space 메뉴(마우스를 올리면 열림)에 세 곳이 새 창 링크로 있다 — 올리기 · 항목 수는 코드로",
    [
      web("open", "메인 열기", [pause(4000), cookie()], openAt(`${WEB}/`)),
      custom("hover", "MSU Space 에 마우스 올리기", [
        "const t = page.locator('header a[data-link=\"gnb-link\"]', { hasText: 'MSU Space' }).first();",
        "await t.waitFor({ state: 'visible', timeout: 20000 }); await t.hover();",
        "await page.locator('[role=\"listbox\"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});",
        "await page.waitForTimeout(600);",
        "return { options: await page.locator('[role=\"option\"]').count() };",
      ], ["options"]),
      web("menu", "메뉴 항목 읽기", SPACE_MENU.flatMap(([t]) => {
        const it = T(`메뉴 «${t}»`, "xpath", `(//header//*[@role="listbox"]//a[normalize-space(.)="${t}"])[1]`);
        return [href(`${key(t)}Href`, it), read(`${key(t)}Target`, it, { strategy: "attribute", attribute: "target" })];
      })),
      judge([
        check("세 개의 항목이 있어야 한다", "{{ $node.hover.options }}", "eq", "3"),
        ...SPACE_MENU.flatMap(([t, h]) => [
          check(`${t} 의 링크`, `{{ $node.menu.${key(t)}Href }}`, "eq", h),
          check(`${t} 는 새 창으로 열려야 한다`, `{{ $node.menu.${key(t)}Target }}`, "eq", "_blank"),
        ]),
      ]),
    ]),
);
part.items.push(
  item("w02a", "msuweb-02-gnb-links", "[02-navigation-links] GNB 는 지정된 메뉴를 지정된 경로로 연결한다"),
  item("w02b", "msuweb-02-gnb-click", "[02-navigation-links] GNB 메뉴를 클릭하면 해당 페이지로 이동한다"),
  item("w02c", "msuweb-02-new-badge", "[02-navigation-links] MSU Space 메뉴에 NEW 배지가 붙어 있다"),
  item("w02d", "msuweb-02-footer-links", "[02-navigation-links] 푸터는 정책 · 가이드 · 외부 채널 링크를 모두 제공한다"),
  item("w02e", "msuweb-02-space-menu", "[02-navigation-links] MSU Space 메뉴에서 Resource Search 와 Forum 으로 갈 수 있다"),
);
part.notes.push(
  "02-navigation-links: GNB 누르기는 원본처럼 하이드레이션 전 클릭을 한 번 더 눌러 보지 않는다 — 대신 4초 기다린 뒤 누른다",
  "02-navigation-links: «정확히 1개»(NEW 배지 · 정책 링크)는 엔진 규칙에 기댄다 — 0개면 불통과, 2개 이상이면 오류로 남는다",
  "02-navigation-links: MSU Space 메뉴는 마우스 올리기 동작이 없어 커스텀 노드로 올리고 항목 수를 센다",
);

// ── 03-responsive ─────────────────────────────────────────────────────────
part.flows.push(
  flow("msuweb-03-viewport", "MSU 웹 · 화면 너비별 가로 스크롤 · 헤더 · 푸터",
    "03-responsive: 그 너비에서 가로 스크롤 없이 헤더와 푸터가 보인다 — 너비 · 높이는 실행 입력, 크기 바꾸기 · 넘침 재기는 코드로",
    [
      web("open", "메인 열기", [pause(3000), cookie()], openAt(`${WEB}/`)),
      custom("size", "화면 크기 바꾸고 다시 열기", [...resize("ctx.params.width", "ctx.params.height"), "return { width: String(page.viewportSize().width) };"], ["width"]),
      web("shell", "헤더 · 푸터 읽기", [shown("header", "header"), shown("footer", "footer")]),
      custom("overflow", "가로 넘침 재기", [
        "const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);",
        "return { scrollWidth: sw, innerWidth: iw, overflow: sw - iw > 2 };",
      ], ["scrollWidth", "innerWidth", "overflow"]),
      judge([
        check("그 너비로 열렸다", "{{ $node.size.width }}", "eq", "{{ $params.width }}"),
        check("헤더가 있어야 한다", "{{ $node.shell.header }}", "notEmpty"),
        check("푸터가 있어야 한다", "{{ $node.shell.footer }}", "notEmpty"),
        check("가로 스크롤이 생기면 안 된다", "{{ $node.overflow.overflow }}", "isFalse"),
      ]),
    ],
    [{ name: "width", label: "화면 너비", default: "1920" }, { name: "height", label: "화면 높이", default: "1080" }]),
  flow("msuweb-03-desktop-nav", "MSU 웹 · 데스크톱 GNB 펼침",
    "03-responsive: 1440×900 에서 GNB 메뉴가 펼쳐져 보인다 — 보이는 항목 수는 코드로",
    [
      web("open", "메인 열기", [pause(3000), cookie()], openAt(`${WEB}/`)),
      custom("nav", "1440×900 · 보이는 GNB 수", [...resize("1440", "900"), `return { visible: ${visibleNav} };`], ["visible"]),
      judge([check("데스크톱에서는 GNB 메뉴가 보여야 한다", "{{ $node.nav.visible }}", "gt", "0")]),
    ]),
  flow("msuweb-03-mobile-nav", "MSU 웹 · 모바일 GNB 접힘 · 햄버거",
    "03-responsive: 390×844 에서 GNB 가 접혀 있고 햄버거로 열면 메뉴가 보인다 — 크기 바꾸기 · 보이는 항목 수는 코드로",
    [
      web("open", "메인 열기", [pause(3000), cookie()], openAt(`${WEB}/`)),
      custom("nav", "390×844 · 보이는 GNB 수", [...resize("390", "844"), `return { visible: ${visibleNav} };`], ["visible"]),
      web("drawer", "햄버거 열기", [
        click(T("햄버거(헤더의 마지막 버튼)", "xpath", "(//header//button)[last()]")), pause(1500),
        ...["About", "Notices", "Builder Apps", "MSU Space"].map((t) => read(key(t), T(`서랍 «${t}»`, "css", `nav:not(footer nav) a:visible:has-text("${t}") >> nth=0`)))]),
      judge([
        check("모바일에서는 GNB 가 접혀 있어야 한다", "{{ $node.nav.visible }}", "eq", "0"),
        ...["About", "Notices", "Builder Apps", "MSU Space"].map((t) => check(`햄버거를 열면 ${t} 가 보여야 한다`, `{{ $node.drawer.${key(t)} }}`, "notEmpty")),
      ]),
    ]),
);
part.items.push(
  item("w03a", "msuweb-03-viewport", "[03-responsive] 데스크톱 1920 에서 가로 스크롤 없이 헤더와 푸터가 노출된다", { width: "1920", height: "1080" }),
  item("w03b", "msuweb-03-viewport", "[03-responsive] 데스크톱 1440 에서 가로 스크롤 없이 헤더와 푸터가 노출된다", { width: "1440", height: "900" }),
  item("w03c", "msuweb-03-viewport", "[03-responsive] 태블릿 768 에서 가로 스크롤 없이 헤더와 푸터가 노출된다", { width: "768", height: "1024" }),
  item("w03d", "msuweb-03-viewport", "[03-responsive] 모바일 390 에서 가로 스크롤 없이 헤더와 푸터가 노출된다", { width: "390", height: "844" }),
  item("w03e", "msuweb-03-desktop-nav", "[03-responsive] 데스크톱에서는 GNB 메뉴가 그대로 펼쳐져 있다"),
  item("w03f", "msuweb-03-mobile-nav", "[03-responsive] 모바일에서는 GNB 가 접혀 있고 햄버거로 열 수 있다"),
);
part.notes.push(
  "03-responsive: 원본 drawerLink(nav a 중 보이는 첫째)는 모바일에서 늘 보이는 푸터 nav의 ABOUT 등을 골라 햄버거를 안 열어도 통과한다 — 여기서는 footer 안 nav를 빼고 찾는다",
  "03-responsive: 원본은 처음부터 그 크기의 컨텍스트로 연다 — 여기서는 기본 크기로 연 뒤 커스텀 노드로 크기를 바꾸고 다시 연다(웹페이지 노드에 화면 크기가 없다)",
);

// ── 04-notices ────────────────────────────────────────────────────────────
const firstNotice = T("첫 공지", "xpath", '(//a[starts-with(@href,"/notices/")])[1]');
const firstTitle = T("첫 공지 제목", "xpath", '(//a[starts-with(@href,"/notices/")])[1]//h4');
const NOT_FOUND = "[Nn][Oo][Tt] [Ff][Oo][Uu][Nn][Dd]|404";
part.flows.push(
  flow("msuweb-04-notice-list", "MSU 웹 · 공지 목록",
    "04-notices: 공지 목록에 글이 노출된다",
    [
      web("open", "/notices 열기", [pause(4000), cookie(), href("href", firstNotice), read("title", firstTitle), read("body", T("본문 전체", "css", "body"))], openAt(`${WEB}/notices`)),
      judge([
        check("공지가 하나는 있어야 한다", "{{ $node.open.href }}", "startsWith", "/notices/"),
        check("첫 공지 제목이 있다", "{{ $node.open.title }}", "notEmpty"),
        ...noLeak("{{ $node.open.body }}"),
      ]),
    ]),
  flow("msuweb-04-notice-open", "MSU 웹 · 공지 열기 → 목록으로",
    "04-notices: 목록에서 첫 공지를 열면 같은 글의 상세가 열리고 Back to List 로 목록에 돌아온다",
    [
      web("open", "/notices 열기", [pause(4000), cookie(), href("href", firstNotice), read("title", firstTitle)], openAt(`${WEB}/notices`)),
      web("detail", "첫 공지 열기", [cookie(), click(firstNotice), waitUrl("/notices/[^/?]+", 20000), pause(3000), read("body", T("본문 전체", "css", "body"))]),
      pathOf("atDetail"),
      web("back", "Back to List", [cookie(), click(T("Back to List", "text", "Back to List")), waitUrl("/notices([?#]|$)", 20000), pause(3000), href("again", firstNotice)]),
      pathOf("atList"),
      judge([
        check("고른 공지의 상세로 갔다", "{{ $node.atDetail.path }}", "eq", "{{ $node.open.href }}"),
        check("목록에서 고른 글이 열려야 한다", "{{ $node.detail.body }}", "contains", "{{ $node.open.title }}"),
        ...noLeak("{{ $node.detail.body }}"),
        check("목록 경로로 돌아왔다", "{{ $node.atList.path }}", "eq", "/notices"),
        check("목록으로 돌아와야 한다", "{{ $node.back.again }}", "startsWith", "/notices/"),
      ]),
    ]),
  flow("msuweb-04-notice-search-empty", "MSU 웹 · 공지 검색 결과 없음",
    "04-notices: 결과가 없는 검색어는 빈 상태를 안내하고 목록이 비어 있다",
    [
      web("open", "검색", [pause(4000), cookie(),
        fill(T("공지 검색 칸", "css", 'input[placeholder="Search"]'), "{{ $params.keyword }}"),
        press(T("공지 검색 칸", "css", 'input[placeholder="Search"]'), "Enter"),
        waitUrl("keywords=", 20000), pause(3000),
        read("empty", T("No search results found.", "xpath", '(//*[contains(normalize-space(text()),"No search results found.")])[1]')),
        href("first", firstNotice),
        read("body", T("본문 전체", "css", "body"))], openAt(`${WEB}/notices`)),
      judge([
        check("검색 결과 없음을 안내해야 한다", "{{ $node.open.empty }}", "notEmpty"),
        check("검색 결과는 비어 있어야 한다", "{{ $node.open.first }}", "empty"),
        ...noLeak("{{ $node.open.body }}"),
      ]),
    ],
    [{ name: "keyword", label: "없는 검색어", default: "zzqqxx-없는-공지-zzqqxx" }]),
  flow("msuweb-04-notice-404", "MSU 웹 · 없는 공지 번호는 404",
    "04-notices: /notices/999999999 · /notices/not-a-thread-id 는 404 로 처리되고 내부 정보를 흘리지 않는다",
    [
      web("open", "없는 공지 두 곳", [pause(4000), cookie(), read("num", T("본문 전체", "css", "body")),
        goto(`${WEB}/notices/not-a-thread-id`), pause(4000), read("word", T("본문 전체", "css", "body"))], openAt(`${WEB}/notices/999999999`)),
      judge([
        check("/notices/999999999 는 404 여야 한다", "{{ $node.open.num }}", "matches", NOT_FOUND),
        ...noLeak("{{ $node.open.num }}"),
        check("/notices/not-a-thread-id 는 404 여야 한다", "{{ $node.open.word }}", "matches", NOT_FOUND),
        ...noLeak("{{ $node.open.word }}"),
      ]),
    ]),
);
part.items.push(
  item("w04a", "msuweb-04-notice-list", "[04-notices] 공지 목록에 글이 노출된다"),
  item("w04b", "msuweb-04-notice-open", "[04-notices] 목록에서 공지를 열면 같은 글의 상세가 열리고 목록으로 돌아올 수 있다"),
  item("w04c", "msuweb-04-notice-search-empty", "[04-notices] 검색 결과가 없으면 빈 상태를 안내한다", { keyword: "zzqqxx-없는-공지-zzqqxx" }),
  item("w04d", "msuweb-04-notice-404", "[04-notices] 없는 공지 번호는 404 로 처리된다"),
);
part.notes.push(
  "04-notices: «공지가 하나는 있다»(count > 0)는 첫 공지 링크를 읽어 갈음한다 — 공지 수는 세지 않는다",
  "04-notices: 공지 제목은 원본의 «링크 글자 첫 줄» 대신 링크 안 h4 를 읽는다",
);

// ── 09-accessibility ──────────────────────────────────────────────────────
const noAlt = (nodeId: string) => custom(nodeId, "alt 없는 이미지", [
  "const missing = await page.evaluate(() => Array.from(document.querySelectorAll('img')).filter((i) => !!i.offsetParent).filter((i) => i.getAttribute('alt') === null).map((i) => (i.getAttribute('src') || '').split('?')[0].slice(-50)));",
  "return { missing: missing.join(', ') };",
], ["missing"]);
part.flows.push(
  flow("msuweb-09-keyboard-gnb", "MSU 웹 · Tab 으로 GNB → Enter",
    "09-accessibility: 맨 위에서 Tab 만으로 GNB 의 Notices 에 닿고 Enter 로 /notices 에 간다 — Tab 순서 · 초점은 코드로",
    [
      web("open", "메인 열기", [pause(4000), cookie()], openAt(`${WEB}/`)),
      custom("tab", "Tab 으로 걷기", [
        "const order = []; let landed = '';",
        "for (let i = 0; i < 12 && !landed; i += 1) {",
        "  await page.keyboard.press('Tab');",
        "  const f = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return '(없음)'; const name = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('href') || '').trim(); return el.tagName + ':' + name.slice(0, 40).replace(/\\n/g, ' '); });",
        "  order.push(f); if (f.includes('Notices')) landed = f;",
        "}",
        "return { landed, order: order.join(' → ') };",
      ], ["landed", "order"]),
      web("enter", "Enter", [press(null, "Enter"), pause(4000)]),
      pathOf("at"),
      judge([
        check("Tab 만으로 GNB 의 Notices 에 닿아야 한다", "{{ $node.tab.landed }}", "contains", "Notices"),
        check("Enter 로 이동해야 한다", "{{ $node.at.path }}", "eq", "/notices"),
      ]),
    ]),
  flow("msuweb-09-img-alt", "MSU 웹 · 이미지 대체 텍스트",
    "09-accessibility: / 와 /notices 에서 화면에 보이는 이미지에 alt 속성이 있다(alt=\"\"는 장식 이미지로 허용) — 이미지 훑기는 코드로",
    [
      web("main", "메인 열기", [pause(4000), cookie()], openAt(`${WEB}/`)),
      noAlt("altMain"),
      web("notices", "/notices 열기", [goto(`${WEB}/notices`), pause(4000), cookie()]),
      noAlt("altNotices"),
      judge([
        check("/: alt 없는 이미지가 있으면 안 된다", "{{ $node.altMain.missing }}", "empty"),
        check("/notices: alt 없는 이미지가 있으면 안 된다", "{{ $node.altNotices.missing }}", "empty"),
      ]),
    ]),
);
part.items.push(
  item("w09a", "msuweb-09-keyboard-gnb", "[09-accessibility] Tab 으로 GNB 에 닿고 Enter 로 이동할 수 있다"),
  item("w09b", "msuweb-09-img-alt", "[09-accessibility] 화면에 보이는 이미지에는 대체 텍스트가 있다"),
);
part.notes.push(
  "09-accessibility: Tab 순서 · 초점 · 이미지 alt 훑기는 웹페이지 동작에 없어 커스텀 노드로 — Enter 는 동작(누르기)으로",
);
