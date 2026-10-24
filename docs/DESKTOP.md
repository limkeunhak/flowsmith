# 데스크톱 앱 · 지갑 브라우저 — 설계 (2026-10-24)

사용자: «데스크톱 애플리케이션으로 만드는 건 어때? 웹컨텐츠뷰로 브라우저를 띄우고» · «메타마스크 로그인 — 사람 기다리기로도, 테스트 계정의 키를 넣어서도».
정함: **앱 하나, 브라우저 둘** · 앱은 **로컬 모드와 회사 서버 모드 둘 다** · **Windows 먼저**.

PLAN 결정 1(라이브 패널 A → B)의 B를 고른 것이다. 레코더 핵심 · 녹화 메시지 · 엔진은 그대로 두고, 브라우저를 대는 자리와 표시 방식만 더한다(§4.3).

---

## 1. 왜 브라우저가 둘인가 — 실험으로 정했다 (2026-10-24)

| 확인한 것 | 크롬(Chrome for Testing) + MetaMask 13.0.0 · 창 있음 | Electron 44 WebContentsView + MetaMask 13.0.0 | 페이지에 넣는 테스트 지갑(§40) |
|---|---|---|---|
| 로그인 창(msu.io)의 «MetaMask Installed» | ✅ | ✅ | ❌ 목록에 안 나온다 |
| MetaMask가 켜지나 | ✅ | ❌ 백그라운드가 켜지자마자 죽는다(`chrome.windows` · `tabs`가 없다) | — |
| 체인 추가 · 전환 승인 | ✅ 자동으로 눌렀다 | ❌ | — |
| 연결 승인 | ✅ 자동으로 눌렀다 | ❌ 화면이 안 생긴다 | — |

- 사이트의 MetaMask SDK는 EIP-6963 알림이 아니라 **확장과 직접 통신**(`externally_connectable`)해서 설치를 본다 — 페이지에 넣는 대역으로는 안 된다.
- **창 없는 브라우저(headless)는 승인 창을 열지 않는다** — 화면이 꼭 있어야 한다(서버라면 Xvfb).
- MetaMask는 **13.0.0으로 고정**한다. 12.x는 사이트가 못 알아보고, 13.4x 이상은 온보딩 직후 확장 화면의 메모리가 터진다(사내 `webtest-automation` 문서 4장 · 실측).

그래서 **일반 사이트는 앱 안(WebContentsView)**, **지갑 사이트는 MetaMask를 실은 크롬**에서 돈다. 한 실행은 처음부터 끝까지 한 브라우저에서 돈다(§3.2 — 웹페이지 노드들이 쿠키 · 로그인을 같이 쓴다). 중간에 브라우저를 바꾸지 않는다.

## 2. 모양

```
Flowsmith 데스크톱 앱 (Electron · Windows)
 ├─ 편집 화면 ─────────── 로컬 모드: 앱 안의 서버(127.0.0.1) · 회사 서버 모드: 그 서버의 주소를 연다
 ├─ 이 PC의 워커 ───────── 로컬 모드: 서버 안의 InProcessWorker · 회사 서버 모드: WorkerAgent(워커 토큰)
 ├─ 앱 안 브라우저 ─────── WebContentsView — 일반 사이트의 녹화 · 실행 · 사람 기다리기
 └─ 지갑 브라우저 ──────── Playwright가 띄운 Chrome for Testing + MetaMask 13.0.0 — 앱 옆의 진짜 창
```

| | 로컬 모드 | 회사 서버 모드 |
|---|---|---|
| 서버 | 앱이 띄운다(데이터 폴더 · 마스터 키는 이 PC) | 회사 서버(지금 그대로) |
| 편집 화면 | `http://127.0.0.1:<임의 포트>` | 회사 서버 주소 |
| 워커 | 서버 안의 워커 = 이 PC | 이 앱이 워커 하나로 붙는다(관리자가 만든 토큰) |
| 일정 · 웹훅 | 앱이 켜져 있을 때만 | 서버가 돌린다(이 PC가 켜져 있어야 하는 실행만 이 PC로) |
| 누구 | 혼자 · 시험 · 데모 | 팀 |

★따로 켜는 «모드»가 아니다 — 앱을 처음 켤 때 «이 PC에서만» · «회사 서버에 붙기»를 고르고, 설정에서 바꾼다. 서버 · 워커 코드는 지금 것을 그대로 쓴다(§26 — 워커를 붙이지 않으면 standalone).

## 3. 브라우저 모드 — 하나 더

`settings.browser`(지금 `launch` · `attach`)에 둘을 더한다.

| 값 | 어디서 | 쓰는 곳 |
|---|---|---|
| `launch` | 서버 · 워커가 띄우는 Chromium(지금) | 앱 없이 돌리는 서버 · 도커 워커 |
| `attach` | 사람이 로그인한 크롬(지금) | 보안 프로그램 · OTP 사이트 |
| **`app`** (새로) | 데스크톱 앱의 WebContentsView | 앱이 있는 PC의 일반 사이트 |
| **`wallet`** (새로) | MetaMask를 실은 크롬(지갑 브라우저) | 지갑 로그인 사이트 |

- `app`은 데스크톱 앱 워커만 받는다. 앱이 없는 워커로 가면 **기다리지 않고 바로 실패**한다(§26의 규칙). 워커가 할 수 있는 것을 서버에 알린다(지금 확장 목록을 알리는 것처럼 `capabilities: ["app", "wallet"]`).
- `wallet`은 데스크톱 앱 워커가 기본이다. 화면이 있는 워커(`--headed` · Xvfb)도 받을 수 있다 — 앱이 없는 서버에서도 쓸 길을 남긴다.
- 실행 단추의 «이번만 어디서»는 그 모드를 받는 워커만 보인다.

