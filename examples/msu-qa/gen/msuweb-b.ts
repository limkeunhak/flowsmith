/** MSU 웹 — 05-content-failure · 06-profile-layer · 08-cookie-consent (원본 tests/msuweb/). msuweb.ts가 합친다 */
import { WEB, T, check, click, cookie, custom, flow, goto, item, judge, noLeak, openAt, pause, read, waitUrl, web, type Part } from "./lib.ts";

const part: Part = { flows: [], items: [], notes: [] };
export default part;

// lib에 없는 동작 — 체크박스 켜기
let n = 0;
const tick = (target: any) => ({ id: `wb${++n}`, kind: "check", risk: "safe", timeoutMs: null, optional: false, target, checked: true });

const NOTICE_LINKS = 'a[href^="/notices/"]';
const FIRST_NOTICE = "(//a[starts-with(@href,'/notices/')])[1]";
const header = () => read("header", T("헤더", "css", "header"));
const body = () => read("body", T("본문 전체", "css", "body"));

/** 공지 링크 수 · 가로 넘침 · 본문 — 개수 · 스크롤 폭은 웹페이지 동작에 없어서 코드로 */
const measure = (nodeId = "measure") =>
  custom(nodeId, "공지 수 · 가로 넘침", [
    `await page.locator('${NOTICE_LINKS}').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});`,
    `const noticeCount = await page.locator('${NOTICE_LINKS}').count();`,
    "const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth > 2);",
    "const body = await page.locator('body').innerText().catch(() => '');",
    "return { noticeCount, overflow, body };",
  ], ["noticeCount", "overflow", "body"]);

/** CookieConsent 쿠키 — 원본 cookieConsent()처럼 «키:true|false»를 뽑는다. 없으면 recorded=false */
const CONSENT_CODE = [
  "const raw = (await page.context().cookies()).find((c) => c.name === 'CookieConsent')?.value ?? '';",
  "const text = decodeURIComponent(raw);",
  "const v = (k) => { const m = text.match(new RegExp(k + ':(true|false)')); return m ? m[1] : ''; };",
  "const consent = { recorded: raw !== '', raw: text, necessary: v('necessary'), preferences: v('preferences'), statistics: v('statistics'), marketing: v('marketing') };",
];
const CONSENT_OUT = ["recorded", "raw", "necessary", "preferences", "statistics", "marketing"];
const consent = (nodeId = "consent") => custom(nodeId, "기록된 쿠키 동의", [...CONSENT_CODE, "return consent;"], CONSENT_OUT);

/** 배너 — 보이면 글자, 안 보이면 빈 값(«있을 때만» 읽기는 보이는 것만 찾는다) */
const banner = (output = "banner") => read(output, T("쿠키 배너", "css", "#cookiebotBanner"));
const bannerBtn = (name: string) => T(`배너 «${name}»`, "css", `button:visible:has-text("${name}")`);
/** 첫 방문 — 원본 firstVisit: 열고 3.5초. 쿠키 배너를 건드리지 않는다 */
const firstVisit = (actions: any[]) => web("open", "첫 방문", [pause(4000), ...actions], openAt(`${WEB}/`));

// ── 05-content-failure ─────────────────────────────────────────────────────
const ANALYTICS = ["**://*.googletagmanager.com/**", "**://*.google-analytics.com/**", "**://*.segment.com/**", "**://*.segment.io/**", "**://*.sentry.io/**"];

