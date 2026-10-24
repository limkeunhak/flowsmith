/**
 * **API 설명** — 길마다 무리(tag) · 한 줄 요약 · 입력. OpenAPI 명세(openapi.ts)가 실제 등록된 길과 이것을 합친다.
 *
 * ★열쇠는 「방식 주소」(라우터에 적은 그대로). 길을 더하면 여기도 한 줄 — 빠지면 시험(test/openapi.test.ts)이 잡는다.
 *  body · query의 이름 앞 «*»는 꼭 줘야 하는 것.
 */

export interface RouteDoc {
  tag: string;
  summary: string;
  description?: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
  /** «Try it out»에 미리 채울 본문 */
  example?: unknown;
  /** 성공 상태(기본 200) */
  ok?: number;
  /** 응답이 JSON이 아니면 */
  produces?: "sse" | "file";
  /** ETag를 주고 If-None-Match가 맞으면 304 */
  etag?: boolean;
}

export const TAGS: { name: string; description: string }[] = [
  { name: "워크플로우", description: "워크플로우 · 초안 · 버전 · 게시 · 시크릿" },
  { name: "실행", description: "실행하고 · 지켜보고 · 멈춘다" },
  { name: "점검", description: "변경 감시 — 사이트가 바뀌었나" },
  { name: "트리거", description: "웹훅" },
  { name: "파일", description: "파일 쓰기 노드가 저장한 파일" },
  { name: "알림", description: "보낸 알림 · 시험 보내기" },
  { name: "대시보드", description: "실행 · 실패율 · 오류 숫자" },
  { name: "워커", description: "실행을 받아 가는 PC · 어디서 돌리나" },
  { name: "사람 · 팀", description: "관리자 — 사람 · 역할 · 팀" },
  { name: "Suite(테스트)", description: "웹 e2e 테스트 묶음 — 시나리오(게시된 워크플로우)를 차례로 돌려 통과 · 불통과 · 오류를 판정한다" },
  { name: "팀 공용 값", description: "여러 워크플로우가 함께 쓰는 변수 · 시크릿 — 워크플로우는 제 팀 → 공용 차례로 찾는다" },
  { name: "로그인", description: "로그인 · 내 비밀번호" },
  { name: "API 토큰", description: "밖에서 API를 부를 때 쓰는 토큰(Authorization: Bearer fsa_…)" },
  { name: "AI", description: "AI로 워크플로우 만들기 — 서버가 키를 쥐고 모델을 대신 부른다(PLAN §42)" },
  { name: "확장 플러그인", description: "확장 노드 묶음(.fspkg) — 올리기 · 켜기/끄기 · 버전 바꾸기 · 사내 저장소(PLAN §41)" },
  { name: "API", description: "이 명세" },
];

const FLOW_EXAMPLE = { schemaVersion: 1, id: "order-status", name: "주문 상태 확인", nodes: [], edges: [] };