## 4. 앱 안 브라우저(`app`) — WebContentsView를 Playwright로

엔진 · 레코더는 Playwright `Page`만 안다. WebContentsView를 Page로 대는 길:

1. 앱이 **실행마다 WebContentsView 하나**를 만든다. 실행마다 따로 세션(`partition`)을 줘서 쿠키가 실행 사이에 새지 않게 한다 — 지금 실행마다 새 컨텍스트를 쓰는 것과 같은 결.
2. 앱은 크롬 디버깅 포트(CDP)를 **127.0.0.1의 임의 포트**에 연다. 워커가 `chromium.connectOverCDP`로 붙어 그 뷰의 Page를 찾는다(뷰에 표시를 달아 둔다).
3. `BrowserSession`에 `app` 갈래를 더한다 — `attach`와 비슷하되 «우리가 만든 뷰»라 끝나면 뷰째 닫는다.
4. **녹화**: 같은 `RecorderSession`이 그 Page에 붙는다. 화면 전송(screencast)과 입력 전달은 필요 없다 — 사람이 뷰를 직접 누른다. 편집 화면의 라이브 패널 자리에 뷰를 겹쳐 그린다(`ElectronTransport` — `LiveTransport`의 B 구현, 녹화 메시지는 그대로).
5. **실행 화면 보기**: 뷰를 그대로 보여 준다. 앱 밖(다른 사람의 편집 화면)에서 볼 때는 지금처럼 화면 전송.
6. **사람 기다리기**: 그 뷰에서 사람이 바로 한다.

★CDP 포트에는 인증이 없다 — 같은 PC의 다른 프로그램은 붙어서 앱의 모든 화면(편집 화면 포함)을 조종할 수 있다. 웹 페이지에서는 못 붙는다(크롬이 출처를 막는다 — §9). 정한 것(§9-③):
- 포트는 **임의 번호 · 127.0.0.1만**(`--remote-debugging-port=0`, 번호는 `userData/DevToolsActivePort`에서 읽는다). 9222 같은 고정 번호를 쓰지 않는다.
- `--remote-allow-origins`를 **주지 않는다** — 웹 페이지 출처의 접속은 크롬이 늘 거절한다.
- 워커는 **자기가 만든 뷰만** 만진다 — 뷰에 단 표시로 고르고, 편집 화면 뷰는 건드리지 않는다(코드의 약속).
- 같은 사용자 권한의 프로그램은 CDP가 없어도 앱의 쿠키 · 프로필 파일을 읽을 수 있다 — CDP가 여는 위험은 «사람의 크롬에 붙기»(attach, 9222)와 같은 급이다. 회사 서버 모드에서 다시 본다(§8).

## 5. 지갑 브라우저(`wallet`)

`webtest-automation`의 MetaMask 코드(지갑 준비 · 잠금 풀기 · 키 불러오기 · 체인 추가 · 승인 · 화면 함정 처리)를 옮겨 온다 — 실제 사이트에서 다듬어진 것이다.

### 5.1 설정

워크플로우 설정의 **지갑**(지금 테스트 지갑 칸 `settings.wallet`을 넓힌다):

| 칸 | 뜻 |
|---|---|
| 방식 | **MetaMask 확장**(새로) · 페이지에 넣는 테스트 지갑(§40 — 그대로) |
| 키 | 시크릿 — 개인키(0x…64자리) 또는 복구 문구. ★워커에서만 풀린다 |
| 체인 | 지금 것 그대로 — chainId · RPC · «거래 허용» |
| 지갑 비밀번호 | MetaMask 잠금 비밀번호 — 프로필을 잠그는 데만 쓴다. 비우면 워커가 만들어 그 PC에 둔다 |

### 5.2 프로필 — 지갑마다 하나, 계속 쓴다

- 워커의 데이터 폴더에 **지갑마다 크롬 프로필 하나**(키의 지문으로 이름). 처음 한 번만 지갑을 준비한다(약 30초), 다음부터는 잠금만 푼다.
- ★**Windows는 경로를 짧게** — MetaMask 저장소(프로필 안 IndexedDB)는 경로가 깊어, 프로필이 긴 폴더에 있으면 260자를 넘어 지갑 화면이 여우 로딩에서 멈춘다(§9-④ — 긴 경로 지원은 기본으로 꺼져 있다). 프로필은 `%LOCALAPPDATA%\Flowsmith\w\<지문 8자>`, MetaMask는 `%LOCALAPPDATA%\Flowsmith\mm\13.0.0`처럼 둔다. 시작할 때 경로 길이를 보고, 넘으면 이유와 함께 멈춘다.
- 이메일 재인증 · Cloudflare 같은 사람 몫은 **한 번 풀면 프로필에 남는다** — 사람 기다리기로 받는다.
- 같은 프로필을 두 실행이 동시에 열 수 없다 → **자원 잠금**(§36-6)에 지갑 이름을 저절로 넣는다.
- 실행이 끝나면 크롬을 닫는다(프로필은 남긴다). 프로필을 지우는 단추를 둔다(«지갑 다시 준비»).

### 5.3 MetaMask 받기

- 처음 쓸 때 GitHub 릴리스에서 **13.0.0을 받고 GitHub가 적은 SHA256으로 확인**한다. 맞지 않으면 쓰지 않는다.
- 판은 코드에 고정한다. 바꿀 때는 `webtest-automation`의 확인 순서(사이트가 알아보나 · 온보딩 · 45초 안정)를 거친다.

### 5.4 승인 — «MetaMask 승인» 동작

