#!/bin/sh
# 워커 둘의 토큰을 만들어 .env에 적는다 — 서버(docker compose up -d)가 떠 있어야 한다.
# 다시 돌리면 새 토큰이 나온다(그 워커의 지금 연결은 끊긴다 → docker compose --profile workers up -d 로 다시 붙인다).
set -e
cd "$(dirname "$0")/.."
token() { docker compose exec -T server node packages/server/src/main.ts add-worker "$1" --labels docker --data /data; }
t1=$(token "도커 워커 1")
t2=$(token "도커 워커 2")
touch .env
grep -v '^WORKER[12]_TOKEN=' .env > .env.tmp || true
mv .env.tmp .env
printf 'WORKER1_TOKEN=%s\nWORKER2_TOKEN=%s\n' "$t1" "$t2" >> .env
echo "워커 토큰을 .env에 적었습니다 — 이제: docker compose --profile workers up -d"
