/** MSU 웹(msu.io 본체) — 원본 tests/msuweb/ */
import { WEB, T, check, cookie, custom, flow, goto, item, judge, noLeak, openAt, pause, read, web, where, merge, type Service } from "./lib.ts";
import partA from "./msuweb-a.ts";
import partB from "./msuweb-b.ts";

/** 셸 — 헤더 · 푸터 · 본문 글자 */
const shellReads = () => [read("header", T("헤더", "css", "header")), read("footer", T("푸터", "css", "footer")), read("body", T("본문 전체", "css", "body"))];

const svc: Service = {
  file: "msuweb",
  suite: { name: "MSU QA · MSU 웹 (msu-e2e-test)", description: "msu-e2e-test tests/msuweb/의 visitor 시나리오 — 대상 qa.msu.io" },
  flows: [],
  items: [],
  notes: [],
};
export default svc;

// ── 01-landing ────────────────────────────────────────────────────────────
svc.flows.push(
  flow("msuweb-main-visitor", "MSU 웹 · 비회원 메인 — 헤더 · 푸터 · 로그인 진입점",
    "01-landing: 비회원으로 메인에 들어가면 헤더 · 푸터 · 로그인 진입점이 노출된다",
    [
      web("open", "메인 열기", [pause(4000), cookie(), ...shellReads(),
        read("connect", T("헤더의 Connect", "css", 'header button:has-text("Connect")')),
        read("synergy", T("Synergy Apps", "css", 'button:has-text("Synergy Apps")'))], openAt(`${WEB}/`)),
      where(),
      judge([
        check("헤더가 있다", "{{ $node.open.header }}", "notEmpty"),
        check("푸터가 있다", "{{ $node.open.footer }}", "notEmpty"),
        check("비회원에게 Connect가 보인다", "{{ $node.open.connect }}", "contains", "Connect"),
        check("서비스 전환 메뉴가 있다", "{{ $node.open.synergy }}", "notEmpty"),
        ...noLeak("{{ $node.open.body }}"),
      ]),
    ]),
  flow("msuweb-direct-route", "MSU 웹 · 경로에 직접 들어가기",
    "01-landing: /about · /notices · /builder-apps 에 직접 들어가도 정상 렌더링된다 — 경로는 실행 입력",
    [
      web("open", "경로 열기", [pause(4000), cookie(), ...shellReads()], openAt(`${WEB}{{ $params.path }}`)),
      where(),
      judge([
        check("그 경로에 남아 있다", "{{ $input.path }}", "eq", "{{ $params.path }}"),
        check("404가 아니다", "{{ $node.open.body }}", "notContains", "Not Found"),
        check("404가 아니다(페이지 없음)", "{{ $node.open.body }}", "notContains", "Page not found"),
        check("헤더가 있다", "{{ $node.open.header }}", "notEmpty"),
        check("푸터가 있다", "{{ $node.open.footer }}", "notEmpty"),
        ...noLeak("{{ $node.open.body }}"),
      ]),
    ],
    [{ name: "path", label: "경로", default: "/about", help: "/about · /notices · /builder-apps" }]),
  flow("msuweb-not-found", "MSU 웹 · 없는 경로는 Not Found",
    "01-landing: 없는 경로는 Not Found 로 처리되고 내부 정보를 흘리지 않는다",
    [
      web("open", "없는 경로 열기", [pause(4000), cookie(), ...shellReads()], openAt(`${WEB}/this-page-does-not-exist-e2e`)),
      judge([
        check("Not Found로 안내한다", "{{ $node.open.body }}", "matches", "[Pp]age [Nn]ot [Ff]ound|[Nn]ot [Ff]ound|404"),
        check("404에서도 헤더로 빠져나갈 수 있다", "{{ $node.open.header }}", "notEmpty"),
        ...noLeak("{{ $node.open.body }}"),
      ]),
    ]),
  flow("msuweb-reload-back", "MSU 웹 · 새로고침 · 뒤로가기",
    "01-landing: 새로고침과 뒤로가기 후에도 같은 화면으로 돌아온다 — 새로고침 · 뒤로가기는 동작이 없어 코드로",
    [
      web("open", "메인 → /about", [pause(3000), cookie(), goto(`${WEB}/about`), pause(3000)], openAt(`${WEB}/`)),
      custom("nav", "새로고침 · 뒤로가기", [
        "const header = async () => page.locator('header').first().isVisible().catch(() => false);",
        "await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);",
        "const afterReload = new URL(page.url()).pathname; const headerAfterReload = await header();",
        "await page.goBack({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);",
        "const afterBack = new URL(page.url()).pathname; const headerAfterBack = await header();",
        "const body = await page.locator('body').innerText().catch(() => '');",
        "return { afterReload, headerAfterReload, afterBack, headerAfterBack, body };",
      ], ["afterReload", "headerAfterReload", "afterBack", "headerAfterBack", "body"]),
      judge([
        check("새로고침해도 /about", "{{ $input.afterReload }}", "eq", "/about"),
        check("새로고침 후에도 헤더", "{{ $input.headerAfterReload }}", "isTrue"),
        check("뒤로 가면 메인", "{{ $input.afterBack }}", "eq", "/"),
        check("뒤로가기 후에도 헤더", "{{ $input.headerAfterBack }}", "isTrue"),
        ...noLeak("{{ $input.body }}"),
      ]),
    ]),
);
svc.items.push(
  item("w1", "msuweb-main-visitor", "[01-landing] 비회원 메인 — 헤더 · 푸터 · 로그인 진입점"),
  item("w2", "msuweb-direct-route", "[01-landing] /about 직접 진입", { path: "/about" }),
  item("w3", "msuweb-direct-route", "[01-landing] /notices 직접 진입", { path: "/notices" }),
  item("w4", "msuweb-direct-route", "[01-landing] /builder-apps 직접 진입", { path: "/builder-apps" }),
  item("w5", "msuweb-not-found", "[01-landing] 없는 경로는 Not Found"),
  item("w6", "msuweb-reload-back", "[01-landing] 새로고침 · 뒤로가기"),
);
svc.notes.push(
  "01-landing: 새로고침 · 뒤로가기 · 지금 주소는 웹페이지 동작에 없어 커스텀 노드로",
  "공통: 원본의 settle(네트워크가 조용할 때까지) 대신 고정 3~4초 기다리기",
);

merge(svc, partA, partB);
