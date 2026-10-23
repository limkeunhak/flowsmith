/**
 * 팀 규칙(rules/teams.ts) — 경우마다. 보안에 걸리는 판정이라 표로 못 박는다.
 */
import { describe, expect, it } from "vitest";
import { reaches, visibleTo, workerFits } from "../src/rules/teams.ts";

const A = "team-a", B = "team-b";

describe("팀 규칙", () => {
  it("★보기 — 관리자는 전부 · 공용은 모두 · 그 밖에는 내 팀만", () => {
    expect(visibleTo(null, A)).toBe(true);                    // 관리자 · 로그인 없이
    expect(visibleTo(new Set(), null)).toBe(true);            // 공용
    expect(visibleTo(new Set(), undefined)).toBe(true);       // 없는 플로우 — 길이 404를 낸다
    expect(visibleTo(new Set([A]), A)).toBe(true);
    expect(visibleTo(new Set([A]), B)).toBe(false);
    expect(visibleTo(new Set(), A)).toBe(false);              // 팀이 없는 사람은 공용만
  });

  it("★워커 — 모든 팀용 워커 · 공용 워크플로우 · 같은 팀", () => {
    expect(workerFits(null, A)).toBe(true);
    expect(workerFits(A, null)).toBe(true);
    expect(workerFits(A, A)).toBe(true);
    expect(workerFits(A, B)).toBe(false);
  });

  it("★닿기(부르기 · 파일 읽기) — 대상이 공용이거나 같은 팀 · 공용은 공용만", () => {
    expect(reaches(A, null)).toBe(true);
    expect(reaches(null, null)).toBe(true);
    expect(reaches(A, A)).toBe(true);
    expect(reaches(A, B)).toBe(false);
    expect(reaches(null, A)).toBe(false);                     // 공용 플로우가 팀 것을 부르면 새어 나간다
  });
});