export const DOCS: Record<string, RouteDoc> = {
  // ── 플로우
  "GET /api/extensions": { tag: "워크플로우", summary: "설치된 확장 노드 목록" },
  "GET /api/flows": { tag: "워크플로우", summary: "워크플로우 목록", description: "내가 볼 수 있는 워크플로우만(내 팀 · 공용). 마지막 실행 · 감시 · 문제 수 · 일정이 함께 온다." },
  "POST /api/flows": { tag: "워크플로우", summary: "새 워크플로우", body: { "*draft": "워크플로우 초안(JSON)", team: "둘 팀 id — 없으면 공용" }, example: { draft: FLOW_EXAMPLE, team: null }, ok: 201 },
  "GET /api/flows/:id": { tag: "워크플로우", summary: "워크플로우 하나 — 초안 · 문제 · 버전들 · 게시된 버전" },
  "PUT /api/flows/:id/draft": { tag: "워크플로우", summary: "초안 저장", description: "틀려 있어도 저장된다(편집 중). 실행 · 게시는 문제가 없어야 한다.", body: { "*draft": "워크플로우 초안(JSON)" }, example: { draft: FLOW_EXAMPLE } },
  "DELETE /api/flows/:id": { tag: "워크플로우", summary: "워크플로우 지우기", ok: 204 },
  "PUT /api/flows/:id/team": { tag: "워크플로우", summary: "팀 옮기기", body: { "*team": "팀 id — 공용이면 null" }, example: { team: null } },
  "POST /api/flows/:id/versions": { tag: "워크플로우", summary: "초안을 버전으로 굳힌다", description: "검문소를 통과해야 한다. 마지막 버전과 같으면 만들지 않는다.", body: { note: "메모" }, example: { note: "" }, ok: 201 },
  "GET /api/flows/:id/versions/:v": { tag: "워크플로우", summary: "그 버전의 매니페스트" },
  "PUT /api/flows/:id/pins/:nodeId": { tag: "워크플로우", summary: "노드 출력 고정(pin data)", description: "초안 시험에서 그 노드는 돌지 않고 이 값을 내놓는다(게시된 버전 · 일정 · 웹훅은 늘 진짜로). 버전에 들어가지 않는다.", body: { "*output": "그 노드가 내놓을 값(객체)" }, example: { output: { status: "배송중" } } },
  "DELETE /api/flows/:id/pins/:nodeId": { tag: "워크플로우", summary: "노드 출력 고정 풀기" },
  "GET /api/flows/:id/published": {
    tag: "워크플로우", summary: "게시된 버전 한 번에(밖에서 받아 갈 때)", etag: true,
    description: "버전 · 메모 · 만든 사람 · 게시한 때 · 게시한 사람 · 매니페스트(검문소를 통과한 모양). 초안은 오지 않는다.\n\n" +
      "`ETag`가 붙는다 — 받아 둔 것을 `If-None-Match`로 보내면 안 바뀌었을 때 **304**(본문 없음). 옛 버전으로 되돌려 게시하면 ETag가 바뀐다.\n\n" +
      "게시하지 않았거나 내렸으면 **404 `reason: \"not-deployed\"`** — 받아 둔 것도 쓰지 말라는 뜻이다(깨진 판을 일부러 내렸을 수 있다). `reason`이 없는 404는 없는 워크플로우(남의 팀 것도).",
  },
  "POST /api/flows/:id/deploy": { tag: "워크플로우", summary: "게시 · 내리기", body: { "*version": "게시할 버전 번호 — 내리면 null" }, example: { version: 1 } },
  "GET /api/flows/:id/secrets": { tag: "워크플로우", summary: "시크릿 — 이름 · 종류 · 저장됐나", description: "값은 오지 않는다." },
  "PUT /api/flows/:id/secrets/:name": { tag: "워크플로우", summary: "시크릿 값 넣기", description: "잠가 둔다 — 다시 보이지 않는다.", body: { "*value": "글자, 또는 { username, password }" }, example: { value: { username: "kim", password: "…" } } },
  "DELETE /api/flows/:id/secrets/:name": { tag: "워크플로우", summary: "시크릿 값 지우기", ok: 204 },

  // ── 실행
  "POST /api/flows/:id/runs": {
    tag: "실행", summary: "실행하기", ok: 202,
    description: "뒤에서 돈다 — runId가 바로 온다. 진행은 /api/runs/{runId}/events(SSE), 결과는 /api/runs/{runId}.",
    body: { version: "버전 번호 · \"draft\"(초안) — 없으면 게시된 버전", params: "실행 입력 { 이름: 값 }", on: "이번만 어디서 — \"server\" · \"worker:<id>\" · \"label:<라벨>\"", stopBefore: "초안을 이 노드 앞까지", stopAfter: "초안을 이 노드까지", resetWallet: "지갑 브라우저 — true면 그 지갑의 프로필을 지우고 처음부터 준비한 뒤 돈다(«지갑 다시 준비»)" },
    example: { params: {} },
  },
  "GET /api/flows/:id/runs": { tag: "실행", summary: "최근 실행들", description: "결과 본문은 없다.", query: { limit: "몇 개(기본 50)" } },
  "GET /api/runs/:runId": { tag: "실행", summary: "실행 기록 하나 — 노드마다의 입력 · 출력 · 실패 까닭" },
  "GET /api/runs/:runId/events": { tag: "실행", summary: "진행 흘려 받기(SSE)", description: "node:start · step · log · node:end · run:queued · run:placed · run:end. 지난 것부터 다시 보낸다.", produces: "sse" },
  "GET /api/runs/:runId/shot": { tag: "실행", summary: "검사 불통과 스크린샷", description: "검사 노드가 불통과였을 때 그때의 페이지 한 장(JPEG). 없으면 404 — 통과 · 오류에는 찍지 않는다.", produces: "file" },
  "GET /api/runs/:runId/approval": { tag: "실행", summary: "기다리는 승인", description: "이 실행이 «승인 기다리기» 노드에서 기다리면 안내 · 누가(역할) · 언제까지. 아니면 null." },
  "POST /api/runs/:runId/approval": { tag: "실행", summary: "승인 · 거절", description: "노드가 정한 역할(minRole) 이상만. 거절하면 그 노드가 실패해 실행이 멈춘다. 기다리지 않으면 409.", body: { "*approved": "true 승인 · false 거절", comment: "한마디(기록에 남는다 · 500자까지)" }, example: { approved: true, comment: "확인했습니다" } },
  "GET /api/approvals": { tag: "실행", summary: "승인을 기다리는 실행들", description: "내가 볼 수 있는 워크플로우의 것만 — 오래 기다린 차례로." },
  "POST /api/runs/:runId/rerun": { tag: "실행", summary: "같은 입력으로 다시 실행", description: "그 실행의 입력 · 버전 그대로(초안으로 돈 실행이면 **지금** 초안 — 편집자 이상). 새 runId가 바로 온다.", ok: 202 },
  "POST /api/runs/:runId/cancel": { tag: "실행", summary: "멈추기", description: "그 실행이 부른 실행도 함께. 돌고 있지 않으면 409.", ok: 202 },

  // ── 점검
  "GET /api/flows/:id/probes": { tag: "점검", summary: "변경 감시 기록" },
  "POST /api/flows/:id/probes": { tag: "점검", summary: "지금 점검", description: "되돌릴 수 없는 동작 앞에서 멈추고, 요소가 녹화 때와 같은지 본다.", body: { version: "버전 번호 · \"draft\" — 없으면 게시된 버전" }, example: {}, ok: 202 },
  "GET /api/probes/:id": { tag: "점검", summary: "점검 하나(보고서)" },

  // ── 트리거
  "GET /api/flows/:id/webhook": { tag: "트리거", summary: "웹훅이 켜져 있나", description: "토큰은 오지 않는다." },
  "POST /api/flows/:id/webhook": { tag: "트리거", summary: "웹훅 켜기 · 토큰 새로", description: "토큰은 이때 한 번만 온다.", ok: 201 },
  "DELETE /api/flows/:id/webhook": { tag: "트리거", summary: "웹훅 끄기", ok: 204 },
  "POST /api/hooks/:id": {
    tag: "트리거", summary: "웹훅으로 실행", ok: 202,
    description: "로그인 없이 웹훅 토큰으로 — x-flowsmith-token 헤더 · Authorization: Bearer · ?token=. 본문의 값이 실행 입력이 된다. ?wait=1이면 결과까지 기다린다.",
    query: { token: "웹훅 토큰(헤더 대신)", wait: "1이면 끝날 때까지 기다려 결과를 준다" },
    example: { orderNo: "A-1001" },
  },

  // ── 파일
  "GET /api/files": { tag: "파일", summary: "폴더 보기", query: { dir: "파일 뿌리 아래 폴더", flow: "워크플로우 id — 그 워크플로우의 폴더", scope: "flow · shared" } },
  "DELETE /api/files": { tag: "파일", summary: "파일 지우기", query: { "*path": "파일 경로" }, ok: 204 },
  "GET /api/files/preview": { tag: "파일", summary: "파일 앞부분(64KB)", query: { "*path": "파일 경로" } },
  "GET /api/files/download": { tag: "파일", summary: "내려받기", query: { "*path": "파일 경로", as: "xlsx — 엑셀로 바꿔서" }, produces: "file" },

  // ── 알림
  "GET /api/notify/config": { tag: "알림", summary: "이 서버가 메일을 보낼 수 있나" },
  "GET /api/flows/:id/notices": { tag: "알림", summary: "보낸 알림(최근 30개)", description: "주소는 오지 않는다." },
  "POST /api/flows/:id/notify/test": { tag: "알림", summary: "시험 알림 보내기", body: { "*rule": "알림 규칙(워크플로우 설정의 notify 하나)" } },

  // ── 대시보드
  "GET /api/dashboard": { tag: "대시보드", summary: "실행 · 실패율 · 날마다 · 노드 종류 · 오류", query: { days: "기간 1~90(기본 7)", flow: "워크플로우 하나만" } },

  // ── 워커
  "GET /api/workers": { tag: "워커", summary: "워커들 — 연결 · 도는 실행 · 줄 · 라벨" },
  "POST /api/workers": { tag: "워커", summary: "워커 더하기", description: "토큰은 이때 한 번만 온다.", body: { "*name": "이름", labels: "라벨 — 쉼표로", slots: "동시 실행 수(1~20)", team: "팀 전용이면 팀 id" }, example: { name: "김담당 PC", labels: "주문팀", slots: 1 }, ok: 201 },
  "PUT /api/workers/:id": { tag: "워커", summary: "워커 고치기 · 잠시 끄기", body: { name: "이름", labels: "라벨", slots: "동시 실행 수", enabled: "false면 잠시 끔" }, example: { enabled: false } },
  "POST /api/workers/:id/token": { tag: "워커", summary: "워커 토큰 새로", description: "옛 토큰으로 붙어 있던 연결은 끊긴다." },
  "DELETE /api/workers/:id": { tag: "워커", summary: "워커 지우기", description: "이 워커에서 도는 워크플로우가 있으면 409.", ok: 204 },
  "PUT /api/flows/:id/run-on": { tag: "워커", summary: "어디서 돌리나", body: { "*on": "null(서버) · \"worker:<id>\" · \"label:<라벨>\"" }, example: { on: null } },

  // ── 사람 · 팀
  "GET /api/users": { tag: "사람 · 팀", summary: "사람들" },
  "POST /api/users": { tag: "사람 · 팀", summary: "사람 들이기", description: "임시 비밀번호는 이때 한 번만 온다.", body: { "*email": "메일", "*name": "이름", "*role": "admin · editor · runner · viewer" }, example: { email: "kim@example.com", name: "김담당", role: "viewer" }, ok: 201 },
  "PUT /api/users/:id": { tag: "사람 · 팀", summary: "역할 · 이름 · 끄기", body: { name: "이름", role: "역할", disabled: "true면 끔" } },
  "POST /api/users/:id/reset": { tag: "사람 · 팀", summary: "임시 비밀번호 새로", description: "그 사람의 로그인을 끊는다." },
  "GET /api/teams": { tag: "사람 · 팀", summary: "팀들 — 사람 · 워크플로우 수" },
  "POST /api/teams": { tag: "사람 · 팀", summary: "팀 만들기", body: { "*name": "팀 이름" }, example: { name: "주문팀" }, ok: 201 },
  "PUT /api/teams/:id": { tag: "사람 · 팀", summary: "팀 이름 바꾸기", body: { "*name": "팀 이름" } },
  "DELETE /api/teams/:id": { tag: "사람 · 팀", summary: "팀 지우기", description: "워크플로우가 남아 있으면 409.", ok: 204 },
  "PUT /api/teams/:id/members/:uid": { tag: "사람 · 팀", summary: "팀에 사람 넣기" },
  "DELETE /api/teams/:id/members/:uid": { tag: "사람 · 팀", summary: "팀에서 사람 빼기" },

  // ── 로그인
  "GET /api/auth/me": { tag: "로그인", summary: "나 — 로그인했나 · 역할 · 팀" },
  "POST /api/auth/setup": { tag: "로그인", summary: "첫 관리자 만들기", description: "사람이 하나도 없을 때만 — 서버를 띄울 때 콘솔에 찍힌 설정 토큰으로.", body: { "*token": "설정 토큰", "*email": "메일", "*name": "이름", "*password": "비밀번호(8자 이상)" } },
  "POST /api/auth/login": { tag: "로그인", summary: "로그인(메일 · 비밀번호)", body: { "*email": "메일", "*password": "비밀번호" } },
  "POST /api/auth/logout": { tag: "로그인", summary: "로그아웃", ok: 204 },
  "POST /api/auth/password": { tag: "로그인", summary: "내 비밀번호 바꾸기", description: "다른 로그인은 끊는다.", body: { "*current": "지금 비밀번호", "*next": "새 비밀번호" } },

  // ── Suite(테스트)
  "GET /api/suites": { tag: "Suite(테스트)", summary: "Suite 목록", description: "내가 볼 수 있는 것만(팀 · 공용) — 마지막 실행 · 지금 도는지." },
  "POST /api/suites": { tag: "Suite(테스트)", summary: "Suite 만들기", body: { "*name": "이름", team: "팀 id(없으면 공용)" }, example: { name: "주문 조회 회귀" }, ok: 201 },
  "GET /api/suites/:id": { tag: "Suite(테스트)", summary: "Suite 하나", description: "시나리오 · 일정 · 알림 + 최근 실행 30개." },
  "PUT /api/suites/:id": { tag: "Suite(테스트)", summary: "Suite 고치기", description: "준 것만 바꾼다. 시나리오의 워크플로우는 같은 팀이거나 공용이어야 한다.", body: { name: "이름", description: "설명", team: "팀 id · null(공용)", items: "[{ id, flowId, label, params, enabled }] — 차례대로", schedules: "[{ id, cron, enabled }]", notify: "[{ id, channel, url, on: [failure|recovered|success], enabled }]" } },
  "DELETE /api/suites/:id": { tag: "Suite(테스트)", summary: "Suite 지우기", description: "실행 기록도 함께. 돌고 있으면 409.", ok: 204 },
  "POST /api/suites/:id/runs": { tag: "Suite(테스트)", summary: "Suite 돌리기", description: "item이 없으면 켜 둔 시나리오 전체를 차례로(하나가 실패해도 계속) · 있으면 그 시나리오 하나만. 게시된 버전을 돈다. 이미 돌고 있으면 409.", body: { item: "시나리오 id(단건)" }, ok: 202 },
  "GET /api/suite-runs/:id": { tag: "Suite(테스트)", summary: "Suite 실행 하나", description: "상태(running · pass · fail · error · cancelled)와 시나리오마다의 판정(통과 · 불통과 · 오류) · 실행 id · 검사 수." },
  "POST /api/suite-runs/:id/cancel": { tag: "Suite(테스트)", summary: "Suite 멈추기", description: "지금 도는 시나리오를 멈추고 남은 것은 돌리지 않는다.", ok: 202 },
  // ── 팀 공용 값
  "GET /api/shared": { tag: "팀 공용 값", summary: "팀 공용 값 목록", description: "변수는 값까지 · 시크릿은 있다/없다 · 종류 · 설명만(값은 나가지 않는다). flow를 주면 그 워크플로우가 닿는 범위(제 팀 · 공용)만.", query: { flow: "워크플로우 id" } },
  "PUT /api/shared/:scope/:kind/:name": { tag: "팀 공용 값", summary: "팀 공용 값 넣기", description: "scope는 팀 id 또는 `_`(공용) · kind는 vars · secrets. 시크릿은 { kind: text|login, value } — 넣기만, 다시 읽을 수 없다.", body: { "*value": "변수는 글자 · text 시크릿은 글자 · login 시크릿은 { username, password, extra? }", kind: "시크릿의 종류 — text · login", description: "설명" }, example: { value: "https://portal.example.com", description: "주문 관리 화면 주소" } },
  "DELETE /api/shared/:scope/:kind/:name": { tag: "팀 공용 값", summary: "팀 공용 값 지우기", ok: 204 },

  // ── API 토큰 · 명세
  "GET /api/tokens": { tag: "API 토큰", summary: "내 API 토큰들", description: "토큰 값은 오지 않는다 — 이름 · 역할 · 마지막으로 쓴 때 · 끝나는 날." },
  "POST /api/tokens": {
    tag: "API 토큰", summary: "API 토큰 만들기", ok: 201,
    description: "토큰은 이때 한 번만 온다. 역할은 내 역할 이하. ★API 토큰으로는 토큰을 만들 수 없다(화면에서 로그인해 만든다).",
    body: { "*name": "어디에 쓰는지", role: "admin · editor · runner · viewer — 없으면 내 역할", days: "며칠 쓸지(1~365) — 없으면 끝나지 않음" },
    example: { name: "사내 대시보드", role: "viewer", days: 90 },
  },
  "DELETE /api/tokens/:id": { tag: "API 토큰", summary: "API 토큰 지우기", description: "그 순간부터 쓸 수 없다.", ok: 204 },
  // ── 확장 플러그인
  "GET /api/plugins": { tag: "확장 플러그인", summary: "플러그인들 · 서버에 고정된 확장 · 서명 정책 · 사내 저장소 · 최근 기록" },
  "POST /api/plugins": { tag: "확장 플러그인", summary: "묶음(.fspkg) 올리기", description: "본문은 묶음 파일 그대로(application/octet-stream). 모양 · 해시 · 서명을 보고 불러 본 뒤 그 버전으로 켠다. 같은 버전 · 다른 내용은 409.", ok: 201 },
  "PUT /api/plugins/:id": { tag: "확장 플러그인", summary: "켜기 · 끄기 · 버전 바꾸기(되돌리기)", body: { enabled: "켜기/끄기", version: "올려 둔 버전 중 하나" }, example: { version: "1.0.0" } },
  "DELETE /api/plugins/:id": { tag: "확장 플러그인", summary: "플러그인 지우기", description: "그 노드를 쓰는 워크플로우가 있으면 409(끄기는 된다).", ok: 204 },
  "PUT /api/plugins-source": { tag: "확장 플러그인", summary: "사내 저장소 주소", body: { url: "index.json 주소 — 빈 값이면 지움" }, example: { url: "https://repo.example/flowsmith-plugins/index.json" } },
  "POST /api/plugins-source/check": { tag: "확장 플러그인", summary: "새 버전 확인 — 저장소의 묶음마다 깔려 있나 · 더 새것인가" },
  "POST /api/plugins-source/install": { tag: "확장 플러그인", summary: "저장소에서 받아 올리기", body: { "*id": "플러그인 id", "*version": "버전" }, example: { id: "shop", version: "1.0.0" }, ok: 201 },
  // ── AI
  "GET /api/ai": { tag: "AI", summary: "켜 둠 · 키가 있나(값은 안 나감) · 모델 · 최근 30일 쓴 양" },
  "PUT /api/ai": { tag: "AI", summary: "AI 설정(관리자)", body: { apiKey: "Anthropic API 키 — 빈 글자면 지움", model: "모델", enabled: "켜기/끄기" }, example: { model: "claude-opus-5-5", enabled: true } },
  "POST /api/ai/messages": { tag: "AI", summary: "모델에 묻기(편집자)", description: "Anthropic Messages 모양(system · messages · tools)을 그대로 보내고 답을 그대로 받는다. 도구 반복은 화면이 돌린다. 머리글 x-flowsmith-ai-key에 내 키(«내 설정»)를 실으면 그것으로 — 서버는 저장하지 않는다. x-flowsmith-ai-provider(anthropic · gemini)와 x-flowsmith-ai-model로 AI · 모델을 고른다(Gemini는 서버가 바꿔 부르고 같은 모양으로 돌려준다).", body: { "*system": "시스템 글", "*messages": "대화", tools: "도구", flowId: "어느 워크플로우에서" } },
  "GET /api/openapi.json": { tag: "API", summary: "이 명세(OpenAPI 3.0)" },
};