웹페이지 노드에 동작 하나를 더한다: **MetaMask 승인**.

- 화면 종류를 추측하지 않는다 — 모든 MetaMask 화면에서 확인 단추를 찾아 누르고, **끝 표시**(로그인 뒤에만 보이는 것 — 사람 기다리기와 같은 꼴)가 보이면 멈춘다. 승인 창은 새 창으로도, 이미 열린 탭 안에도 뜬다.
- ★**무엇이든 누르지 않는다.** 누르기 전에 화면 종류를 읽는다:

| 화면 | 기본 |
|---|---|
| 연결 · 권한 | 누른다 |
| 서명(personal_sign · EIP-712) | 누른다 — 서명한 글을 노드 로그에 남긴다 |
| 체인 추가 · 전환 | 설정의 체인 목록 안이면 누른다 · 밖이면 실패 |
| 거래 · 토큰 승인 | «거래 허용»을 켠 체인만 — 아니면 실패 · ★점검(변경 감시)에서는 늘 멈춘다 |
| 모르는 화면 | 누르지 않고 실패 — 화면 한 장을 남긴다 |

- 키는 지갑 브라우저 밖으로 나가지 않는다 — 실행 기록 · 로그 · 화면 전송에 키를 싣지 않는다(지갑 준비 화면은 전송하지 않는다).

### 5.5 사람 기다리기로만 할 때

키를 넣지 않고 지갑 브라우저를 쓰면, 처음 한 번 사람이 그 창의 MetaMask에서 지갑을 만들거나 가져온다. 다음부터는 승인도 사람이 누르거나(사람 기다리기) «MetaMask 승인» 동작으로 넘긴다. 사람의 실제 지갑이면 지금처럼 **사람의 크롬(attach) + 사람 기다리기**가 맞다.

## 6. 패키징 — Windows 먼저

- Electron 앱(`apps/desktop`) — 편집 화면은 지금 `apps/studio`를 그대로 연다(로컬 서버가 내주거나 회사 서버 주소).
- 앱 안의 서버 · 워커는 Electron의 Node로 돈다(`utilityProcess`). Electron 44의 Node는 24.22 — type stripping · `node:sqlite`가 되고, 지금 `.ts`를 **묶지 않고 그대로** 띄운다(§9-①). 설치본 크기 · 시작 시간이 문제 되면 그때 묶는다(rolldown).
- npm 11은 Electron의 설치 스크립트(바이너리 받기)를 돌리지 않을 수 있다 — `node node_modules/electron/install.js`(받은 것을 `checksums.json`으로 확인한다).
- Chrome for Testing(지갑 브라우저용)은 설치본에 넣지 않고 **처음 쓸 때 받는다**(약 150MB) — 일반 사이트만 쓰는 사람은 받지 않는다.
- 설치본: NSIS. ★코드 서명 인증서가 없으면 Windows SmartScreen이 경고한다 — 배포 전에 정한다. 자동 업데이트는 뒤로.

## 7. 단계

| 단계 | 할 일 | 끝났다는 표시 |
|---|---|---|
| **0. 확인** ✅ | ① Electron의 Node에서 서버 · 워커가 도나(type stripping · `node:sqlite` · Playwright) ② WebContentsView를 Playwright로 조종 · 녹화(connectOverCDP) ③ CDP 포트 위험을 줄이는 길 ④ Windows에서 지갑 브라우저로 로그인까지(qa.msu.io — 사내망) | 넷 다 «된다 / 이렇게 바꾼다»가 정해짐 — §9. ④의 서명 · 로그인 완료만 사내망에서 남음 |
| **1. 지갑 브라우저** 🔶 | `wallet` 모드 · 프로필 · MetaMask 받기 · «MetaMask 승인» 동작 · 설정 화면 · 가이드. **앱 없이** 화면 있는 워커(`--headed`)에서 먼저 쓴다 | 사람 PC 워커에서 qa.msu.io 로그인 시나리오가 무인으로 돈다 — 실행 · 녹화 · 지갑 다시 준비는 됨(§10) · qa.msu.io 확인(사내망)만 남음 |
| **2. 앱 껍데기** ✅ | `apps/desktop` · 로컬 모드(서버 · 워커 내장) · 편집 화면 · Windows 설치본 | 설치하고 켜면 편집 화면이 뜨고 `launch` · `wallet` 실행이 돈다 — Windows 설치본으로 확인(§11) |
| **3. 앱 안 브라우저** ✅ | `app` 모드 · `ElectronTransport` · 녹화 · 실행 화면 · 사람 기다리기 | 일반 사이트를 앱 안에서 녹화 → 실행 — Windows의 Electron에서 확인(§12) |
| **4. 회사 서버 모드** ✅ | 서버 주소 + 워커 토큰으로 붙기 · `capabilities` · 실행 단추의 «이번만 어디서» | 회사 서버의 워크플로우가 이 PC의 앱 안 · 지갑 브라우저에서 돈다 — 개인 워커 · «내 PC에서 실행하기» · 워커 화면 중계로 Windows에서 확인(§13) |
| **5. 배포** | 코드 서명 · 자동 업데이트 · macOS | — |

1단계를 앞에 둔 까닭: 지금 바로 쓸모가 있고(사람 PC 워커에서 지갑 시나리오), 앱이 없어도 되며, 2~4단계는 그 위에 얹기만 한다.

## 8. 정하지 않은 것

- 코드 서명 인증서 — 회사 인증서를 쓰나
- 로컬 모드의 데이터를 회사 서버로 옮기는 길(워크플로우 내보내기 · 가져오기로 충분한가)
- 사람마다 «내 워커»(누른 사람의 PC에서) — §26의 «아직». 회사 서버 모드에서 이 앱이 그 자리를 채울 수 있다

