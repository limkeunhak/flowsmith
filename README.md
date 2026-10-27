<p align="center">
  <img src="apps/studio/public/favicon.svg" width="112" height="112" alt="Flowsmith">
</p>

<h1 align="center">Flowsmith</h1>

<p align="center">웹에서 하는 일을 녹화해 플로우로 만들고, 배포하고, 돌리는 자동화 엔진</p>

웹 페이지에서 하는 일을 **노드**로, 데이터 흐름을 **엣지**로 그린 비순환 그래프를 만들고, 버전을 게시해 수동 · 일정 · 웹훅으로 돌린다.
HTML을 몰라도 된다 — 오른쪽 라이브 페이지에서 직접 해 보면 동작이 녹화된다.

**기본은 웹이다** — 서버(사내 · 도커)를 띄우고 브라우저로 편집 화면을 연다. 실행은 서버나 워커(도커 · 사람 PC)에서 한다.
**데스크톱 앱(Windows · macOS)은 골라 쓴다** — 설치 파일 하나로 같은 일(로컬 모드 · 회사 서버에 붙기)을 하고, 앱 안 브라우저(진짜 페이지에서 녹화 · 실행 창)가 더 있다([docs/DESKTOP.md](docs/DESKTOP.md) §15).

## 할 수 있는 것

**만들기**
- 노드: 웹페이지 · 조건 · HTTP 요청 · 값 다듬기 · 검사 · 승인 기다리기 · 파일 쓰기 · 파일 읽기 · 다른 워크플로우 실행 · 커스텀 코드 · 확장
- 녹화로 동작 만들기 — 누르기 · 넣기 · 고르기 · 체크 · 읽기 · 표와 되풀이 목록 통째로 읽기 · 표에서 키로 행 고르기 · 팝업 · 새 창 · 브라우저 확인창 · 처음만 뜨는 안내창
- 값이 늦게 바뀌는 화면에서 «값이 그대로일 때까지 · 바뀔 때까지» 기다리기, 넣은 칸 다시 확인 — 틀린 값이 성공처럼 보이지 않게
- 버전 게시 · 버전 비교 · 워크플로우 복제 · 실행 입력 · 변수 · 시크릿(잠가 두고 다시 보이지 않음)

**돌리기**
- 수동 · 일정(cron) · 웹훅 · 다른 워크플로우가 끝나면 · 파일이 생기면
- 실패하면 다시 해 보기 · 전체 시간 제한 · 자원 잠금으로 줄 세우기 · 동작 사이 쉬기 · 멈추기
- 서버에서, 또는 워커(라벨로 나눠 돌리기)에서 — 보안 프로그램 사이트는 사람이 로그인한 크롬에 붙어서(CDP)
- 도는 실행의 실제 화면 보기 · 실행 로그 · 대시보드(실패율 · 실행 시간 P95)

**지키기**
- 사이트가 바뀌면 알린다 — 주기 점검 · 실행이 «요소 없음»으로 멈추면 확인 점검 · 화면에서 [다시 지정]
- 금지 버튼 · 되돌릴 수 없는 동작 앞에서 멈추는 점검 · 꺼진 단추를 누른 척하지 않기
- 알림 — Slack · Teams · 메일 · 웹훅(실패 · 회복 · 성공 · 멈춤 · 사이트가 바뀜)

**사내 운영**
- 로그인 · 역할(관리자 · 편집자 · 실행자 · 보는 사람) · 팀 · 팀 공용 변수와 시크릿
- 열린 API — Swagger 화면 · `GET /api/openapi.json` · API 토큰(`Authorization: Bearer fsa_…`)
- 확장 플러그인 — 서명한 묶음(.fspkg) · 사내 저장소 · 워커로 나눠 주기

영역별 · 날짜별 전체 목록은 [docs/FEATURES.md](docs/FEATURES.md).

## 구성

