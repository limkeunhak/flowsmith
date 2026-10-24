# Flowsmith

웹 자동화 플로우 엔진. 웹 페이지에서 하는 일을 **노드**로, 데이터 흐름을 **엣지**로 그린
비순환 그래프를 만들고, 배포하고, 돌린다.

## 문서

| 문서 | 무엇 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **시스템 구조** — 구성도 · 패키지와 컴포넌트 · 데이터 모델 · 핵심 흐름 · 저장 · 안전장치 · 확장 지점 |
| [docs/FEATURES.md](docs/FEATURES.md) | 지금까지 만든 기능(영역별 · 단계별) · 아직 아닌 것 |
| [docs/PLAN.md](docs/PLAN.md) | 계획과 결정 — 왜 이렇게 만들었나 |
| [docs/RECORDING.md](docs/RECORDING.md) | 녹화로 플로우 만들기 — 사람의 크롬 · CDP 브리지 · 행 고르기 · 확인 · 팝업 |
| [docs/DOCKER.md](docs/DOCKER.md) | 도커 컴포즈로 이 PC에서 master/worker 띄우기(서버 하나 · 워커 둘) |
| [docs/DESKTOP.md](docs/DESKTOP.md) | 데스크톱 앱 · 지갑 브라우저 설계 — 앱 하나 브라우저 둘(앱 안 · MetaMask 크롬) · 단계 |
| `packages/*/README.md` · `apps/studio/README.md` | 패키지마다의 모듈 지도 |

## 구성

```
packages/core       모델 · 검문소 · 그래프 · 표현식 · 조건 · 실행 상태 — 순수(브라우저 · 파일 · DB를 모른다)
packages/engine     실행기 runFlow · 노드 실행기(nodes/) · 브라우저(browser/) · 점검 · 확장 레지스트리 · CLI
packages/recorder   녹화 세션 · 페이지에 심는 스크립트 · 녹화 제안 · 메시지 약속
packages/server     HTTP API(http/) · 저장(storage/) · 실행 관리 · 감시 · 트리거(run/) · 녹화/실행 화면 중계(live/)
apps/studio         편집 화면 — 캔버스 · 노드 서랍 · 녹화 · 실행 로그 · 실행 화면 · 감시 · 트리거 · 파일
apps/testsite       시험용 작은 쇼핑몰 (로그인 · 조회 · 표 · iframe · 뉴스 목록 · 금지 버튼 · /__layout?v=2 바뀐 척)
examples/           login-and-read.json
```

| 할 수 있는 것 | 어디서 |
|---|---|
| 플로우를 그린다 — 웹페이지 · 조건 · 커스텀 · 파일 쓰기 · 파일 읽기 · 다른 플로우 실행 · 확장 노드 | 편집기 캔버스 |
| 다른 플로우가 쓴 파일을 읽는다 — 다른 플로우의 폴더 · 공유 폴더 · 오늘 · 어제 · 가장 최근 파일 | 파일 읽기 노드 |
| 목록의 행마다 다른 플로우를 돌린다 — `$item` · 동시 실행 · 실패하면 멈춤/계속 · 행마다 실행 기록 | 다른 플로우 실행 노드 |
| 모은 것을 파일로 — CSV · JSON Lines · JSON · 텍스트 · 이어 붙이기/덮어쓰기 · 날짜별(시 · 일 · 월)/번호별(실행마다 · 행 · 크기) 롤링 · 이미 저장한 것 건너뛰기 · 수집 시각 · 엑셀 한글(BOM) | 파일 쓰기 노드 · 저장된 파일 미리 보기/내려받기 |
| HTML을 몰라도 동작을 만든다 — 오른쪽 라이브 페이지에서 직접 해 보면 녹화된다 | 노드 서랍 → 녹화 |
| 표 · 되풀이 목록(뉴스 · 검색 결과 · 상품 카드)을 통째로 읽는다 — 읽기 모드에서 하나를 누르면 «목록 전체로»를 제안한다(제목 · 링크 주소) | 녹화 → 읽기 |
| 버전을 만들고 게시한다 | 위쪽 «게시» |
| 도는 실행을 멈춘다 · 실패하면 다시 해 본다 · 오래 걸리면 끊는다 · 동시 실행을 줄 세운다 · 오래된 기록을 정리한다 | 실행 로그 → 멈추기 · 플로우 설정 → 실패하면 · 오래 걸리면 |
| 도는 실행의 실제 화면을 본다 — 원할 때만(보기만 · 남기지 않음) | 실행 로그 → 실제 화면 보기 |
| 돌린다 — 수동 · 일정(cron) · 웹훅 | 아래 «플로우 실행» · 위쪽 시계(트리거) |
| 사이트가 바뀌면 알린다 — 주기 점검 · 실행이 멈추면 확인 점검 · [다시 지정] | 위쪽 «감시» · 배너 |
| 로그인 정보는 시크릿으로 — 잠가 두고 다시 보이지 않는다 | 플로우 설정 |
| 보안 프로그램 사이트 — 사람이 로그인한 크롬에 붙는다(녹화도 그 크롬에서) | 플로우 설정 → 브라우저 |
| 표에서 키로 행 고르기 · 고르면 안 되는 행이면 멈춤 · 화면이 기대한 건인지 확인 · 팝업 창 · 처음만 뜨는 안내창 · 조건이 맞을 때만 하는 동작 | 녹화 제안 · 노드 설정 — [docs/RECORDING.md](docs/RECORDING.md) |