## 9. 0단계 결과 (2026-10-24 · Windows 11 · Electron 44.9.3 · Playwright 1.63)

### ① Electron의 Node로 서버 · 워커 — 된다

- Electron 44.9.3의 Node는 **24.22.0** · `process.features.typescript = "strip"` · `node:sqlite` 됨.
- `ELECTRON_RUN_AS_NODE=1 electron packages/server/src/main.ts`로 서버가 뜨고 API가 답한다(`/api/auth/me` · `/api/openapi.json`).
- 같은 Node로 Windows에서 시험: core 전체 · server 일부(저장소 · API · 로그인 · 웹훅 · 플러그인) · worker · engine · recorder · pack **280개 — 아래 하나를 고친 뒤 모두 통과**(진짜 Chromium 포함). 걸린 것은 **리눅스 경로를 가정한 곳 둘**이었다:
  - `packages/worker/test/plugins.test.ts` — 시험 플러그인이 `join("a", "b") === "a/b"`를 봤다(Windows는 `a\b`) → `sep`로.
  - `apps/testsite/server.ts` — 직접 실행 판단 `import.meta.url === \`file://${process.argv[1]}\``가 Windows에서 늘 거짓 → `import.meta.main`(Node 24.2+) · 없으면 `pathToFileURL`로 견준다.
- `utilityProcess.fork("….ts")`로 `.ts`를 그대로 띄운다(시험 사이트 · 워커).

### ② WebContentsView를 Playwright로 — 된다

- 앱이 `--remote-debugging-port=0`으로 뜨고, 앱 안 워커(utilityProcess)가 `chromium.connectOverCDP`로 붙어 실행 뷰(표시 `?fs-run=1`로 고름)를 Page로 받는다.
- **엔진**: `runFlow(flow, { page })`로 예시 워크플로우(로그인 → 주문 조회 → 조건 → 커스텀)가 0.7초에 성공 · 값이 맞다(김철수 · 배송중 · 12,500원 → 12500).
- **녹화**: `RecorderSession.open({ cdpUrl })` — attach와 같은 길로 그 탭을 골라 «'주문번호' 칸 넣기 · '조회' 버튼 누르기»를 녹화했다. 고칠 것이 없었다.
- ☆뷰에 `partition`을 따로 줘도 CDP에서는 **컨텍스트 하나**로 보인다(쿠키는 Electron 세션마다 나뉜다). 그래서 실행 격리는 Playwright 컨텍스트가 아니라 **뷰 · 세션**으로 한다.

### ③ CDP 포트 — 이렇게 쓴다(§4)

| 확인한 것 | 결과 |
|---|---|
| 어디에 열리나 | `127.0.0.1:<임의>`만(netstat) |
| 웹 페이지 출처에서 접속(`Origin: https://evil.example`) | **403으로 거절**(크롬 기본 — `--remote-allow-origins`를 안 주면) |
| 같은 PC 프로그램(Origin 없음) | 붙는다 |
| 보이는 대상 | 실행 뷰와 **편집 화면 뷰가 다** 보인다 |

### ④ Windows의 지갑 브라우저 — 된다(서명 · 로그인 완료는 사내망에서)

- `webtest-automation`의 흐름(Chrome for Testing + MetaMask 13.0.0 · 창 있음)으로 운영 msu.io에서: 지갑 준비 → 키 불러오기 → Henesys(68414) 체인 추가 · 전환 승인 → «MetaMask Installed» → **연결 승인까지 자동**. 테스트 지갑에 운영 계정이 없어 회원가입 화면으로 갔다(서명 요청 없음 — WSL에서와 같다).
- ★**처음에는 지갑 화면이 여우 로딩에서 멈췄다** — 작업 폴더 경로가 139자라 프로필 파일 경로가 257자까지 갔다(이 PC는 `LongPathsEnabled = 0`). 짧은 폴더(42자)로 옮기니 프로필 경로가 최대 220자 · 그대로 됐다 → §5.2.
- 서명 · 로그인 완료는 qa.msu.io(이 PC에서 403 — 사내망)에서 확인한다.

## 10. 1단계 — 지갑 브라우저 (2026-10-24, 실행 쪽 됨)

