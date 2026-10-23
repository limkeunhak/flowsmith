# Flowsmith — 서버와 워커가 같은 이미지를 쓴다(compose.yaml).
#   node 24(타입 지우기로 .ts를 그대로 돌린다 · 빌드 없음) · pnpm · Chromium(Playwright) · 편집 화면 빌드
FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    TZ=Asia/Seoul \
    CI=1
RUN corepack enable

WORKDIR /app
# 의존성 — 매니페스트만 먼저(코드를 고쳐도 이 층은 다시 받지 않는다)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/engine/package.json packages/engine/
COPY packages/recorder/package.json packages/recorder/
COPY packages/worker/package.json packages/worker/
COPY packages/server/package.json packages/server/
COPY packages/pack/package.json packages/pack/
COPY apps/studio/package.json apps/studio/
COPY apps/testsite/package.json apps/testsite/
RUN pnpm install --frozen-lockfile
# Chromium과 그 OS 꾸러미(한글 글꼴 포함)
RUN pnpm --filter @flowsmith/engine exec playwright install --with-deps chromium \
 && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm studio:build

# 기본은 서버 — compose가 워커는 command로 바꾼다
EXPOSE 4400
CMD ["node", "packages/server/src/main.ts", "--port", "4400", "--data", "/data"]
