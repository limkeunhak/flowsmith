# MSU QA 파일럿 — msu-e2e-test 시나리오를 Flowsmith로

msu-e2e-test(사내 GitLab `webtest-automation` — Playwright로 qa.msu.io를 검증하는 E2E 스위트)의 **지갑 없는(visitor) 시나리오 11개**를 워크플로우 + Suite로 옮긴 것이다. Flowsmith로 웹 e2e 테스트를 얼마나 옮길 수 있는지 보려는 파일럿이다.

```bash
node examples/msu-qa/import.ts --server http://127.0.0.1:4400          # 올리기(여러 번 돌려도 된다)
node examples/msu-qa/import.ts --server http://127.0.0.1:4400 --run    # 올리고 한 번 돌려 판정까지
FLOWSMITH_TOKEN=fsa_… node examples/msu-qa/import.ts --server https://studio.사내   # 로그인이 켜진 서버
```

워크플로우를 만들거나(있으면 초안을 바꿔) 버전으로 굳혀 게시하고, 같은 이름의 Suite가 있으면 시나리오를 바꾸고 없으면 만든다. 편집 화면의 **테스트**에서 «MSU QA 파일럿 (msu-e2e-test)»을 열어 돌려도 된다.

## 시나리오

| 원본 스펙 | Suite 시나리오 | 워크플로우 |
|---|---|---|
| `msuweb/01-landing` | 비회원 메인 — 헤더 · 푸터 · 로그인 진입점 | `msuweb-main-visitor` |
| | /about · /notices · /builder-apps 직접 진입(입력만 바꿔 세 번) | `msuweb-direct-route` |
| | 없는 경로는 Not Found | `msuweb-not-found` |
| | 새로고침 · 뒤로가기 | `msuweb-reload-back` |
| `navigator/01-explorer-landing` | 비회원 탐색 화면 — 지표 · 검색 | `navigator-landing-visitor` |
| | 랭킹 기간 필터 | `navigator-ranking-period` |
| `navigator/03-search` | 이름 검색 → 상세 | `navigator-search-name` |
| | 대소문자 무관 검색 | `navigator-search-case` |
| | 지갑 주소 검색 → 소유자 상세 | `navigator-search-address` |

모양은 모두 같다 — **웹페이지 노드**(열고 · 읽고) → (필요하면 **커스텀 노드**) → **검사 노드**(판정). 검사 노드의 항목이 원본의 `expect` 하나하나다.

- «보인다»는 «있을 때만» 읽기 + 검사 «비어 있지 않다» — 없으면 오류가 아니라 불통과로 남는다
- «내부 정보를 흘리지 않는다»는 원본과 같은 8개 문구(`TypeError` · `ECONNREFUSED` · `Traceback` …)를 본문에서 «포함하지 않는다»로

## 원본과 다른 것

- **코드로 한 것** — 지금 주소 · 제목 읽기, 새로고침 · 뒤로가기, 소문자로 바꾸기. 웹페이지 동작과 표현식에 없다(커스텀 노드 몇 줄)
- **빠진 것** — 탐색 화면의 API 감시(`/api/navigator/` 응답이 500 이상이면 실패). 네트워크 응답을 보는 기능이 없다
- **고정한 데이터** — 원본은 검색할 캐릭터를 화면에서 고르고 지갑 주소를 `.env`에서 읽는다. 여기서는 Suite 입력으로 `blahh` · `Blahh` · `0x7099…79C8`(QA 테스트 지갑, Hardhat #1)을 준다 — QA 데이터가 바뀌면 입력을 바꾼다
- **기다리기** — 원본의 `settle`(네트워크가 조용할 때까지, 최대 3초) 대신 고정 4~5초
- **검색 칸** — Navigator에는 검색 칸이 둘(헤더 `#global_search_input` · 본문 `#form_search_input`) 보인다. 대상은 정확히 하나여야 해서 원본의 `.first()`가 고르던 헤더 쪽으로 정했다