## 돌리기 (WSL · Node 24 · pnpm)

```bash
pnpm install
pnpm typecheck
pnpm test

# 시험 사이트를 띄우고 예시 플로우를 돌린다
node apps/testsite/server.ts 4300 &
echo '{"shop":{"username":"kim","password":"p@ss"}}' > /tmp/secrets.json
node packages/engine/src/cli.ts run examples/login-and-read.json --param orderNo=A-1001 --secrets /tmp/secrets.json
node packages/engine/src/cli.ts run … --headed     # 브라우저를 보면서
node packages/engine/src/cli.ts check examples/login-and-read.json
```

### 서버

```bash
# ★마스터 키가 없으면 서버가 뜨지 않는다. 키를 잃으면 저장한 시크릿을 다시 풀 수 없다
node packages/server/src/main.ts keygen > ~/.flowsmith.key && chmod 600 ~/.flowsmith.key
FLOWSMITH_MASTER_KEY_FILE=~/.flowsmith.key node packages/server/src/main.ts --port 4400 --data ./data
```

API 목록은 편집 화면의 **API**(Swagger) 또는 `GET /api/openapi.json` — 설명은 [packages/server/src/http/docs.ts](packages/server/src/http/docs.ts). 밖에서 부를 때는 API 토큰(`Authorization: Bearer fsa_…`).
환경변수: `FLOWSMITH_MASTER_KEY_FILE`(필수) · `FLOWSMITH_EXTENSIONS`(서버에 고정할 확장) · `FLOWSMITH_PLUGIN_KEYS` · `FLOWSMITH_PLUGIN_SIGNING` · `FLOWSMITH_PLUGIN_SOURCE`(확장 플러그인 — 믿는 서명 키 · 서명 끄기 · 사내 저장소) · `FLOWSMITH_ANTHROPIC_KEY` · `FLOWSMITH_GEMINI_KEY`(AI 도우미를 서버 키로 — 지금은 사람마다 «내 설정») · `FLOWSMITH_CDP_URL`(사람의 크롬) · `FLOWSMITH_MAX_RUNS`(동시 실행 · 기본 3) · `FLOWSMITH_KEEP_RUNS` · `FLOWSMITH_KEEP_DAYS`(기록 보관) · `FLOWSMITH_FILES_DIR`(파일 쓰기 · 읽기 노드의 파일 뿌리 — 기본 데이터 폴더/files) · `FLOWSMITH_PUBLIC_URL`(알림 속 링크 — 밖에서 열 주소) · `FLOWSMITH_SMTP_URL` · `FLOWSMITH_MAIL_FROM`(메일 알림) · `HOST`.
흐름: 플로우 만들기(초안) → 시크릿 넣기 → 버전 만들기(검문소 통과 필수) → 배포 → 실행(202 + SSE로 진행).

빌드 단계가 없다 — Node의 type stripping으로 `.ts`를 그대로 돌린다.
Playwright는 1.63.0(Chromium headless shell 1243).

### git — WSL 저장소를 Windows git으로도 볼 때

저장소는 WSL 안에 두고, 커밋하는 git도 WSL의 것을 쓴다. 그래도 Windows의 git · VS Code가 `\\wsl.localhost\…` 경로로 같은 폴더를 보면 아래 두 가지가 생긴다. 그래서 저장소마다 아래 설정을 한 번 해 둔다(`.git/config`에 들어가 WSL git과 Windows git이 함께 쓴다). 리눅스 · 맥 · CI에서 받은 저장소나, Windows git을 쓰지 않는 WSL 저장소에는 필요 없다.

```bash
git config core.autocrlf false   # Windows git(전역 autocrlf=true)이 파일을 CRLF로 다시 쓰지 않게
git config core.filemode false   # Windows git은 이 경로에서 실행 권한을 못 읽는다 — 755 파일이 늘 «바뀜»으로 보이지 않게
```

- ★실행 권한은 저장소에 기록된 대로 남는다(`#!`로 시작하는 `docker/workers.sh` · `packages/engine/src/cli.ts` · `packages/worker/src/main.ts`는 755). 다만 filemode를 껐으니 **새 실행 파일은 `chmod +x`만으로는 커밋에 들어가지 않는다** — `git update-index --chmod=+x <파일>`을 한 번 한다.
- 내용은 그대로인데 «바뀜»이 뜨면 줄 끝이나 권한 차이다. `git diff --ignore-cr-at-eol`이 비어 있으면 WSL에서 `git checkout -- <파일>`로 되돌린다.