part.flows.push(
  flow("msuweb-05-rsc-failure", "MSU 웹 · _rsc 요청이 실패해도 공지 상세가 열린다",
    "05-content-failure: 목록에서 첫 공지를 고른 뒤 `?_rsc=` 요청을 500으로 막고 누른다 — 전체 로드로라도 글이 보여야 한다",
    [
      web("open", "공지 목록", [pause(4000), cookie(),
        read("href", T("첫 공지 링크", "xpath", FIRST_NOTICE), { optional: false, strategy: "attribute", attribute: "href" }),
        read("title", T("첫 공지 제목", "xpath", `${FIRST_NOTICE}//h4`), { optional: false })], openAt(`${WEB}/notices`)),
      custom("route", "_rsc 요청을 500으로", [
        "page.__rscHits = 0;",
        "await page.route('**/notices/*', (route) => { if (route.request().url().includes('_rsc=')) { page.__rscHits++; return route.fulfill({ status: 500, body: '{}' }); } return route.continue(); });",
        "return { routed: true };",
      ], ["routed"]),
      web("click", "첫 공지 누르기", [click(T("첫 공지 링크", "xpath", FIRST_NOTICE))]),
      // 주소가 안 바뀌면 오류가 아니라 불통과로 — 기다리기만 하고 판정은 검사 노드가
      custom("where", "상세 주소 기다리기", [
        "const arrived = await page.waitForURL((u) => /^\\/notices\\/\\d+$/.test(new URL(u).pathname), { timeout: 30000 }).then(() => true, () => false);",
        "await page.waitForTimeout(arrived ? 5000 : 0);",
        "return { path: new URL(page.url()).pathname, rscHits: page.__rscHits ?? 0 };",
      ], ["path", "rscHits"]),
      web("detail", "상세 본문", [body()]),
      judge([
        check("고른 공지의 주소로 왔다", "{{ $node.where.path }}", "eq", "{{ $node.open.href }}"),
        check("전체 로드로 되돌아가서라도 글이 보여야 한다", "{{ $node.detail.body }}", "contains", "{{ $node.open.title }}"),
        ...noLeak("{{ $node.detail.body }}"),
      ]),
    ]),
  flow("msuweb-05-images-blocked", "MSU 웹 · 이미지가 막혀도 목록과 헤더는 그대로",
    "05-content-failure: /_next/image 요청을 모두 끊고 /notices — 헤더 · 공지 목록이 있고 가로로 넘치지 않는다",
    [
      custom("route", "이미지 끊고 열기", [
        "await page.route('**/_next/image**', (route) => route.abort());",
        `await page.goto('${WEB}/notices', { waitUntil: 'domcontentloaded' });`,
        "return { opened: page.url() };",
      ], ["opened"]),
      web("open", "헤더 읽기", [pause(4000), cookie(), header()]),
      measure(),
      judge([
        check("헤더가 있어야 한다", "{{ $node.open.header }}", "notEmpty"),
        check("공지 목록은 그대로 나와야 한다", "{{ $input.noticeCount }}", "gt", "0"),
        check("이미지가 없어도 가로로 넘치면 안 된다", "{{ $input.overflow }}", "isFalse"),
        ...noLeak("{{ $input.body }}"),
      ]),
    ]),
  flow("msuweb-05-analytics-blocked", "MSU 웹 · 분석 스크립트가 막혀도 동작한다",
    "05-content-failure: GTM · GA · Segment · Sentry 요청을 모두 끊고 메인 → GNB Notices",
    [
      custom("route", "분석 스크립트 끊고 열기", [
        `for (const p of ${JSON.stringify(ANALYTICS)}) await page.route(p, (route) => route.abort());`,
        `await page.goto('${WEB}/', { waitUntil: 'domcontentloaded' });`,
        "return { opened: page.url() };",
      ], ["opened"]),
      web("open", "메인 → Notices", [pause(4000), cookie(), header(),
        read("connect", T("헤더의 Connect", "css", 'header button:has-text("Connect")')),
        click(T("GNB «Notices»", "css", 'header a[data-link="gnb-link"]:has-text("Notices")')),
        waitUrl("/notices(\\?|$)", 15000)]),
      measure(),
      judge([
        check("헤더가 있어야 한다", "{{ $node.open.header }}", "notEmpty"),
        check("로그인 진입점은 살아 있어야 한다", "{{ $node.open.connect }}", "contains", "Connect"),
        check("이동한 화면도 정상이어야 한다", "{{ $input.noticeCount }}", "gt", "0"),
        ...noLeak("{{ $input.body }}"),
      ]),
    ]),
  flow("msuweb-05-reload-recovers", "MSU 웹 · 일시 실패 뒤 새로고침하면 복구",
    "05-content-failure: 첫 /notices 응답을 503으로 바꿔 열고, 막기를 풀고 새로고침 — 헤더 · 목록이 돌아와야 한다",
    [
      custom("fail", "503으로 열고 새로고침", [
        "await page.route('**/notices', (route) => route.fulfill({ status: 503, contentType: 'text/html', body: '<html><body>503</body></html>' }));",
        `await page.goto('${WEB}/notices', { waitUntil: 'domcontentloaded' });`,
        `const failedCount = await page.locator('${NOTICE_LINKS}').count();`,
        "await page.unroute('**/notices');",
        "await page.reload({ waitUntil: 'domcontentloaded' });",
        "return { failedCount };",
      ], ["failedCount"]),
      web("open", "복구 후 헤더", [pause(4000), cookie(), header()]),
      measure(),
      judge([
        check("실패한 로드에는 목록이 없다", "{{ $node.fail.failedCount }}", "eq", "0"),
        check("복구 후 헤더가 있어야 한다", "{{ $node.open.header }}", "notEmpty"),
        check("복구 후 목록이 나와야 한다", "{{ $input.noticeCount }}", "gt", "0"),
        ...noLeak("{{ $input.body }}"),
      ]),
    ]),
);
part.items.push(
  item("w05a", "msuweb-05-rsc-failure", "[05-content-failure] 상세 이동용 요청이 실패해도 공지 상세는 열린다"),
  item("w05b", "msuweb-05-images-blocked", "[05-content-failure] 이미지가 하나도 로드되지 않아도 목록과 헤더는 그대로다"),
  item("w05c", "msuweb-05-analytics-blocked", "[05-content-failure] 분석 · 추적 스크립트가 모두 차단돼도 페이지는 동작한다"),
  item("w05d", "msuweb-05-reload-recovers", "[05-content-failure] 일시적으로 실패한 뒤 새로고침하면 정상으로 돌아온다"),
);
part.notes.push(
  "05-content-failure: 요청 가로채기(page.route) · 공지 수 · 가로 넘침은 동작에 없어 커스텀 노드로. 첫 이동 전에 막아야 하는 셋은 커스텀 노드가 막고 직접 연다",
  "05-content-failure «상세 이동용 요청…»: 원본은 waitForURL(href)로 주소를 확인 — 여기선 커스텀 노드가 /notices/<숫자>를 30초 기다리고(못 와도 멈추지 않음) 경로가 고른 href와 같은지 검사로 — 못 오면 오류가 아니라 불통과",
  "05-content-failure «상세 이동용 요청…»: 제목은 목록에도 있어 «글이 보인다»만으로는 상세인지 못 가린다 — 주소 검사가 함께 있어야 의미가 있다(원본도 waitForURL이 그 몫)",
  "05-content-failure «일시적으로 실패한 뒤…»: 원본은 https://msu.io/notices(운영)를 직접 열었다 — 여기선 qa.msu.io/notices",
);