```
packages/core       모델 · 검문소 · 그래프 · 표현식 · 조건 · 실행 상태 — 순수(브라우저 · 파일 · DB를 모른다)
packages/engine     실행기 runFlow · 노드 실행기(nodes/) · 브라우저(browser/) · 점검 · 확장 레지스트리 · CLI
packages/recorder   녹화 세션 · 페이지에 심는 스크립트 · 녹화 제안 · 메시지 약속
packages/server     HTTP API(http/) · 저장(storage/) · 실행 관리 · 감시 · 트리거(run/) · 녹화/실행 화면 중계(live/)
packages/worker     워커 — 서버 안(같은 프로세스) 또는 사람 PC에서 서버에 붙어 실행 · 녹화
packages/pack       flowsmith-ext — 확장 폴더를 플러그인 묶음으로 빌드 · 서명 키 · 사내 저장소 목록
apps/studio         편집 화면(React · Vite) — 캔버스 · 노드 서랍 · 녹화 · 실행 로그 · 감시 · 트리거 · 파일 · 대시보드
apps/desktop        데스크톱 앱(Electron) — 편집 화면 + 이 PC의 서버 · 워커 · 설치본
apps/testsite       시험용 작은 쇼핑몰(로그인 · 조회 · 표 · iframe · 뉴스 목록 · 금지 버튼 · /__layout?v=2 바뀐 척)
examples/           예시 플로우
Dockerfile · compose.yaml · docker/   서버 하나 · 워커 둘을 도커로
```

## 시작하기

Node 24 이상 · pnpm. 빌드 단계가 없다 — Node의 type stripping으로 `.ts`를 그대로 돌린다. Playwright는 1.63.0(Chromium headless shell 1243).

```bash
pnpm install
pnpm typecheck
pnpm test
```

### 서버와 편집 화면

```bash
# ★마스터 키가 없으면 서버가 뜨지 않는다. 키를 잃으면 저장한 시크릿을 다시 풀 수 없다
node packages/server/src/main.ts keygen > ~/.flowsmith.key && chmod 600 ~/.flowsmith.key

pnpm studio:build     # 편집 화면을 빌드해 두면 서버가 같이 내준다 → http://localhost:4400
FLOWSMITH_MASTER_KEY_FILE=~/.flowsmith.key node packages/server/src/main.ts --port 4400 --data ./data

pnpm studio:dev       # 편집 화면을 고치는 중이면 — vite(5173)가 /api를 서버(4400)로 넘긴다
```

흐름: 플로우 만들기(초안) → 시크릿 넣기 → 버전 만들기(검문소 통과 필수) → 게시 → 실행(202 + SSE로 진행).

### 워커

워커를 붙이지 않으면 서버 혼자 돈다. 붙일 때는 «워커» 화면에서 토큰을 받아 그 PC에서 켠다.

```bash
FLOWSMITH_WORKER_TOKEN=<받은 토큰> node packages/worker/src/main.ts --server https://studio.사내 [--headed]
```

도커로 서버 하나 · 워커 둘을 띄우는 법은 [docs/DOCKER.md](docs/DOCKER.md).

### CLI — 서버 없이 플로우 하나 돌리기

```bash
node apps/testsite/server.ts 4300 &
echo '{"shop":{"username":"kim","password":"p@ss"}}' > /tmp/secrets.json
node packages/engine/src/cli.ts run examples/login-and-read.json --param orderNo=A-1001 --secrets /tmp/secrets.json
node packages/engine/src/cli.ts run … --headed     # 브라우저를 보면서
node packages/engine/src/cli.ts check examples/login-and-read.json
```

### 서버 환경변수