| 어디 | 무엇 |
|---|---|
| core `wallet.ts` | `mode`(inject · metamask) · `METAMASK_VERSION`/`SHA256` · 키 꼴(`walletKeyKind` — 개인키 · 복구 문구) · **`approvalDecision`**(화면 → 누를까 · 순수) · 체인의 `symbol` |
| core `flow.ts` · `nodes/web.ts` · 검문소 | 브라우저 `wallet` · 동작 `walletApprove`(끝 표시 · 10초~10분 · «있을 때만» 없음) · 방식과 브라우저가 어긋나면 사람 말로 · `walletApprove`는 지갑 브라우저에서만 |
| engine `browser/metamask/ui.ts` | MetaMask 13.0.0 화면 조작 — 지갑 준비(약관 · 복구 문구 타이핑 · 비밀번호 · 기본 기능 끄기) · 잠금 · 막는 창 · 개인키 계정 불러오기(webtest-automation에서 옮김) |
| engine `browser/metamask/approve.ts` | 승인 화면 읽기(주소 뒤 `#connect/` · `#confirmation/` · `#confirm-transaction/…/signature-request`) · 끝 표시까지 누르기 · 같은 화면이 3번 넘어가지 않으면 멈춤 · 처음 체인 맞추기 |
| engine `browser/metamask/wallet-browser.ts` | 지갑마다 프로필(키의 지문 10자) · 비밀번호 파일 · 같은 지갑은 차례로 · Windows 경로 길이 검사 · 남은 프로필 잠금 정리 |
| engine `run.ts` · `browser-session.ts` · `nodes/web-node.ts` | `wallet` 모드는 실행기가 준 `openWallet`으로 연다 · 시작 주소를 연 직후 체인부터(사이트의 «지갑 연결»과 승인이 겹치지 않게) · 점검은 «MetaMask 승인» 앞에서 멈춤 |
| worker `metamask.ts` · `local.ts` · `agent.ts` | MetaMask 받기(GitHub · SHA256 · `FLOWSMITH_METAMASK_ZIP`) · 지갑 폴더(`FLOWSMITH_WALLET_DIR`) · 창이 보이는 워커만 `capabilities: ["wallet"]` |
| server `worker-hub.ts` | 지갑 브라우저 실행은 `wallet`을 알린 워커로만 · 없으면 이유와 함께 바로 실패 |
| 편집 화면 | 설정의 «브라우저 › 지갑 브라우저(MetaMask)» · MetaMask 지갑 칸(키 시크릿 · 체인 · 화폐 기호) · 동작 «MetaMask 승인»(끝 표시 · 기다리는 시간) · 가이드 `wallet.md` |
| 시험 사이트 | `/dapp`(지갑 연결 → 연결 → 서명 → 주소 · 목록 밖 체인 넣기) · `/__rpc?chain=N`(가짜 체인 JSON-RPC) |

시험: core 승인 판단 · 검문소 / engine 경로 · 지문 · 화면 읽기 / worker 지갑 폴더 · SHA256 / server 창 없는 워커 · 서버의 실패 이유 /
**진짜 MetaMask**(`packages/worker/test/metamask-e2e.test.ts` · `FLOWSMITH_MM_E2E=1`일 때만 — 화면 · 망이 있어야 한다):
처음(지갑 준비 → 체인 추가 → 연결 → 서명 → 주소 · 약 80초) · 다시(잠금만 · 약 22초) · 목록 밖 체인은 누르지 않음 — WSLg에서 통과.

배운 것: 사이트가 «연결»을 부른 뒤에 체인 추가를 끼우면 MetaMask가 두 승인을 함께 쥐고 넘어가지 않는다 → 체인은 시작 주소를 연 직후에.
MetaMask의 체인 추가 화면에는 체인 id가 숫자로 안 나올 수 있다 — 목록의 이름 · id로 찾고, 못 찾으면 «알 수 없음»으로 누르지 않는다.

### 10-2. 녹화 · 지갑 다시 준비 · 워커 표시 (2026-10-24)

- **녹화** — 지갑 브라우저 플로우는 녹화도 그 브라우저에서(`RecorderSession.open`이 `WalletSource`를 받는다 · 워커 `InProcessWorker.walletSource` ·
  서버 LiveHub는 서버 안 워커가 창을 띄울 수 있을 때만 — 아니면 «화면이 있는 PC의 워커를 고르세요»). 녹화 창의 «🦊 MetaMask 승인 넣기»(끝 표시: 지금 주소 · 고른 요소).
  이 노드의 동작을 재생할 때 «MetaMask 승인»도 돈다 · 시작 주소로 가면 체인부터.
  ★**녹화 스크립트는 확장 페이지에서 돌지 않는다** — 컨텍스트 전체에 심으면 MetaMask 창에도 들어가 «Confirm» 누르기를 가로채 버린다(사람이 승인을 못 한다 · 시험에서 잡았다).
  MetaMask 창으로 화면을 옮기지 않는다(사이트가 연 팝업만 따라간다).
- **지갑 다시 준비** — 실행 옵션 `resetWallet`(API `POST /api/flows/:id/runs` · 실행 단추 옆 ▲의 «지갑 다시 준비»). 그 실행을 받은 워커가 잠금을 쥔 뒤 프로필을 지우고 처음부터 준비한다.
- **워커 화면** — `capabilities`에 wallet이면 «🦊 지갑 브라우저(MetaMask) 됨».
- 진짜 MetaMask 시험에 둘 더: 다시 준비(워커 경로) · 녹화(MetaMask 창의 누르기는 안 남음 · «MetaMask 승인» 재생).

**Windows에서 확인(2026-10-24)** — Electron 44의 Node로 지갑 시험 39개(진짜 MetaMask 5개 포함 · Windows 크롬 창) 모두 통과. MetaMask는 `%LOCALAPPDATA%\Flowsmith\mm\13.0.0`에 받혔다.
★**개발 · 설치 폴더도 짧게** — 긴 폴더(139자)에 저장소를 두면 pnpm의 깊은 파일(253자~)이 260자를 넘어 **만들어지지 않는다**(vitest · Electron 바이너리가 조용히 빠졌다). 2단계의 설치본은 짧은 경로(`%LOCALAPPDATA%\Programs\flowsmith`)에 깐다(§11).

남은 것(1단계): 사내망에서 qa.msu.io 로그인 확인.

## 11. 2단계 — 앱 껍데기 · 로컬 모드 (2026-10-24)