// ── 06-profile-layer (visitor만) ──────────────────────────────────────────
part.flows.push(
  flow("msuweb-06-visitor-connect", "MSU 웹 · 비회원은 프로필 대신 Connect",
    "06-profile-layer: 비회원 메인 — Connect가 보이고 프로필 버튼 · Buy NXPC는 DOM에 없어야 한다",
    [
      web("open", "메인 열기", [pause(4000), cookie(), read("connect", T("헤더의 Connect", "css", 'header button:has-text("Connect")'))], openAt(`${WEB}/`)),
      custom("count", "프로필 · Buy NXPC 개수", [
        "const profile = await page.locator('#USER_PROFILE_BUTTON_ID').count();",
        "const buyNxpc = await page.locator('[aria-label=\"Buy NXPC\"]').count();",
        "return { profile, buyNxpc };",
      ], ["profile", "buyNxpc"]),
      judge([
        check("Connect 가 보여야 한다", "{{ $node.open.connect }}", "contains", "Connect"),
        check("프로필 버튼은 없어야 한다", "{{ $input.profile }}", "eq", "0"),
        check("비회원에게 Buy NXPC 는 없어야 한다", "{{ $input.buyNxpc }}", "eq", "0"),
      ]),
    ]),
);
part.items.push(item("w06a", "msuweb-06-visitor-connect", "[06-profile-layer] 비회원에게는 프로필 영역 대신 Connect 가 보인다"));
part.notes.push("06-profile-layer: toHaveCount(0)은 숨은 요소도 세야 해서 개수만 커스텀 노드로(«있을 때만» 읽기는 보이는 것만 본다)");

