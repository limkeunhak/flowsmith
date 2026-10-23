import { describe, expect, it } from "vitest";
import { CronError, cronMatches, describeCron, minuteKey, nextFires, parseCron } from "../src/index.ts";

const at = (s: string) => new Date(s);   // 현지 시각으로 읽힌다

describe("cron", () => {
  it("칸 · 목록 · 범위 · 간격", () => {
    const c = parseCron("*/15 9-18 * * 1-5");
    expect([...c.minute]).toEqual([0, 15, 30, 45]);
    expect([...c.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect([...c.weekday]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("0 0 1,15 * 7").weekday]).toEqual([0]);   // 7은 일요일
  });

  it("맞는 분 — 평일 9시", () => {
    const c = parseCron("0 9 * * 1-5");
    expect(cronMatches(c, at("2026-10-16T09:00:00"))).toBe(true);    // 금
    expect(cronMatches(c, at("2026-10-17T09:00:00"))).toBe(false);   // 토
    expect(cronMatches(c, at("2026-10-16T09:01:00"))).toBe(false);
  });

  it("일 · 요일이 둘 다 정해지면 하나라도 맞으면 된다", () => {
    const c = parseCron("0 8 1 * 1");
    expect(cronMatches(c, at("2026-10-01T08:00:00"))).toBe(true);    // 1일(목)
    expect(cronMatches(c, at("2026-10-19T08:00:00"))).toBe(true);    // 월요일
    expect(cronMatches(c, at("2026-10-20T08:00:00"))).toBe(false);
  });

  it("다음 시각들", () => {
    expect(nextFires("30 9 * * 1-5", at("2026-10-16T09:30:00"), 3).map(minuteKey)).toEqual(["2026-10-19T09:30", "2026-10-20T09:30", "2026-10-21T09:30"]);
  });

  it("틀린 것은 사람 말로 거부한다", () => {
    expect(() => parseCron("0 9 * *")).toThrow(/5개/);
    expect(() => parseCron("60 9 * * *")).toThrow(/분 칸 "60"/);
    expect(() => parseCron("0 9 * * mon")).toThrow(CronError);
    expect(() => parseCron("*/0 * * * *")).toThrow(/간격/);
  });

  it("사람 말 풀이", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("평일 9시");
    expect(describeCron("30 18 * * *")).toBe("매일 18시 30분");
    expect(describeCron("*/10 * * * *")).toBe("10분마다");
    expect(describeCron("0 * * * *")).toBe("매시 정각");
    expect(describeCron("0 * * * 1-5")).toBe("평일 매시 정각");
    expect(describeCron("0 8 1 * *")).toBe("1일 8시");
    expect(describeCron("0 9 * * 1,3")).toBe("월, 수요일 9시");
  });
});

import { checkFlow } from "../src/index.ts";

describe("일정의 검사", () => {
  const flow = (schedules: unknown[]) => ({
    schemaVersion: 1, id: "f", name: "f", params: [{ name: "orderNo", label: "주문번호", required: true }],
    settings: { schedules },
    nodes: [{ id: "c", type: "custom", name: "c", position: { x: 0, y: 0 }, config: { code: "return {}", outputs: [] } }], edges: [],
  });
  it("cron 문법 · 정의되지 않은 입력 · 빠진 필수 입력", () => {
    expect(checkFlow(flow([{ id: "s1", cron: "0 9 * * 1-5", params: { orderNo: "A-1" } }]))).toEqual([]);
    expect(checkFlow(flow([{ id: "s1", cron: "0 25 * * *", params: { orderNo: "A-1" } }])).join()).toMatch(/시 칸 "25"/);
    expect(checkFlow(flow([{ id: "s1", cron: "0 9 * * *", params: { orderNo: "A-1", nope: "x" } }])).join()).toMatch(/"nope"가 정의되지 않았습니다/);
    expect(checkFlow(flow([{ id: "s1", cron: "0 9 * * *", params: {} }])).join()).toMatch(/필수 실행 입력 '주문번호'/);
  });
});
