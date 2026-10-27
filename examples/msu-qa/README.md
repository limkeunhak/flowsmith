# MSU QA — msu-e2e-test 시나리오를 Flowsmith로

msu-e2e-test(사내 GitLab `webtest-automation` — Playwright로 qa.msu.io를 검증하는 E2E 스위트)의 **지갑 없는(visitor) 시나리오 82개**를 워크플로우 72개 + 서비스마다 Suite 하나로 옮긴 것이다. Flowsmith로 웹 e2e 테스트를 얼마나 옮길 수 있는지 보려는 예시다.

| Suite | 원본 | 시나리오 |
|---|---|---|
| MSU QA · MSU 웹 | `tests/msuweb/` 01 · 02 · 03 · 04 · 05 · 06 · 08 · 09 | 34 |
| MSU QA · Navigator | `tests/navigator/` 01 · 03 · 04 · 05 · 06 · 07 · 09 · 10 · 11 · 12 · 13 · 14 | 37 |
| MSU QA · 마켓플레이스 | `tests/marketplace/` 03 · 04 · 05 · 06 · 07 · 09 | 7 |
| MSU QA · Swap & Warp | `tests/swapnwarp/` 01 · 04 | 4 |

지갑 · 로그인이 필요한 시나리오(member · wallet)는 아직 옮기지 않았다.

## 올리기 · 돌리기

```bash
node examples/msu-qa/import.ts --server http://127.0.0.1:4400              # 올리기(여러 번 돌려도 된다)
node examples/msu-qa/import.ts --server http://127.0.0.1:4400 --run        # 올리고 Suite마다 돌려 판정까지
node examples/msu-qa/import.ts --server http://127.0.0.1:4400 navigator    # 그 서비스만
FLOWSMITH_TOKEN=fsa_… node examples/msu-qa/import.ts --server https://studio.사내   # 로그인이 켜진 서버
```

워크플로우를 만들거나(있으면 초안을 바꿔) 서비스 묶음(이름 앞말 — Navigator · MSU 웹 …)에 넣고 버전으로 굳혀 게시하고, 같은 이름의 Suite가 있으면 시나리오를 바꾸고 없으면 만든다. 편집 화면의 **테스트**에서 Suite를 열어 돌려도 된다.

## 고치기

`flows/` · `suites/` · `NOTES.md`는 **지은 것**이다 — 손으로 고치지 말고 [gen/](gen/)을 고쳐 다시 짓는다.

```bash
node examples/msu-qa/gen/main.ts              # 다 짓기
node examples/msu-qa/gen/main.ts navigator    # 그 서비스만
```

| 파일 | 무엇 |
|---|---|
| `gen/lib.ts` | 동작 · 대상 · 검사 · 노드를 짓는 손 |
| `gen/<서비스>.ts` | 서비스마다 Suite 하나 — 큰 서비스는 `-a` · `-b` 조각으로 나눠 적고 합친다 |
| `gen/main.ts` | `flows/<서비스>-*.json` · `suites/<서비스>.json` · `NOTES.md`를 쓴다(id 겹침 · 없는 워크플로우를 막는다) |

시나리오 하나는 원본 `test()` 하나다. 모양은 모두 같다 — **웹페이지 노드**(열고 · 읽고) → (필요하면 **커스텀 노드**) → **검사 노드**(판정). 검사 노드의 항목이 원본의 `expect` 하나하나다.

- 대상은 «정확히 하나»여야 한다(엔진이 여러 개면 멈춘다) — 둘 잡히면 id · `:visible` · xpath `(…)[1]`로 좁힌다
- «보인다»는 «있을 때만» 읽기 + 검사 «비어 있지 않다» — 없으면 오류가 아니라 불통과로 남는다
- 화면에서 데이터를 고를 수 있으면 고르고(링크를 읽어 다음 노드가 연다), 안 되면 Suite 입력으로 고정하고 NOTES.md에 적는다

## QA에서 돌린 결과

82개 중 79개 통과, 3개 불통과. 불통과는 플로우가 아니라 화면 · 원본 가정 때문이다.

| 시나리오 | 무엇 | 본 것 |
|---|---|---|
| MSU 웹 `w05a` 상세 이동용 요청이 실패해도 공지 상세는 열린다 | **제품 결함 후보** | 클릭 때 `?_rsc=` 요청이 500이면 전체 로드로 넘어가지 않고 목록에 머문다(순수 Playwright로도 재현) |
| Navigator `n06b` More를 누르면 목록이 늘어나고 … | **제품 결함 후보** | 지갑 머리는 Character 43인데 목록 응답은 28 + 10 = 38에서 끝난다 |
| Navigator `n11b` 거래 종류를 고르면 그 종류만 남고 … | 원본 가정 | Mint + Sale 필터의 첫 쪽 30행이 모두 Sale — Mint는 More 뒤에 있다. 원본도 첫 쪽만 봐서 같이 깨진다 |

옮기다 본 원본 쪽 문제 — `msuweb/03-responsive` «모바일에서는 GNB가 접혀 있고 햄버거로 열 수 있다»는 390px에서 햄버거를 열기 전에도 푸터 nav의 링크가 보여 그것을 집으므로, 실제로는 아무것도 확인하지 못한다.

## 원본과 다른 것

시나리오마다 [NOTES.md](NOTES.md)에 있다. 자주 나온 것:

- **코드로 한 것** — 지금 주소 · 새로고침 · 뒤로가기 · 화면 크기 · 쿠키 · 요청 가로채기 · 마우스 올리기 · 개수 세기 · «모든 행이 …». 웹페이지 동작 · 검사 연산에 없다(커스텀 노드 몇 줄)
- **빠진 것** — API 응답 감시(`/api/navigator/` 5xx면 실패). 네트워크 응답을 보는 동작이 없다
- **기다리기** — 원본의 `settle` · `expect.poll` 대신 고정 3~6초
