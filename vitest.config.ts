import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "extensions/*/test/**/*.test.ts"],
    // 브라우저 시험은 요소를 기다리는 시간이 있다
    testTimeout: 30_000,
    // expect.poll의 기본(1초)은 전체 시험 부하(WSL · CI)에서 모자라 흔들린다 — 기다리는 시험은 모두 넉넉하게
    expect: { poll: { timeout: 5_000, interval: 50 } },
    // 확장 플러그인 묶음(주소에 flowsmith-plugin=)은 시험기가 가로채지 않고 Node가 그대로 불러온다 — 실제 서버처럼 Node 훅(registerHooks)으로
    //  엔진 · Playwright를 찾는다(worker/src/plugins.ts installHostHooks)
    server: { deps: { external: [/flowsmith-plugin=/] } },
  },
});