| 어디 | 무엇 |
|---|---|
| `apps/desktop/src/main.ts` | Electron 앱 — 시작 화면 → (처음이면) 브라우저 받기 → 서버 띄우기 → 편집 화면. 창 하나 · 같은 앱은 하나만 · 창을 닫으면 서버에 «stop»을 보내고 끝낸다(5초 안에 안 꺼지면 죽인다) · 바깥 주소는 기본 브라우저로 |
| `apps/desktop/src/boot.ts` | 서버를 띄우는 입구(`utilityProcess`) — 설치본에는 워크스페이스 링크가 없어 `@flowsmith/*`를 `packages/`로 잇는다 |
| `apps/desktop/scripts/stage.ts` | 설치본에 넣을 것을 모은다(저장소와 같은 모양 · `.ts` 그대로 · 외부 의존성 판이 다르면 멈춘다) + electron-builder 설정 |
| server `main.ts` | `parentPort`가 있으면(앱이 띄웠으면) 준비되면 `{t:"ready", url}`을 알리고 «stop»에 끈다 · `FLOWSMITH_WALLET_BROWSER=on` |
| worker `local.ts` | `walletWindow` — 띄우는 브라우저는 창 없이, 지갑 브라우저만 창을 띄운다 |

자리(Windows):

| 무엇 | 어디 |
|---|---|
| 앱 | `%LOCALAPPDATA%\Programs\flowsmith` — 사람마다 설치(관리자 권한 없이 · NSIS oneClick) · ★폴더 이름은 `package.json`의 `name` |
| 데이터 · 로그 | `%APPDATA%\Flowsmith\{data,logs}` — 지울 때 남긴다 |
| 마스터 키 | `%APPDATA%\Flowsmith\master.key.enc` — Windows 사용자 암호화(DPAPI · `safeStorage`) · 서버에는 환경변수(`FLOWSMITH_MASTER_KEY`)로만 넘긴다 |
| 브라우저 | `%LOCALAPPDATA%\Flowsmith\browsers` — 처음 켤 때 Playwright가 받는다(약 300MB · 30초 남짓) |
| MetaMask · 지갑 프로필 | `%LOCALAPPDATA%\Flowsmith\{mm,w}` (§5.2 · §10) |

만들기(Windows · ★짧은 폴더):

```
pnpm studio:build
node apps/desktop/scripts/stage.ts /mnt/c/Users/<나>/AppData/Local/fsb/app     # WSL에서 — Windows의 짧은 폴더로
# Windows PowerShell, 그 폴더에서
npm install
npx electron-builder --win nsis        # → dist\Flowsmith-Setup-<판>.exe (약 130MB · 6분)
```

**Windows에서 확인(2026-10-24)** — 설치본을 조용히 깔고(`/S`) 켜서: 편집 화면 · `launch` 실행(example.com 읽기) ·
`wallet` 실행(운영 msu.io — 지갑 준비 → 키 불러오기 → Henesys 체인 → Connect → «MetaMask Installed» → 연결 승인 → 회원가입 화면, 약 60초) · 창 닫기로 끝내기(서버까지 1초 안).

겪은 것:

- ★**VS Code 안에서 띄우면 `ELECTRON_RUN_AS_NODE=1`이 따라온다** — `Flowsmith.exe`가 Electron이 아니라 Node로 떠 «bad option»으로 끝난다. 지우고 띄운다. 앱이 띄우는 서버에는 앱이 지운다.
- **브라우저 받기는 «다 받았다» 표시로 본다** — 폴더는 풀기 시작할 때 생긴다. 폴더만 보고 넘어가면 반쯤 풀린 실행 파일이 남아 실행이 `spawn EFTYPE`로 실패했다. → 브라우저마다 `INSTALLATION_COMPLETE` · `__dirlock`이 없을 때.
- pnpm 11은 Electron의 설치 스크립트를 막는다 — `pnpm-workspace.yaml`의 `allowBuilds: electron: true`.
- 설치본은 서명이 없다 — SmartScreen이 경고한다(5단계). 아이콘은 Electron 기본.

남은 것: 앱 안 브라우저(3단계 — §12) · 회사 서버 모드(4단계).

## 12. 3단계 — 앱 안 브라우저 (2026-10-24)

브라우저 모드 `app`. 데스크톱 앱이 **실행 · 녹화마다 WebContentsView 하나**를 열고, 서버 안 워커가 앱의 CDP로 붙어 그 뷰를 Playwright `Page`로 받는다(§4). 엔진 · 레코더는 Page만 알아서 거의 그대로다.

```
워커(서버 utilityProcess)                       앱(Electron main · views.ts)
  AppViews.open("run" | "record", 이름)
    ── { t: "view:open", id, purpose, title } ──▶  WebContentsView(세션 fs-view-<id> · 메모리) → 표시 주소 …#fs-view=<id>
    ◀── { t: "view:opened", id } ──────────────    run: 따로 창(앞으로 가져오지 않음) · record: 편집 화면 창 위(처음엔 숨김)
  CDP(FLOWSMITH_APP_CDP)에서 표시 주소로 우리 뷰를 찾는다
  사람 기다리기가 시작되면  ── { t: "view:focus", id } ──▶  실행 창을 앞으로
  끝나면                    ── { t: "view:close", id } ──▶  뷰(와 실행 창)를 닫는다
```

