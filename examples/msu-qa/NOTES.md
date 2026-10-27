# 원본과 다른 것 · 옮기지 못한 것

[gen/](gen/)의 서비스 파일에 적은 것을 모았다(gen/main.ts가 짓는다).

## MSU QA · MSU 웹 (msu-e2e-test)

- 01-landing: 새로고침 · 뒤로가기 · 지금 주소는 웹페이지 동작에 없어 커스텀 노드로
- 공통: 원본의 settle(네트워크가 조용할 때까지) 대신 고정 3~4초 기다리기
- 02-navigation-links: GNB 누르기는 원본처럼 하이드레이션 전 클릭을 한 번 더 눌러 보지 않는다 — 대신 4초 기다린 뒤 누른다
- 02-navigation-links: «정확히 1개»(NEW 배지 · 정책 링크)는 엔진 규칙에 기댄다 — 0개면 불통과, 2개 이상이면 오류로 남는다
- 02-navigation-links: MSU Space 메뉴는 마우스 올리기 동작이 없어 커스텀 노드로 올리고 항목 수를 센다
- 03-responsive: 원본 drawerLink(nav a 중 보이는 첫째)는 모바일에서 늘 보이는 푸터 nav의 ABOUT 등을 골라 햄버거를 안 열어도 통과한다 — 여기서는 footer 안 nav를 빼고 찾는다
- 03-responsive: 원본은 처음부터 그 크기의 컨텍스트로 연다 — 여기서는 기본 크기로 연 뒤 커스텀 노드로 크기를 바꾸고 다시 연다(웹페이지 노드에 화면 크기가 없다)
- 04-notices: «공지가 하나는 있다»(count > 0)는 첫 공지 링크를 읽어 갈음한다 — 공지 수는 세지 않는다
- 04-notices: 공지 제목은 원본의 «링크 글자 첫 줄» 대신 링크 안 h4 를 읽는다
- 09-accessibility: Tab 순서 · 초점 · 이미지 alt 훑기는 웹페이지 동작에 없어 커스텀 노드로 — Enter 는 동작(누르기)으로
- 05-content-failure: 요청 가로채기(page.route) · 공지 수 · 가로 넘침은 동작에 없어 커스텀 노드로. 첫 이동 전에 막아야 하는 셋은 커스텀 노드가 막고 직접 연다
- 05-content-failure «상세 이동용 요청…»: 원본은 waitForURL(href)로 주소를 확인 — 여기선 커스텀 노드가 /notices/<숫자>를 30초 기다리고(못 와도 멈추지 않음) 경로가 고른 href와 같은지 검사로 — 못 오면 오류가 아니라 불통과
- 05-content-failure «상세 이동용 요청…»: 제목은 목록에도 있어 «글이 보인다»만으로는 상세인지 못 가린다 — 주소 검사가 함께 있어야 의미가 있다(원본도 waitForURL이 그 몫)
- 05-content-failure «일시적으로 실패한 뒤…»: 원본은 https://msu.io/notices(운영)를 직접 열었다 — 여기선 qa.msu.io/notices
- 06-profile-layer: toHaveCount(0)은 숨은 요소도 세야 해서 개수만 커스텀 노드로(«있을 때만» 읽기는 보이는 것만 본다)
- 08-cookie-consent: CookieConsent 쿠키 읽기는 동작에 없어 커스텀 노드로. 배너 «닫힘»은 «있을 때만» 읽어 빈 값인지로(원본은 toBeHidden 15초 — 여기선 고정 2~2.5초 뒤 한 번)
- 08-cookie-consent «전체 동의…»: 원본은 같은 컨텍스트에 새 탭을 열어 /notices — 여기선 같은 탭에서 이동(쿠키는 같은 세션)
- 08-cookie-consent «처음 방문…» · «전체 거부…»: 버튼은 원본처럼 페이지 전체에서 찾되 보이는 것만(:visible — 숨은 설정 창에도 Reject All 이 있다)
- 08-cookie-consent «새 세션…»: 두 번째 세션은 커스텀 노드가 같은 브라우저에 새 컨텍스트를 열어 확인
- 08-cookie-consent «설정에서 고른…»: 원본은 check({ force: true }) — 여기선 보통 켜기(칸이 보여서 된다)

## MSU QA · 마켓플레이스 (msu-e2e-test)

