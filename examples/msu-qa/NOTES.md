# 원본과 다른 것 · 옮기지 못한 것

[gen/](gen/)의 서비스 파일에 적은 것을 모았다(gen/main.ts가 짓는다).

## MSU QA · MSU 웹 (msu-e2e-test)

- 01-landing: 새로고침 · 뒤로가기 · 지금 주소는 웹페이지 동작에 없어 커스텀 노드로
- 공통: 원본의 settle(네트워크가 조용할 때까지) 대신 고정 3~4초 기다리기

## MSU QA · Navigator (msu-e2e-test)

- 01-explorer-landing: /api/navigator/ 응답이 500 이상이면 실패로 보는 API 감시는 빠짐 — 네트워크 응답을 보는 기능이 없다
- 03-search: 원본은 검색할 캐릭터를 화면에서 고르고 지갑 주소를 .env에서 읽는다 — 여기서는 Suite 입력으로 고정(blahh · Blahh · 0x7099…79C8)
- 03-search: 소문자로 바꾸기 · 지금 주소는 표현식 · 동작에 없어 커스텀 노드로
