# @flowsmith/studio

**편집 화면** — React 19 · Vite · @xyflow/react. 서버(4400)의 API를 쓴다. 전체 구조는 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §3.5.

```
src/
├─ main.tsx · App.tsx · FlowList.tsx   들어오는 곳 · 주소(해시) · 플로우 목록
├─ api.ts                               서버 API 클라이언트
├─ model/                               초안을 고치는 순수 함수 — nodes(새 노드 · 동작 · normalize) · describe(사람 말로) · graph(입출력 · 포트 · 노드 넣기)
├─ editor/
│  ├─ FlowEditor.tsx                    편집기 셸 — 위쪽 막대 · 캔버스 · 서랍 · 실행 로그
│  ├─ canvas/                           캔버스 · 노드 고르기
│  ├─ inspectors/                       노드 서랍 · 노드 종류마다의 설정
│  ├─ record/                           녹화 패널
│  ├─ run/                              실행 시작 · 실행 로그 · 실행 기록 · 진행 구독
│  ├─ monitor/                          변경 감시
│  ├─ settings/                         플로우 설정 · 트리거
│  └─ widgets.tsx                       공통 입력
├─ live/                                라이브 페이지(녹화) · 실행 화면 보기 · WebSocket 전송
├─ icons.tsx · styles.css
└─ ext-meta.ts                          확장 정보의 모양
```

```bash
pnpm studio:dev      # 개발 — /api는 4400으로 넘긴다(FLOWSMITH_API로 바꿈)
pnpm studio:build    # dist/ → 서버가 함께 내준다
```