- 04-bookmark: 원본은 토큰을 .env MSU_NFT_TOKEN_ID에서 읽는다 — QA에서 열리는 NFT(Neophyte Ring #131, 8467…8978)를 Suite 입력으로 고정
- 03 · 04 · 05 · 09: 로그인 상태(localStorage msu_auth_store) · 지금 주소는 웹페이지 동작에 없어 커스텀 노드로
- 05-explore-tabs: 원본의 «20초까지 기다리며 다시 보기»(expect.poll) 대신 탭마다 고정 6초 기다린 뒤 읽기
- 06 · 09: «결과가 모두 검색어를 포함»은 견주는 법에 «모두»가 없어 커스텀 노드가 벗어난 이름을 골라 «0개»로 본다
- 09-search-filters: explore/items 요청 감시는 커스텀 노드가 page에 듣개를 달아 모은다(네트워크를 보는 동작이 없다)
- 03-p2p-trade-flow: 제목과 달리 원본도 거래 이력(Trade History)은 보지 않는다 — 원본 expect(주소 · 제목 · 이름)만 옮김. 판매 중 매물이 없으면 첫 카드 읽기에서 오류(원본도 시간 초과)
- 05-explore-tabs: Connect 버튼은 헤더 안으로 좁혔다(원본은 페이지 전체의 첫 «Connect»)
- 공통: 원본의 networkidle · settle 대신 고정 4~6초 기다리기

## MSU QA · Swap & Warp (msu-e2e-test)

- 01 · 04: 로그인 상태(localStorage msu_auth_store) · 지금 주소는 웹페이지 동작에 없어 커스텀 노드로
- 04-transaction-filters: 조회 요청 쿼리 · 응답 본문 확인은 커스텀 노드가 page에 응답 듣개를 달아 모은다(네트워크를 보는 동작이 없다)
- 04-transaction-filters: «모두 그 지갑 · 그 방향»은 견주는 법에 «모두»가 없어 커스텀 노드가 벗어난 것을 골라 «0개»로 본다
- 공통: 원본의 settle · waitForTransactions 대신 고정 3~6초 기다리기

## MSU QA · Navigator (msu-e2e-test)

- 01-explorer-landing: /api/navigator/ 응답이 500 이상이면 실패로 보는 API 감시는 빠짐 — 네트워크 응답을 보는 기능이 없다
- 03-search: 원본은 검색할 캐릭터를 화면에서 고르고 지갑 주소를 .env에서 읽는다 — 여기서는 Suite 입력으로 고정(blahh · Blahh · 0x7099…79C8)
- 03-search: 소문자로 바꾸기 · 지금 주소는 표현식 · 동작에 없어 커스텀 노드로
- 04 · 06 · 07: 원본은 캐릭터를 랜딩 Character Rankings에서 먼저 찾지만 QA는 비어 있어 아이템 랭킹 → 소유자 → Character 목록 길만 옮김(커스텀 노드 «찾기»). 랭킹이 다시 차도 이 길로 찾는다
- 06-owner-listing: 원본은 캐릭터를 거쳐 2페이지 이상 지갑을 찾는다 — 여기선 아이템 랭킹 소유자 중 More가 보이는 지갑. 응답 건수 세기 · More 반복 · 링크 세기는 코드로
- 06-owner-listing «More …»: 원본은 More가 남으면 «아직 덜 불러옴»도 허용하지만, 예산(보유/첫 응답+3회) 안에 사라져야 한다로 좁힘
- 06-owner-listing «탭을 전환했다 …»: 원본은 DOM 링크 수를 견주지만 가상 스크롤이라 스크롤 위치에 따라 줄어(실측 불러온 뒤 26 · 복귀 뒤 12, 훑으면 둘 다 38) 위에서 아래로 훑은 서로 다른 캐릭터 수로 견줌. «≥ 또는 More»는 검사 노드에 «또는»이 없어 코드가 낸 참/거짓을 본다
- 05-not-found: /api/navigator/ 응답 500 이상 감시(NFT · 지갑 주소는 실패, 캐릭터는 NAV-1 기록)는 빠짐 — 네트워크 응답을 보는 기능이 없다. 404 · 빈 상세 기록(recordDetail)도 판정이 아니라 빠짐
- 05-not-found: 404는 원본처럼 30초까지 기다리지 않고 8초 뒤 2초 동안 찾는다
- 09-watchlist: member 시나리오 2개(등록 · 해제)는 로그인 지갑이 필요해 이 Suite(visitor)에서 빠짐. 툴팁(호버)은 코드로
- 10-ranking: 요청 엿보기(page.on('request')) · 응답 본문(waitForResponse) · 링크 수 세기는 동작에 없어 커스텀 노드로. 기간 누르기도 엿보기와 한 몸이라 코드 안에서
- 10-ranking «랭킹 보드가 노출되고…»: 서버 응답을 잡으려고 랜딩을 한 번 더 불러온다(reload). 원본의 갈래(랭킹 있음 → 캐릭터 열기 · 없음 → View All)는 코드가 «해당 갈래가 어긋났나»를 true/false로 내고 검사가 본다 — QA는 캐릭터 랭킹이 비어 View All 쪽만 탄다
- 11-activity-history: 열 · 거래 종류는 표 읽기로. «모두 아는 종류» · «Mint만» · 결과 견주기는 연산이 없어 커스텀 노드가 목록을 글자로 접는다. 지금 주소도 코드로
- 11-activity-history «거래 종류를 고르면…»: QA에서 «Mint 내역은 그대로 남아야 한다»가 불통과 — Mint+Sale 표 첫 쪽 30행이 모두 Sale이고 Mint는 More 뒤 쪽에 있다. 원본도 첫 쪽만 보므로 똑같이 깨진다(제품 결함보다 원본 가정 문제로 보임) — 검사는 그대로 둔다
- 11-activity-history «History 탭…»: 후보 5개를 차례로 여는 반복 · 갈래는 코드로. 갈래 검사는 «해당 갈래가 어긋났나»를 true/false로 낸다 — QA 랭킹 아이템은 모두 이력이 없어 «No history» 쪽만 탄다
- 12-nickname-detail: 원본은 랭킹 캐릭터 → 보유 지갑을 훑어 닉네임 가진 지갑을 찾는다 — QA 캐릭터 랭킹이 비어 지갑을 Suite 입력으로 고정(0x18B8…4292). 닉네임은 그 지갑 Nicknames 탭의 첫 링크에서 읽는다
- 13-links-and-a11y: 링크 목록 · 이미지 alt 훑기는 여러 요소를 세는 일이라 커스텀 노드로(원본도 evaluate). axe-core는 원본도 쓰지 않는다
- 13-links-and-a11y «화면에 보이는 이미지…»: 원본은 캐릭터를 랭킹(비면 아이템 소유자)에서 고른다 — QA 캐릭터 랭킹이 비어 Suite 입력으로 고정(CHARd0311…, blahh)
- 13-links-and-a11y «마켓플레이스…»: 마켓플레이스 점검 화면 감지(assertServiceAvailable)는 빠짐
- 14-responsive: 화면 크기 바꾸기 · 가로 넘침은 동작에 없어 커스텀 노드로 — 원본은 처음부터 그 크기의 창을 열지만 여기서는 열고 나서 크기를 바꾸고 다시 불러온다
- 14-responsive «모바일에서도 검색…»: 원본은 검색어(캐릭터 이름)를 화면에서 고른다 — QA 캐릭터 랭킹이 비어 Suite 입력으로 고정(blahh). 원본의 Enter 재시도 1회는 없음

## MSU QA · 거래 (msu-e2e-test)

- 03-p2p-trade-flow: QA 지갑 키 둘은 팀 공용 값(시크릿 msu_qa_wallet_a · _b)에 한 번 넣는다 — 워크플로우 입력에 키를 넣지 않는다 · 지갑 주소 둘은 Suite 입력 · 화면 있는 워커에서 돌린다
- 03-p2p-trade-flow: 지갑 설정의 QA 체인 MSUQA(807424 · qa-testnet-rpc.msu.io)를 MetaMask에 먼저 더하고 그 체인의 거래만 누른다(원본 지갑 준비와 같게)
- 03-p2p-trade-flow: 구매 재시도는 한 번(원본: 20초 간격 · 5분까지) — 지휘가 구매 부품을 다시 부른다(앞에서 샀으면 건너뜀). 구매 승인은 «지갑 승인 화면 하나 이상»을 받아야 끝으로 친다
- 03-p2p-trade-flow: 구매 승인의 끝 표시는 «구매 확인 창이 닫힘» — 원본은 판매자 화면으로 소유권을 보며 승인했다. 소유권은 다음 부품(trade-p2p-owned)이 따로 본다
- 03-p2p-trade-flow: 인벤토리의 토큰 id 읽기 · 다시 읽기 · 등록 뒤 대기는 커스텀 노드로 — 위치에 표현식을 쓸 수 없어 «이 토큰 id가 목록에 있나»를 동작으로 못 적는다
