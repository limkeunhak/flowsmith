# @flowsmith/server

**서버** — HTTP API · 저장(SQLite · 시크릿 · 파일) · 실행 관리 · 변경 감시 · 트리거 · 녹화/실행 화면 중계. 워커는 지금 같은 프로세스에 있다.
전체 구조는 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §3.4 · §5 · §6.

```
src/
├─ main.ts · app.ts       띄우기(마스터 키 · 데이터 폴더 · 확장 · 파일 뿌리) · 조립
├─ http/
│  ├─ router.ts           작은 라우터 · 같은 출처 · 정적 파일 · 오류 모양
│  ├─ api.ts              길 모음
│  └─ routes/             flows(플로우 · 버전 · 배포 · 시크릿 · 확장) · runs(실행 · SSE · 점검) · triggers(웹훅) · files
├─ storage/               store(SQLite · 마이그레이션) · secret-box(AES-256-GCM) · secrets · files(파일 뿌리)
├─ run/                   runs(실행 관리 · 다른 플로우 부르기) · worker · monitor(변경 감시) · triggers(일정 · 웹훅 토큰) · extensions(불러오기)
└─ live/                  recorder-hub(WS /api/live) · run-screens(WS /api/runs/:id/screen)
```

```bash
node packages/server/src/main.ts keygen > ~/.flowsmith.key && chmod 600 ~/.flowsmith.key
FLOWSMITH_MASTER_KEY_FILE=~/.flowsmith.key node packages/server/src/main.ts --port 4400 --data ./data [--headed]
```

API 목록은 각 `http/routes/*.ts` 맨 위에 있다. 환경변수는 ARCHITECTURE §9.