| 어디 | 무엇 |
|---|---|
| core | `BROWSER_MODES`에 `app` · 이름 «앱 안 브라우저» · 테스트 지갑(페이지에 넣는 것)은 싣지 않는다(컨텍스트를 앱 전체가 함께 쓴다) |
| engine `browser-session.ts` · `run.ts` | `openApp` — 뷰가 그 실행의 «하나뿐인 페이지» · 컨텍스트는 닫지 않고 뷰만 닫는다 · 사람 기다리기 됨 |
| recorder `session.ts` | `AppSource` — 사람의 크롬에 붙을 때와 같이 다룬다(레코더는 우리 뷰에만 · 크기를 바꾸지 않는다 · 우리가 연 팝업만 따라간다) · 화면 전송 없음 · 화면에 `{ t: "app-view", id }` |
| worker `app-views.ts` · `local.ts` | 앱과 주고받는 말 · CDP 연결 하나를 모든 뷰가 함께 쓴다 · `capabilities`에 `app` · `appSource()`(녹화) |
| server | 앱이 띄웠을 때만(`parentPort` + `FLOWSMITH_APP_CDP`) AppViews · LiveHub의 앱 안 녹화 · 워커 고르기(`app`을 알린 워커만 — 없으면 이유와 함께 바로 실패) |
| desktop `main.ts` · `views.ts` · `preload.cjs` | `--remote-debugging-port=0`(127.0.0.1 · `--remote-allow-origins` 없음) · 포트는 `userData/DevToolsActivePort` · 뷰 열고 닫기 · 편집 화면에 `flowsmithDesktop.placeView(id, rect)` 하나만 |
| 편집 화면 `LiveView.tsx` | `app-view`를 받으면 캔버스 대신 빈 자리를 두고 그 자리를 150ms마다 재서 앱에 알린다 · 덮개(진행 · 고르기 목록 · 대화상자)가 떠야 하면 뷰를 숨긴다 · 사람 기다리기 안내는 아래 줄에 |
| 편집 화면 그 밖 | 설정의 «앱 안 브라우저» · 워커 화면 «🖥 앱 안 브라우저 됨» · 사람 기다리기에서 실제 화면을 저절로 열지 않는다(실행 창에서) · 가이드 `desktop.md` |

- **녹화 뷰의 크기** — 라이브 패널 자리 그대로 · 폭이 1024보다 좁으면 줄여 보인다(`setZoomFactor` — 사이트가 휴대폰 배치가 되지 않게 · 녹화기의 MIN_WIDTH와 같은 값). 주소가 바뀌면 배율이 처음으로 돌아가 다시 맞춘다.
- **뷰는 편집 화면보다 위에 그려진다** — 편집 화면의 HTML이 뷰를 덮을 수 없다. 그래서 덮개가 떠야 할 때는 뷰를 숨긴다(고르기 목록은 숨긴 자리에 그린다).
- **실행 화면 보기**(화면 전송)도 그대로 된다 — 실행 창이 떠 있어 프레임이 나온다.

시험: `packages/worker/test/app-views.test.ts` — 원격 디버깅 포트를 연 Chromium을 «앱»으로 흉내 낸다(편집 화면 탭 하나 + 부탁하면 표시 주소로 탭을 여는 ViewHost). 실행(뷰만 닫히고 편집 화면 · 앱은 그대로) · 사람 기다리기(view:focus → 사람이 그 뷰에서 로그인) · 앱 없는 워커는 바로 실패 · 녹화(뷰 id 알림 · 화면 전송 없음 · 편집 화면에는 레코더를 심지 않음). server workers 시험에 «앱 없는 워커 · 서버는 바로 실패» · core 검문소.

**Windows의 Electron에서 확인(2026-10-24)** — 빌드 폴더의 풀지 않은 앱을 띄우고 앱의 CDP로 편집 화면을 사람처럼 눌렀다(`fsb\p3-drive.mjs`):
앱 안 브라우저 워크플로우 만들기 → «녹화로 동작 더하기» → 라이브 패널 자리에 진짜 페이지(iana.org) → 링크 누르기(녹화) · «읽기»로 제목 누르기 → «녹화 끝 — 동작 2개 넣기»(뷰가 닫힘) →
실행(따로 창 · 0.8초 · 결과 «IANA-managed Reserved Domains» · 끝나고 창이 닫힘) → 사람 기다리기 실행(실행 창이 앞으로 · «실제 화면 보기»에 화면이 옴 · 실행 창에서 링크를 누르니 이어 가 성공) → 창 닫기로 끄기.
☆뷰는 창 위에 따로 그려져 편집 화면만 찍으면 그 자리가 비어 보인다 — 확인 캡쳐는 편집 화면과 뷰를 따로 찍어 그 자리에 겹쳤다.

아직 확인하지 않은 것: 사이트가 연 팝업(Electron 기본은 앱의 새 창 — 엔진 · 레코더가 따라가는지) · 파일 받기 · 녹화 중 편집 화면 창 크기를 바꿀 때.

## 13. 4단계 — 회사 서버 모드 (2026-10-24)

사용자: «관리자 서버가 토큰을 만든다 · 사용자는 앱을 깔고 토큰을 한 번만 등록 · 워커 서버(도커)가 따로 있다 · «내 PC에서 실행하기»를 켜면 스스로 워커가 되어 실시간으로 보고, 끄면 워커 서버에서 돈다» ·
«남의 실행이 내 PC로 오면 안 된다 — 내 PC에서 동작하도록 정해 둔 워크플로우는 없다» · «로컬 모드는 남긴다» · «워커 서버 실행도 제약 있게라도 보기».

### 워커 두 종류

| | 공용 워커(`shared`) | 개인 워커(`personal`) |
|---|---|---|
| 받는 실행 | 누구의 실행이든 · 일정 · 웹훅 · 점검 | **주인이 «내 PC에서 실행하기»로 돌린 실행만** |
| 고르는 법 | 워크플로우의 실행 위치(워커 · 라벨) · 실행 단추의 «이번만» | 실행 단추의 «내 PC에서 실행하기»뿐 — 워크플로우 설정 · 라벨로는 못 고른다 |
| 어디 | 도커 · 서버실 PC(워커 프로그램) | 그 사람의 데스크톱 앱 |
| 누가 보나 | 모두(팀 전용이면 그 팀) | 관리자와 주인 |
| 만들 때 | 이름 · 라벨 · 팀 · 동시 실행 수 | 이름 · **주인**(있는 사람) — 라벨 · 팀은 없다 |

