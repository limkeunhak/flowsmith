# @flowsmith/core

플로우 매니페스트의 **모델 · 검문소 · 의미 검사 · 표현식 · 조건 · 실행 상태**. 순수하다 — 브라우저 · 파일 · DB를 모른다.
그래서 편집 화면(브라우저)과 엔진(Node)이 같은 모델과 같은 검문소를 쓴다. 전체 구조는 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §3.1.

```
src/
├─ index.ts            바깥에 내보내는 것
├─ flow.ts             플로우 · 실행 입력 · 시크릿 · 설정 · 노드 공통 · 엣지 · 포트
├─ nodes/              노드 종류마다 — web · condition(+판정) · custom · extension · file(+이름 짓기) · flow-call
├─ model.ts            모델 모음(barrel)
├─ parse/              검문소 — checker(문제 모으기) · web · condition · nodes · flow(parseFlow · checkFlow)
├─ graph.ts            의미 검사(compile) — 비순환 · 순서 · 참조 · 금지 버튼
├─ expr.ts             표현식 — 치환만 · 시크릿 가리기
├─ run-state.ts        실행 상태 — 다음 노드 · 건너뛰기 · 합류 · 끝
├─ probe.ts            지문 비교(변경 감시)
└─ cron.ts             일정
```

- 밖에서 온 JSON은 **`parseFlow`만** `Flow`로 만든다(모양 → 의미, 문제를 한꺼번에).
- 새 노드 종류를 더하는 순서는 ARCHITECTURE §8.
- 시험: `packages/core/test` (`pnpm test packages/core`)