// ── 08-cookie-consent ──────────────────────────────────────────────────────
part.flows.push(
  flow("msuweb-08-banner-first-visit", "MSU 웹 · 첫 방문에 쿠키 배너",
    "08-cookie-consent: 처음 방문하면 배너가 보이고 아무것도 기록되지 않았으며, 정책 링크 · 전체 동의 · 전체 거부가 있다",
    [
      firstVisit([banner(),
        read("acceptAll", bannerBtn("Accept All Cookies")),
        read("rejectAll", bannerBtn("Reject All"))]),
      custom("consent", "기록된 쿠키 동의 · 정책 링크 수", [...CONSENT_CODE,
        "const policyLinks = await page.locator('#cookiebotBanner a[href*=\"cookie\"]').count();",
        "return { ...consent, policyLinks };",
      ], [...CONSENT_OUT, "policyLinks"]),
      judge([
        check("쿠키 배너가 보여야 한다", "{{ $node.open.banner }}", "notEmpty"),
        check("아직 아무것도 기록되지 않아야 한다", "{{ $input.recorded }}", "isFalse"),
        check("쿠키 정책 링크가 있어야 한다", "{{ $input.policyLinks }}", "eq", "1"),
        check("전체 동의 버튼이 있어야 한다", "{{ $node.open.acceptAll }}", "eq", "Accept All Cookies"),
        check("전체 거부 버튼이 있어야 한다", "{{ $node.open.rejectAll }}", "eq", "Reject All"),
      ]),
    ]),
  flow("msuweb-08-accept-all", "MSU 웹 · 쿠키 전체 동의",
    "08-cookie-consent: 전체 동의 — 네 항목이 동의로 기록되고 같은 세션의 다른 페이지에서 다시 묻지 않는다",
    [
      firstVisit([click(bannerBtn("Accept All Cookies")), pause(2500), banner()]),
      consent(),
      web("next", "같은 세션에서 /notices", [goto(`${WEB}/notices`), pause(4000), banner("bannerNext")]),
      judge([
        check("배너가 닫혀야 한다", "{{ $node.open.banner }}", "empty"),
        check("동의가 기록되어야 한다", "{{ $node.consent.recorded }}", "isTrue"),
        ...["necessary", "preferences", "statistics", "marketing"].map((k) => check(`${k} 가 동의로 기록되어야 한다`, `{{ $node.consent.${k} }}`, "isTrue")),
        check("같은 세션의 다른 페이지에서 다시 묻지 않아야 한다", "{{ $node.next.bannerNext }}", "empty"),
      ]),
    ]),
  flow("msuweb-08-reject-all", "MSU 웹 · 쿠키 전체 거부",
    "08-cookie-consent: 전체 거부 — 필수만 동의, 나머지는 거부로 기록된다",
    [
      firstVisit([click(bannerBtn("Reject All")), pause(2500), banner()]),
      consent(),
      judge([
        check("배너가 닫혀야 한다", "{{ $node.open.banner }}", "empty"),
        check("거부도 기록되어야 한다", "{{ $input.recorded }}", "isTrue"),
        check("필수 항목은 남아야 한다", "{{ $input.necessary }}", "isTrue"),
        ...["preferences", "statistics", "marketing"].map((k) => check(`${k} 는 거부로 기록되어야 한다`, `{{ $input.${k} }}`, "isFalse")),
      ]),
    ]),
  flow("msuweb-08-accept-selected", "MSU 웹 · 쿠키 설정에서 고른 항목만",
    "08-cookie-consent: Accept Selected로 설정 창을 열어 세 번째 칸(Statistics)만 켜고 Confirm My Choices",
    [
      firstVisit([click(bannerBtn("Accept Selected")),
        read("settings", T("«Cookie Settings»", "text", "Cookie Settings"))]),
      custom("boxes", "설정 창 체크박스 수", "return { boxes: await page.locator('#cookiebotModal input[type=checkbox]').count() };", ["boxes"]),
      web("choose", "세 번째 칸 켜고 확인", [
        tick(T("설정 창 세 번째 체크박스", "xpath", "(//*[@id='cookiebotModal']//input[@type='checkbox'])[3]")),
        click(T("«Confirm My Choices»", "css", 'button:visible:has-text("Confirm My Choices")')),
        pause(2500), banner()]),
      consent(),
      judge([
        check("설정 창이 열려야 한다", "{{ $node.open.settings }}", "notEmpty"),
        check("다섯 개 항목이 있어야 한다", "{{ $node.boxes.boxes }}", "eq", "5"),
        check("선택이 기록되어야 한다", "{{ $input.recorded }}", "isTrue"),
        check("고른 항목은 동의여야 한다(statistics)", "{{ $input.statistics }}", "isTrue"),
        check("고르지 않은 항목은 거부여야 한다(preferences)", "{{ $input.preferences }}", "isFalse"),
        check("고르지 않은 항목은 거부여야 한다(marketing)", "{{ $input.marketing }}", "isFalse"),
        check("확인 후 배너가 닫혀야 한다", "{{ $node.choose.banner }}", "empty"),
      ]),
    ]),
  flow("msuweb-08-close-only", "MSU 웹 · 쿠키 배너 닫기만",
    "08-cookie-consent: X로 닫기만 하면 아무것도 기록되지 않고, 새로고침하면 다시 묻는다",
    [
      firstVisit([click(T("배너의 첫 버튼(X)", "xpath", "(//*[@id='cookiebotBanner']//button)[1]")), pause(2000), banner()]),
      custom("consent", "기록된 쿠키 동의 → 새로고침", [...CONSENT_CODE,
        "await page.reload({ waitUntil: 'domcontentloaded' });",
        "return consent;",
      ], CONSENT_OUT),
      web("again", "새로고침 뒤 배너", [pause(4000), banner("bannerAgain")]),
      judge([
        check("배너가 닫혀야 한다", "{{ $node.open.banner }}", "empty"),
        check("닫기만 했으면 아무것도 기록되면 안 된다", "{{ $node.consent.recorded }}", "isFalse"),
        check("다시 물어야 한다", "{{ $node.again.bannerAgain }}", "notEmpty"),
      ]),
    ]),
  flow("msuweb-08-new-session", "MSU 웹 · 새 세션에서 쿠키 배너 다시",
    "08-cookie-consent: 첫 세션에서 전체 동의로 닫은 뒤, 새 브라우저 컨텍스트로 처음 방문하면 기록이 없고 배너가 다시 보인다",
    [
      firstVisit([click(bannerBtn("Accept All Cookies")), pause(2500), banner()]),
      custom("second", "새 컨텍스트로 첫 방문", [
        "const browser = page.context().browser();",
        "if (!browser) throw new Error('새 컨텍스트를 열 브라우저가 없습니다');",
        "const c2 = await browser.newContext();",
        "try {",
        "  const p2 = await c2.newPage();",
        `  await p2.goto('${WEB}/', { waitUntil: 'domcontentloaded' });`,
        "  await p2.waitForTimeout(4000);",
        "  const recorded = (await c2.cookies()).some((c) => c.name === 'CookieConsent');",
        "  const banner = await p2.locator('#cookiebotBanner').first().waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);",
        "  return { recorded, banner };",
        "} finally { await c2.close(); }",
      ], ["recorded", "banner"]),
      judge([
        check("첫 세션에서는 닫힌다", "{{ $node.open.banner }}", "empty"),
        check("새 세션에는 기록이 없어야 한다", "{{ $input.recorded }}", "isFalse"),
        check("새 세션에서는 다시 물어야 한다", "{{ $input.banner }}", "isTrue"),
      ]),
    ]),
);
part.items.push(
  item("w08a", "msuweb-08-banner-first-visit", "[08-cookie-consent] 처음 방문하면 쿠키 배너가 노출된다"),
  item("w08b", "msuweb-08-accept-all", "[08-cookie-consent] 전체 동의하면 모든 항목이 동의로 기록되고 같은 세션에서 다시 묻지 않는다"),
  item("w08c", "msuweb-08-reject-all", "[08-cookie-consent] 전체 거부하면 필수 항목만 남고 나머지는 거부로 기록된다"),
  item("w08d", "msuweb-08-accept-selected", "[08-cookie-consent] 설정에서 고른 항목만 동의로 기록된다"),
  item("w08e", "msuweb-08-close-only", "[08-cookie-consent] 배너를 닫기만 하면 기록되지 않고 다음 방문에 다시 묻는다"),
  item("w08f", "msuweb-08-new-session", "[08-cookie-consent] 새 세션에서는 쿠키 배너를 다시 노출한다"),
);
part.notes.push(
  "08-cookie-consent: CookieConsent 쿠키 읽기는 동작에 없어 커스텀 노드로. 배너 «닫힘»은 «있을 때만» 읽어 빈 값인지로(원본은 toBeHidden 15초 — 여기선 고정 2~2.5초 뒤 한 번)",
  "08-cookie-consent «전체 동의…»: 원본은 같은 컨텍스트에 새 탭을 열어 /notices — 여기선 같은 탭에서 이동(쿠키는 같은 세션)",
  "08-cookie-consent «처음 방문…» · «전체 거부…»: 버튼은 원본처럼 페이지 전체에서 찾되 보이는 것만(:visible — 숨은 설정 창에도 Reject All 이 있다)",
  "08-cookie-consent «새 세션…»: 두 번째 세션은 커스텀 노드가 같은 브라우저에 새 컨텍스트를 열어 확인",
  "08-cookie-consent «설정에서 고른…»: 원본은 check({ force: true }) — 여기선 보통 켜기(칸이 보여서 된다)",
);