- 서버가 지킨다: `checkRunOn(flow, on, { by })` — 개인 워커는 그 실행을 돌린 사람(`startedBy`)이 주인일 때만 · 워크플로우의 «어디서 돌리나»로는 400 · 라벨은 공용만 본다(`placement.ts`) · 녹화도 주인만(`WorkerHub.record`).
- 옛 워커는 모두 공용(`worker.kind` 기본 `shared` · 마이그레이션).

### 앱 — 회사 서버에 붙기

```
처음 켤 때(connect.ts)  ┌ 이 PC에서만      → 로컬 모드(2 · 3단계 그대로)
                         └ 회사 서버에 붙기 → 서버 주소(https · 이 PC면 http도) + 워커 토큰(fsw_…)
                              userData/desktop.json { mode, server } · worker-token.enc(safeStorage — 한 번만)
회사 서버 모드            이 PC의 서버는 띄우지 않는다 — 앱 창은 회사 서버의 편집 화면(로그인은 회사 계정)
                         agent.ts(utilityProcess) = WorkerAgent + InProcessWorker(앱 안 브라우저 · 지갑 창 · launchInApp)
                         ── 서버의 개인 워커로 붙는다 · 상태를 앱에 알린다(online · offline · denied)
편집 화면 ↔ 앱(preload)  info() → { mode, server, worker: { id, name, state } } · openSetup() · setup()(처음 화면에서만)
```

- **«내 PC에서 실행하기»**(RunLauncher) — 앱이 알려 준 워커 id로 `on: worker:<id>`를 보낸다. 앱 안 · 지갑 브라우저 워크플로우는 늘 켜짐(잠김). 이 PC가 붙어 있지 않으면 실행 단추가 잠긴다. 고른 것은 이 브라우저에 기억한다.
- **내 PC에서는 «띄우기»도 실행 창에서**(`launchInApp`) — «내 PC에서»는 보려고 고른 것이다. 페이지에 넣는 테스트 지갑이 있는 플로우만 그대로 띄운다.
- **녹화** — 회사 서버 모드면 «녹화할 곳: 내 PC(앱 안 브라우저)» 기본 · 서버도 고를 수 있다. 다시 지정처럼 폼을 거치지 않으면 내 PC.
- 토큰이 거절되면(새 토큰 · 지움) 앱이 처음 화면을 다시 연다(켤 때도 · 쓰는 도중에도). «내 설정 › 데스크톱 앱 › 연결 바꾸기»로 바꾸면 앱이 다시 켜진다.
- 회사 서버 모드에서는 편집 화면이 다른 주소로 옮겨 가는 것을 막지 않는다(회사 로그인이 다른 주소를 거쳐 돌아온다).

### 워커 화면 중계 — «제약 있게라도 보기»

```
화면(RunScreen) ⇄ 서버 RunScreens ── remote(runId, ctl) ──▶ WorkerHub ── screen on/off · screen-input ──▶ 워커(agent · ScreenRelay)
                ◀─ JPEG · viewport · page ◀─ sink ◀──── 이진 «r:실행 id»+JPEG · screen-out ◀── CDP 화면 전송(보는 사람이 있을 때만)
```

- 보는 사람이 생기면 그 PC가 지금 페이지에 화면 전송을 걸고, 다 떠나면 끈다(서버에서 도는 실행과 같은 결). 페이지가 바뀌면 따라간다.
- **사람 기다리기** — 원격 워커도 이제 된다(엔진에 `onPage`가 가서 `human`이 켜진다). 손은 서버가 거른 것(기다리는 동안 · 실행자 이상)만 그 PC로 간다.
- ☆한 단계 더 건너간다(워커 → 서버 → 화면) — 서버에서 도는 실행보다 조금 늦고, 망이 느리면 프레임을 버린다. 중계를 모르는 옛 워커는 전처럼 «화면 보기는 서버에서 도는 실행만».

### 시험 · 확인

- `packages/server/test/personal-workers.test.ts` — 만들 때 주인 · 라벨 없음 · 주인과 관리자만 봄 · 워크플로우 설정으로는 400 · 남(관리자도)의 실행은 400 · 주인의 실행은 그 PC에서 · 라벨은 개인 워커로 안 감 · **공용 워커의 화면 중계 + 화면에서 키보드로 로그인하면 이어 감** · 사람 기다리기 시간 넘김(보다가 떠남)에도 서버가 산다.
- **Windows에서 확인(2026-10-24)** — WSL에 회사 서버(로그인 켬) + «도커 워커»(공용 · 창 없음), Windows에 풀지 않은 앱(`fsb\p4-check.ps1` · `p4-drive.mjs`):
  처음 화면 «회사 서버에 붙기»(주소 · 개인 워커 토큰) → 3~9초에 붙음 → 회사 계정 로그인 → 워커 화면(개인 · 공용 둘 다 연결됨) →
  «내 PC에서 실행하기» 켜고 실행 → **대표 PC(앱 실행 창)에서 성공** → 끄고 실행 → **도커 워커 1에서 성공** →
  도커 워커에서 사람 기다리기 → 편집 화면이 실제 화면을 저절로 열고 **중계된 화면에서 링크를 눌러 이어 가 성공**.
- ☆확인 중에 회사 서버(WSL)가 한 번 끝 코드 1로 꺼졌다 — 로그가 남지 않아 까닭을 못 찾았고, 같은 상황(사람 기다리기 시간 넘김 · 보던 화면 닫힘)을 시험 · 실제 서버로 다시 해 봤지만 재현되지 않았다. 더 지켜본다.
