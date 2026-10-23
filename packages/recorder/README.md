# @flowsmith/recorder

**녹화 세션** — 라이브 페이지 위에서 사람이 한 일을 웹페이지 노드의 동작으로 바꾼다. ★녹화가 곧 재생 시험이다:
페이지가 가로챈 누르기를 서버가 위치 후보로 다시 찾아 «정확히 하나 + 바로 그 요소»인지 확인하고, 엔진의 Primitives로 대신 누른다.
전체 구조는 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §3.3 · §5.2, 쓰는 법은 [docs/RECORDING.md](../../docs/RECORDING.md).

```
src/
├─ index.ts      바깥에 내보내는 것
├─ session.ts    RecorderSession — 컨텍스트 · 화면 전송 · 앞 단계 재생 · 입력 중계 · 녹화 처리 · 팝업 · 사람의 크롬
├─ inject.js     페이지에 심는 스크립트 — 가로채기 · 위치 후보 · 표 · 되풀이 목록 · 떠 있는 창
├─ suggest.ts    녹화 제안 — 읽기 이름 · 내용 위치 버리기 · 행 고르기의 키 칸 · 출력 이름
├─ replay.ts     앞 단계 재생용 플로우
└─ protocol.ts   화면 ↔ 서버 메시지(타입만 — 편집 화면이 `@flowsmith/recorder/protocol`로 가져간다)
```

★`inject.js`의 듣기는 `window`에 단다 — 팝업은 처음 about:blank 문서가 같은 출처 문서로 바뀔 때 Window를 그대로 쓴다.
`inject.js`의 지문 규칙은 engine `probe.ts`의 `fingerprintIn`과 같아야 한다(시험이 지킨다).
