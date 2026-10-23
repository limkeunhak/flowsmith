# @flowsmith/engine

플로우를 **돌린다** — `runFlow`가 노드를 순서대로 실행하고, 웹페이지 노드는 Playwright로 브라우저를 다룬다.
전체 구조는 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §3.2 · §5.1.

```
src/
├─ index.ts             바깥에 내보내는 것
├─ run.ts               runFlow — 컴파일 · 노드 순서 · 이벤트 · 결과 · 시크릿/개인정보 가림 · 점검 모드 · 페이지 알림
├─ nodes/               노드 실행기
│  ├─ web-node.ts         웹페이지(동작 · 팝업 창 · 있을 때만 · 조건이 맞을 때만)
│  ├─ custom-node.ts      커스텀(node:vm · 시간 제한)
│  ├─ extension-node.ts   확장
│  ├─ file-write-node.ts  파일 쓰기     ┐
│  ├─ file-read-node.ts   파일 읽기     ├ file-common.ts(파일 뿌리 · CSV · 오류)
│  └─ flow-call-node.ts   다른 플로우 실행(callFlow 갈고리)
├─ browser/             브라우저
│  ├─ browser-session.ts  launch · attach(CDP) · 탭 · 팝업 따라가기
│  ├─ primitives.ts       금지 버튼 가드 · 누르기 · 넣기 · 읽기 · 표 · 행 고르기 · 기다리기
│  └─ locate.ts           위치 → locator · 정확히 하나 · 후보
├─ probe.ts             점검 실행(지문 · 보고서)
├─ extensions.ts        확장 레지스트리
├─ errors.ts            실패의 모양
└─ cli.ts               터미널에서 돌리기 · 검사하기
```

```bash
node packages/engine/src/cli.ts run examples/login-and-read.json --param orderNo=A-1001 --secrets /tmp/secrets.json
node packages/engine/src/cli.ts check examples/login-and-read.json
```

runFlow가 바깥에서 받는 것(`RunOptions`): 브라우저 · 페이지 · 시크릿 · 실행 입력 · `cdpUrl` · `extensions` · `files`(파일 뿌리 · uid) · `callFlow`(다른 플로우 실행) · `onPage`(실행 화면) · `probe` · `onEvent`.
