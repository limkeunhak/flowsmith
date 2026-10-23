/**
 * **팀 규칙** — 누가 무엇을 보고 · 무엇이 무엇에 닿나. 한 곳에서 정한다(PLAN §25 · §26). 순수하다.
 *
 *   팀 null   = 공용(플로우) · 모든 팀용(워커)
 *   mine null = 관리자 · 로그인 없이 — 전부 본다
 *
 * ★보안에 걸리는 곳이다 — 이 밖에서 같은 판정을 다시 쓰지 않는다(시험: test/rules.test.ts).
 */

/** 이 사람(속한 팀들)이 이 팀의 것(플로우 · 워커)을 보나 — 공용 · 모든 팀용은 모두가 본다 */
export const visibleTo = (mine: ReadonlySet<string> | null, team: string | null | undefined): boolean =>
  mine === null || team === null || team === undefined || mine.has(team);

/** 이 워커가 이 플로우를 돌리나 · 녹화하나 — 모든 팀용 워커 · 공용 플로우 · 같은 팀 */
export const workerFits = (workerTeam: string | null, flowTeam: string | null): boolean =>
  workerTeam === null || flowTeam === null || workerTeam === flowTeam;

/**
 * 이 플로우가 저 플로우에 닿나 — 다른 플로우 실행 · 파일 읽기.
 * ★대상이 공용이거나 같은 팀이어야 한다 — 공용 플로우는 공용만 부른다(공용은 모두가 보니, 공용을 거쳐 팀 것이 새지 않게)
 */
export const reaches = (fromTeam: string | null | undefined, toTeam: string | null | undefined): boolean =>
  toTeam === null || toTeam === undefined || toTeam === fromTeam;
