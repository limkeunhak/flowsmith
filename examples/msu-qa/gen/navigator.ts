/** Navigator(온체인 탐색기) — 원본 tests/navigator/ */
import { NAV, T, check, click, cookie, custom, fill, flow, goto, item, judge, openAt, pause, press, read, waitUrl, web, where, merge, type Service } from "./lib.ts";
import partA from "./navigator-a.ts";
import partB from "./navigator-b.ts";

/** 헤더 검색 칸 — 본문에도 #form_search_input이 하나 더 보인다. 원본의 .first()가 고르던 쪽 */
export const searchBox = T("헤더 검색 칸", "css", "#global_search_input");
/** 검색은 결과 목록 없이 상세로 바로 간다 — 주소가 바뀌는 것이 끝 */
export const search = (term: string) => [fill(searchBox, term), press(searchBox, "Enter"), waitUrl("/navigator/(nickname|character|nft|owner)/"), pause(2000)];
const statLabel = (s: string) => T(`지표 «${s}»`, "xpath", `(//*[contains(normalize-space(text()),"${s}")])[1]`);
const period = (p: string) => T(`기간 «${p}»`, "xpath", `//button[normalize-space(.)="${p}"]`);

const svc: Service = {
  file: "navigator",
  suite: { name: "MSU QA · Navigator (msu-e2e-test)", description: "msu-e2e-test tests/navigator/의 visitor 시나리오 — 대상 qa.msu.io/navigator" },
  flows: [],
  items: [],
  notes: [],
};
export default svc;

// ── 01-explorer-landing ─────────────────────────────────────────────────────
svc.flows.push(
  flow("navigator-landing-visitor", "Navigator · 비회원 탐색 화면 — 지표 · 검색",
    "01-explorer-landing: 로그인하지 않아도 온체인 지표와 검색이 노출된다(API ≥500 감시는 빠짐)",
    [
      web("open", "Navigator 열기", [pause(5000), cookie(),
        read("wallets", statLabel("Unique Active Wallets")),
        read("tx", statLabel("Transactions (30d)")),
        read("volume", statLabel("Marketplace Trading Volume (30d)")),
        read("txCard", T("Transactions (30d) 카드", "xpath", '(//*[normalize-space(text())="Transactions (30d)"])[1]/..')),
        read("search", searchBox, { strategy: "attribute", attribute: "placeholder" }),
        read("connect", T("헤더의 Connect", "css", 'header button:has-text("Connect")'))], openAt(NAV)),
      where(),
      judge([
        check("제목이 MSU Navigator", "{{ $input.title }}", "contains", "MSU Navigator"),
        check("Unique Active Wallets 지표", "{{ $node.open.wallets }}", "notEmpty"),
        check("Transactions 지표", "{{ $node.open.tx }}", "notEmpty"),
        check("Marketplace Trading Volume 지표", "{{ $node.open.volume }}", "notEmpty"),
        check("Transactions (30d)에 숫자가 있다", "{{ $node.open.txCard }}", "matches", "[0-9]"),
        check("검색 칸이 있다", "{{ $node.open.search }}", "notEmpty"),
        check("헤더에 Connect", "{{ $node.open.connect }}", "contains", "Connect"),
      ]),
    ]),
  flow("navigator-ranking-period", "Navigator · 랭킹 기간 필터",
    "01-explorer-landing: 랭킹 섹션의 기간 필터를 전환하면 선택 상태가 옮겨간다",
    [
      web("open", "기간 바꾸기", [pause(5000), cookie(),
        read("before7", period("7Days"), { strategy: "attribute", attribute: "aria-selected" }),
        read("ranking", T("Highest Price", "xpath", '(//*[contains(normalize-space(.),"Highest Price") and not(*)])[1]')),
        click(period("30Days")), pause(2500),
        read("after30", period("30Days"), { strategy: "attribute", attribute: "aria-selected" }),
        read("after7", period("7Days"), { strategy: "attribute", attribute: "aria-selected" })], openAt(NAV)),
      judge([
        check("기본 선택은 7Days", "{{ $input.before7 }}", "eq", "true"),
        check("랭킹 섹션이 있다", "{{ $input.ranking }}", "notEmpty"),
        check("30Days를 누르면 30Days가 선택", "{{ $input.after30 }}", "eq", "true"),
        check("7Days는 선택이 풀린다", "{{ $input.after7 }}", "eq", "false"),
      ]),
    ]),
);
svc.items.push(
  item("n1", "navigator-landing-visitor", "[01-explorer-landing] 비회원 탐색 화면 — 지표 · 검색"),
  item("n2", "navigator-ranking-period", "[01-explorer-landing] 랭킹 기간 필터"),
);

