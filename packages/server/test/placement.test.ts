/**
 * 워커 고르기(run/placement.ts) — 연결 없이 규칙만. 받나 · 못 가는 까닭 · 자리 · 부모 자리.
 */
import { describe, expect, it } from "vitest";
import { accepts, pick, unavailable, type Seat } from "../src/run/placement.ts";
import type { WorkerRow } from "../src/storage/store.ts";

const worker = (id: string, more: Partial<WorkerRow> = {}): WorkerRow => ({
  id, name: `${id} PC`, labels: [], slots: 1, team: null, enabled: true, createdAt: "", lastSeenAt: null, info: null, flows: 0, kind: "shared", owner: null, ...more,
});
const seat = (id: string, running: string[] = []): Seat => ({ id, running: running.length, has: (r) => running.includes(r) });

describe("워커 고르기", () => {
  const a = worker("a", { labels: ["홈쇼핑"] });
  const b = worker("b", { labels: ["홈쇼핑"], slots: 2 });
  const team = worker("t", { team: { id: "주문", name: "주문팀" }, labels: ["홈쇼핑"] });
  const off = worker("off", { enabled: false });
  const all = new Map([a, b, team, off].map((w) => [w.id, w]));

  it("★받나 — 그 워커 · 그 라벨 · 꺼 둔 워커는 아니다 · 팀 전용은 그 팀 · 공용 워크플로우만", () => {
    expect(accepts(a, null, "worker:a")).toBe(true);
    expect(accepts(a, null, "worker:b")).toBe(false);
    expect(accepts(a, null, "label:홈쇼핑")).toBe(true);
    expect(accepts(off, null, "worker:off")).toBe(false);
    expect(accepts(team, "영업", "label:홈쇼핑")).toBe(false);
    expect(accepts(team, "주문", "label:홈쇼핑")).toBe(true);
  });

  it("★못 가는 까닭 — 사람 말로 · 붙은 워커가 하나라도 있으면 null", () => {
    const online = (ids: string[]) => (id: string) => ids.includes(id);
    expect(unavailable("worker:a", null, [...all.values()], online([]))).toMatch(/워커 «a PC»가 연결돼 있지 않습니다/);
    expect(unavailable("worker:off", null, [...all.values()], online(["off"]))).toMatch(/잠시 꺼 두었습니다/);
    expect(unavailable("worker:없음", null, [...all.values()], online([]))).toMatch(/지워졌습니다/);
    expect(unavailable("label:없는", null, [...all.values()], online([]))).toMatch(/라벨 «없는»이 붙은 워커가 없습니다/);
    expect(unavailable("label:홈쇼핑", null, [...all.values()], online([]))).toMatch(/하나도 연결돼 있지 않습니다/);
    expect(unavailable("label:홈쇼핑", null, [...all.values()], online(["b"]))).toBeNull();
    expect(unavailable("엉뚱", null, [...all.values()], online([]))).toMatch(/읽을 수 없습니다/);
  });

  it("★자리 — 덜 바쁜 곳 · 다 차면 기다림 · 부른 실행은 부모 자리를 함께", () => {
    expect(pick("label:홈쇼핑", null, null, [seat("a", ["r1"]), seat("b")], all)).toBe("b");
    expect(pick("label:홈쇼핑", null, null, [seat("a", ["r1"]), seat("b", ["r2", "r3"])], all)).toBeNull();
    expect(pick("worker:a", null, "r1", [seat("a", ["r1"])], all)).toBe("a");   // 부모가 a에서 돈다 — 자리가 차도
    expect(pick("worker:a", null, "남", [seat("a", ["r1"])], all)).toBeNull();
  });
});
