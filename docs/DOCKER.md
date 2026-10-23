# 도커로 띄우기 — 이 PC에서 master/worker

서버 하나와 워커 둘을 도커 컴포즈로 띄워 본다. 이미지는 하나(`Dockerfile`)이고 서버와 워커가 같이 쓴다 — node 24 · Chromium · 편집 화면이 들어 있다.

```bash
docker compose up -d --build                 # 서버 → http://localhost:4410  (처음 빌드 3분쯤)
docker compose logs server | grep -A1 설정    # 첫 관리자를 만들 «설정 토큰»
./docker/workers.sh                          # 워커 둘(«도커 워커 1 · 2», 라벨 docker)의 토큰을 만들어 .env에 적는다
docker compose --profile workers up -d       # 워커 둘이 서버에 붙는다
```

1. http://localhost:4410 을 열고 설정 토큰으로 첫 관리자를 만든다(밖으로 연 서버라 로그인이 저절로 켜진다).
2. **워커** 화면에 «도커 워커 1 · 2»가 «연결됨»으로 보인다.
3. 플로우 설정 › **실행 위치**에서 `라벨 docker`를 고르면 두 워커가 나눠 돌린다. 파일은 서버의 볼륨(`flowsmith-data:/data/files`)에 남는다.

## 무엇이 어디에

| 서비스 | 하는 일 |
|---|---|
| `server` | `HOST=0.0.0.0` · 포트 4410 → 4400 · 데이터 볼륨 `flowsmith-data`(DB · 파일 · 마스터 키 — 처음 뜰 때 만든다) |
| `worker1` · `worker2` | `node packages/worker/src/main.ts --server http://server:4400` · 토큰은 `.env`의 `WORKER1_TOKEN` · `WORKER2_TOKEN` · `workers` 프로필이라 따로 켠다 |

- 워커 토큰은 화면(워커 › 워커 더하기)에서 받아도 되고, 화면 없이 `node packages/server/src/main.ts add-worker "이름" [--labels a,b] [--slots n] --data /data`로 받아도 된다(이미 있는 이름이면 새 토큰 — 그 워커의 지금 연결은 끊긴다).
- 워커를 더 늘리려면 `compose.yaml`에 `worker3`을 같은 꼴로 더하고 토큰을 하나 더 받는다(워커 하나에 연결 하나).

## 알아 둘 것

- **시험용이다** — 워커와 서버가 http로 이야기한다(`FLOWSMITH_WORKER_ALLOW_HTTP=1`). 시크릿이 이 연결로 오가니, 사내에서는 서버 앞에 https를 둔다.
- 워커 컨테이너에는 사람의 크롬이 없다 — **브라우저를 띄우는 플로우**만 돈다. 사람의 크롬에 붙는 플로우(attach)는 그 크롬이 있는 PC에서 워커 프로그램을 켠다.
- 끄기: `docker compose --profile workers down` · 데이터까지 지우기: `docker compose --profile workers down -v`