// ── 03-search ─────────────────────────────────────────────────────────────
svc.flows.push(
  flow("navigator-search-name", "Navigator · 이름 검색 → 상세",
    "03-search: 이름을 검색하면 매칭된 대상의 상세로 이동한다 — 이름은 실행 입력(원본은 화면에서 고름)",
    [
      web("open", "검색", [pause(5000), cookie(), ...search("{{ $params.name }}")], openAt(NAV)),
      where(),
      judge([
        check("상세 페이지로 간다", "{{ $input.url }}", "matches", "/navigator/(nickname|character|nft|owner)/"),
        check("제목이 MSU Navigator", "{{ $input.title }}", "contains", "MSU Navigator"),
      ]),
    ],
    [{ name: "name", label: "검색할 이름", default: "blahh", help: "캐릭터 · 닉네임 · 아이템 이름" }]),
  flow("navigator-search-case", "Navigator · 대소문자 무관 검색",
    "03-search: 대소문자가 달라도 같은 대상으로 검색된다 — 소문자로 바꾸기 · 견주기는 코드로",
    [
      web("asTyped", "입력 그대로 검색", [pause(5000), cookie(), ...search("{{ $params.name }}")], openAt(NAV)),
      custom("firstUrl", "첫 결과 · 소문자", "return { first: decodeURIComponent(page.url()).toLowerCase(), lower: String(ctx.params.name).toLowerCase() };", ["first", "lower"]),
      web("asLower", "소문자로 검색", [goto(NAV), pause(4000), ...search("{{ $input.lower }}")]),
      custom("secondUrl", "둘째 결과", "return { second: decodeURIComponent(page.url()).toLowerCase() };", ["second"]),
      judge([check("소문자 검색도 같은 대상", "{{ $input.second }}", "eq", "{{ $node.firstUrl.first }}")]),
    ],
    [{ name: "name", label: "대소문자 섞인 이름", default: "Blahh" }]),
  flow("navigator-search-address", "Navigator · 지갑 주소 검색 → 소유자 상세",
    "03-search: 지갑 주소를 검색하면 소유자 상세로 이동한다",
    [
      web("open", "주소 검색", [pause(5000), cookie(), ...search("{{ $params.address }}")], openAt(NAV)),
      custom("where", "지금 주소(소문자)", "return { url: page.url().toLowerCase(), want: '/navigator/owner/' + String(ctx.params.address).toLowerCase() };", ["url", "want"]),
      judge([check("소유자 상세로 간다", "{{ $input.url }}", "contains", "{{ $input.want }}")]),
    ],
    [{ name: "address", label: "지갑 주소", default: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", help: "QA 테스트 지갑(Hardhat #1)" }]),
);
svc.items.push(
  item("n3", "navigator-search-name", "[03-search] 이름 검색 → 상세", { name: "blahh" }),
  item("n4", "navigator-search-case", "[03-search] 대소문자 무관 검색", { name: "Blahh" }),
  item("n5", "navigator-search-address", "[03-search] 지갑 주소 검색 → 소유자 상세", { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }),
);
svc.notes.push(
  "01-explorer-landing: /api/navigator/ 응답이 500 이상이면 실패로 보는 API 감시는 빠짐 — 네트워크 응답을 보는 기능이 없다",
  "03-search: 원본은 검색할 캐릭터를 화면에서 고르고 지갑 주소를 .env에서 읽는다 — 여기서는 Suite 입력으로 고정(blahh · Blahh · 0x7099…79C8)",
  "03-search: 소문자로 바꾸기 · 지금 주소는 표현식 · 동작에 없어 커스텀 노드로",
);

merge(svc, partA, partB);