| 변수 | 무엇 |
|---|---|
| `FLOWSMITH_MASTER_KEY_FILE` | **필수** — 시크릿을 잠그는 마스터 키 파일 |
| `HOST` | 듣는 주소 — 밖으로 열면 로그인이 저절로 켜진다 |
| `FLOWSMITH_PUBLIC_URL` | 알림 속 링크 — 밖에서 열 주소 |
| `FLOWSMITH_MAX_RUNS` | 동시 실행(기본 3) |
| `FLOWSMITH_KEEP_RUNS` · `FLOWSMITH_KEEP_DAYS` | 실행 기록 보관 |
| `FLOWSMITH_FILES_DIR` | 파일 쓰기 · 읽기 노드의 파일 뿌리(기본 데이터 폴더/files) |
| `FLOWSMITH_SMTP_URL` · `FLOWSMITH_MAIL_FROM` | 메일 알림 |
| `FLOWSMITH_CDP_URL` | 사람의 크롬에 붙을 주소 |
| `FLOWSMITH_WALLET_DIR` · `FLOWSMITH_METAMASK_ZIP` | 지갑 브라우저 — 지갑 프로필 폴더 · 사내망용 MetaMask 묶음 |
| `FLOWSMITH_EXTENSIONS` | 서버에 고정할 확장 |
| `FLOWSMITH_PLUGIN_KEYS` · `FLOWSMITH_PLUGIN_SIGNING` · `FLOWSMITH_PLUGIN_SOURCE` | 확장 플러그인 — 믿는 서명 키 · 서명 끄기 · 사내 저장소 |
| `FLOWSMITH_ANTHROPIC_KEY` · `FLOWSMITH_GEMINI_KEY` | AI 도우미를 서버 키로(없으면 사람마다 «내 설정») |

API 목록은 편집 화면의 **API**(Swagger) 또는 `GET /api/openapi.json` — 설명은 [packages/server/src/http/docs.ts](packages/server/src/http/docs.ts).

## 문서

| 문서 | 무엇 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **시스템 구조** — 구성도 · 패키지와 컴포넌트 · 데이터 모델 · 핵심 흐름 · 저장 · 안전장치 · 확장 지점 |
| [docs/FEATURES.md](docs/FEATURES.md) | 지금까지 만든 기능(영역별 · 단계별) · 아직 아닌 것 |
| [docs/PLAN.md](docs/PLAN.md) | 계획과 결정 — 왜 이렇게 만들었나 |
| [docs/RECORDING.md](docs/RECORDING.md) | 녹화로 플로우 만들기 — 사람의 크롬 · CDP 브리지 · 행 고르기 · 확인 · 팝업 · 확인창 · 새 창 |
| [docs/DOCKER.md](docs/DOCKER.md) | 도커 컴포즈로 이 PC에서 master/worker 띄우기(서버 하나 · 워커 둘) |
| [docs/DESKTOP.md](docs/DESKTOP.md) | 데스크톱 앱(선택) · 지갑 브라우저 설계 — 앱 하나 브라우저 둘(앱 안 · MetaMask 크롬) · 단계 · 웹과 앱에서 되는 것(§15) |
| `packages/*/README.md` · `apps/studio/README.md` | 패키지마다의 모듈 지도 |

## 개발 메모 — WSL 저장소를 Windows git으로도 볼 때

저장소는 WSL 안에 두고, 커밋하는 git도 WSL의 것을 쓴다. 그래도 Windows의 git · VS Code가 `\\wsl.localhost\…` 경로로 같은 폴더를 보면 아래 두 가지가 생긴다. 그래서 저장소마다 아래 설정을 한 번 해 둔다(`.git/config`에 들어가 WSL git과 Windows git이 함께 쓴다). 리눅스 · 맥 · CI에서 받은 저장소나, Windows git을 쓰지 않는 WSL 저장소에는 필요 없다.

```bash
git config core.autocrlf false   # Windows git(전역 autocrlf=true)이 파일을 CRLF로 다시 쓰지 않게
git config core.filemode false   # Windows git은 이 경로에서 실행 권한을 못 읽는다 — 755 파일이 늘 «바뀜»으로 보이지 않게
```

- ★실행 권한은 저장소에 기록된 대로 남는다(`#!`로 시작하는 `docker/workers.sh` · `packages/engine/src/cli.ts` · `packages/worker/src/main.ts`는 755). 다만 filemode를 껐으니 **새 실행 파일은 `chmod +x`만으로는 커밋에 들어가지 않는다** — `git update-index --chmod=+x <파일>`을 한 번 한다.
- 내용은 그대로인데 «바뀜»이 뜨면 줄 끝이나 권한 차이다. `git diff --ignore-cr-at-eol`이 비어 있으면 WSL에서 `git checkout -- <파일>`로 되돌린다.
