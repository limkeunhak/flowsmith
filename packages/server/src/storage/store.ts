/**
 * **저장소** — SQLite (`node:sqlite`). 나중에 Postgres로 옮긴다 (PLAN §4.2).
 *
 *   flow          플로우마다 **초안** 하나 — 고쳐 쓴다. 틀려 있어도 저장된다(편집 중이니까). 직접 지정한 화면(group_name)은 초안 밖의 이름표
 *   flow_version  초안을 굳힌 것 — ★검문소를 통과한 것만, 덮어쓰지 않는다
 *   (배포)        flow.active_version — «이 버전을 활성으로»
 *   secret        잠긴 시크릿 값. 평문은 이 파일 어디에도 없다
 *   run           실행 기록 — 엔진이 가린 결과를 그대로 둔다
 *   notice        보낸 알림 — 언제 · 무엇을 · 어디로(규칙 id) · 됐나. ★주소는 두지 않는다(시크릿일 수 있다)
 *   app_user      사람 — 메일 · 이름 · 역할 · 비밀번호 해시(scrypt). ★비밀번호 자체는 어디에도 없다
 *   session       로그인 — 쿠키 토큰의 **해시**만 · 언제까지
 *   api_token     밖에서 API를 부르는 토큰(Bearer fsa_…) — 사람마다 · 역할은 그 사람 이하 · 해시만 · 끝나는 날(없어도 된다)
 *   suite · suite_run · suite_fire  웹 e2e 테스트 묶음 — 시나리오(게시된 플로우) · 한 번 돈 것(판정) · 일정
 *   run_shot      검사가 불통과였을 때의 페이지 한 장
 *   shared_value  팀 공용 값 — 팀(또는 모두)이 함께 쓰는 변수 · 잠긴 시크릿. 플로우는 제 팀 → 공용 차례로 찾는다
 *   area          화면 규칙 — 주소 앞부분 → 화면 이름(목록이 이 이름으로 묶는다 · flow.group_name은 틀린 것만 직접 지정)
 *   file_trigger · file_seen  파일이 생기면 — 무엇을 보나 · 이미 본 파일(같은 파일로 두 번 돌지 않게)
 *   team · team_member  팀과 사람 — 플로우는 한 팀에 속한다(flow.team_id, 없으면 «공용» — 모두가 본다)
 *   worker        실행을 받아 가는 PC(젠킨스의 노드) — 라벨 · 동시 실행 수 · 팀 · 토큰 해시. 플로우는 어디서 돌지(flow.run_on),
 *                 실행은 어디서 돌았는지(run.ran_on — 그때의 워커 이름)를 적는다
 *   (누가)        run.started_by · flow_version.created_by · flow.updated_by — 그때의 메일을 적는다(감사 기록)
 *
 * ★버전을 읽을 때도 `parseFlow`를 다시 거친다. DB를 손으로 고쳤거나 스키마가 바뀌었을 수 있다 —
 *  검문소는 «들어올 때 한 번»이 아니라 «쓰기 전에 언제나»다.
 *
 * 몸은 표마다의 저장소 넷이다 — flows.ts · history.ts · people.ts · workers.ts(+ db.ts 스키마 · rows.ts 도우미 · types.ts 모양).
 * 이 클래스는 겉모양이다: 부르는 쪽(길 · 실행 관리 · 시험)은 `store.이름()` 하나만 안다. 아래 목록이 곧 저장소의 목차다.
 */
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "./db.ts";
import { FlowRepo } from "./flows.ts";
import { HistoryRepo } from "./history.ts";
import { PeopleRepo } from "./people.ts";
import { WorkerRepo } from "./workers.ts";
import { SharedRepo } from "./shared.ts";
import { SuiteRepo } from "./suites.ts";
import { PluginRepo } from "./plugins.ts";
import { AiRepo } from "./ai.ts";
import { AreaRepo } from "./areas.ts";

export * from "./types.ts";
export type { SharedKind, SharedRow } from "./shared.ts";
export type { AreaRule } from "./areas.ts";
export type { PluginRow, PluginVersionRow, PluginEvent } from "./plugins.ts";
export type { Suite, SuiteItem, SuiteRun, SuiteRunItem, SuiteRunStatus, SuiteSchedule, SuiteNotifyRule } from "./suites.ts";

export class Store {
  readonly #db: DatabaseSync;
  readonly #flows: FlowRepo;
  readonly #history: HistoryRepo;
  readonly #people: PeopleRepo;
  readonly #workers: WorkerRepo;
  readonly #shared: SharedRepo;
  readonly #areas: AreaRepo;
  readonly #suites: SuiteRepo;
  readonly #plugins: PluginRepo;
  readonly #ai: AiRepo;

  /** `:memory:`도 된다(시험) */
  constructor(path: string) {
    this.#db = openDb(path);
    this.#flows = new FlowRepo(this.#db, this);
    this.#history = new HistoryRepo(this.#db, this);
    this.#people = new PeopleRepo(this.#db, this);
    this.#workers = new WorkerRepo(this.#db, this);
    this.#shared = new SharedRepo(this.#db);
    this.#suites = new SuiteRepo(this.#db, (id) => { try { return this.#people.getTeam(id).name; } catch { return null; } });
    this.#plugins = new PluginRepo(this.#db);
    this.#ai = new AiRepo(this.#db);
    this.#areas = new AreaRepo(this.#db);
  }

  /** 확장 플러그인 기록 — run/plugins.ts가 쓴다 */
  get plugins(): PluginRepo { return this.#plugins; }
  /** AI 기록 — run/ai.ts가 쓴다 */
  get ai(): AiRepo { return this.#ai; }

  close(): void {
    this.#db.close();
  }

  // ─── 플로우 · 버전 · 배포 · 시크릿 (flows.ts) ─────────────────────
  listFlows: FlowRepo["listFlows"] = (...a) => this.#flows.listFlows(...a);
  flowNames: FlowRepo["flowNames"] = (...a) => this.#flows.flowNames(...a);
  getFlow: FlowRepo["getFlow"] = (...a) => this.#flows.getFlow(...a);
  createFlow: FlowRepo["createFlow"] = (...a) => this.#flows.createFlow(...a);
  flowUid: FlowRepo["flowUid"] = (...a) => this.#flows.flowUid(...a);
  saveDraft: FlowRepo["saveDraft"] = (...a) => this.#flows.saveDraft(...a);
  deleteFlow: FlowRepo["deleteFlow"] = (...a) => this.#flows.deleteFlow(...a);
  createVersion: FlowRepo["createVersion"] = (...a) => this.#flows.createVersion(...a);
  getVersion: FlowRepo["getVersion"] = (...a) => this.#flows.getVersion(...a);
  getVersionJson: FlowRepo["getVersionJson"] = (...a) => this.#flows.getVersionJson(...a);
  getDraftFlow: FlowRepo["getDraftFlow"] = (...a) => this.#flows.getDraftFlow(...a);
  deploy: FlowRepo["deploy"] = (...a) => this.#flows.deploy(...a);
  activeVersion: FlowRepo["activeVersion"] = (...a) => this.#flows.activeVersion(...a);
  flowPins: FlowRepo["flowPins"] = (...a) => this.#flows.flowPins(...a);
  setPin: FlowRepo["setPin"] = (...a) => this.#flows.setPin(...a);
  published: FlowRepo["published"] = (...a) => this.#flows.published(...a);
  putSealed: FlowRepo["putSealed"] = (...a) => this.#flows.putSealed(...a);
  listSecretNames: FlowRepo["listSecretNames"] = (...a) => this.#flows.listSecretNames(...a);
  sealedSecrets: FlowRepo["sealedSecrets"] = (...a) => this.#flows.sealedSecrets(...a);
  deleteSecret: FlowRepo["deleteSecret"] = (...a) => this.#flows.deleteSecret(...a);
  activeFlows: FlowRepo["activeFlows"] = (...a) => this.#flows.activeFlows(...a);
  flowTeam: FlowRepo["flowTeam"] = (...a) => this.#flows.flowTeam(...a);
  setFlowTeam: FlowRepo["setFlowTeam"] = (...a) => this.#flows.setFlowTeam(...a);
  setFlowGroup: FlowRepo["setFlowGroup"] = (...a) => this.#flows.setFlowGroup(...a);
  flowIdByUid: FlowRepo["flowIdByUid"] = (...a) => this.#flows.flowIdByUid(...a);
  flowRow: FlowRepo["flowRow"] = (...a) => this.#flows.flowRow(...a);

  // ─── 실행 · 점검 · 알림 · 트리거 · 정리 (history.ts) ──────────────
  insertRun: HistoryRepo["insertRun"] = (...a) => this.#history.insertRun(...a);
  finishRun: HistoryRepo["finishRun"] = (...a) => this.#history.finishRun(...a);
  setRanOn: HistoryRepo["setRanOn"] = (...a) => this.#history.setRanOn(...a);
  getRun: HistoryRepo["getRun"] = (...a) => this.#history.getRun(...a);
  runsSince: HistoryRepo["runsSince"] = (...a) => this.#history.runsSince(...a);
  listRuns: HistoryRepo["listRuns"] = (...a) => this.#history.listRuns(...a);
  setWebhook: HistoryRepo["setWebhook"] = (...a) => this.#history.setWebhook(...a);
  getWebhook: HistoryRepo["getWebhook"] = (...a) => this.#history.getWebhook(...a);
  deleteWebhook: HistoryRepo["deleteWebhook"] = (...a) => this.#history.deleteWebhook(...a);
  claimFire: HistoryRepo["claimFire"] = (...a) => this.#history.claimFire(...a);
  putRunShot: HistoryRepo["putRunShot"] = (...a) => this.#history.putRunShot(...a);
  runShot: HistoryRepo["runShot"] = (...a) => this.#history.runShot(...a);
  fileTriggerSignature: HistoryRepo["fileTriggerSignature"] = (...a) => this.#history.fileTriggerSignature(...a);
  resetFileTrigger: HistoryRepo["resetFileTrigger"] = (...a) => this.#history.resetFileTrigger(...a);
  seenFiles: HistoryRepo["seenFiles"] = (...a) => this.#history.seenFiles(...a);
  markFileSeen: HistoryRepo["markFileSeen"] = (...a) => this.#history.markFileSeen(...a);
  insertProbe: HistoryRepo["insertProbe"] = (...a) => this.#history.insertProbe(...a);
  finishProbe: HistoryRepo["finishProbe"] = (...a) => this.#history.finishProbe(...a);
  getProbe: HistoryRepo["getProbe"] = (...a) => this.#history.getProbe(...a);
  latestProbe: HistoryRepo["latestProbe"] = (...a) => this.#history.latestProbe(...a);
  listProbes: HistoryRepo["listProbes"] = (...a) => this.#history.listProbes(...a);
  lastProbeAt: HistoryRepo["lastProbeAt"] = (...a) => this.#history.lastProbeAt(...a);
  previousRunStatus: HistoryRepo["previousRunStatus"] = (...a) => this.#history.previousRunStatus(...a);
  previousProbeStatus: HistoryRepo["previousProbeStatus"] = (...a) => this.#history.previousProbeStatus(...a);
  insertNotice: HistoryRepo["insertNotice"] = (...a) => this.#history.insertNotice(...a);
  listNotices: HistoryRepo["listNotices"] = (...a) => this.#history.listNotices(...a);
  pruneRuns: HistoryRepo["pruneRuns"] = (...a) => this.#history.pruneRuns(...a);
  pruneProbes: HistoryRepo["pruneProbes"] = (...a) => this.#history.pruneProbes(...a);
  pruneNotices: HistoryRepo["pruneNotices"] = (...a) => this.#history.pruneNotices(...a);
  pruneScheduleFires: HistoryRepo["pruneScheduleFires"] = (...a) => this.#history.pruneScheduleFires(...a);
  runFlowId: HistoryRepo["runFlowId"] = (...a) => this.#history.runFlowId(...a);
  probeFlowId: HistoryRepo["probeFlowId"] = (...a) => this.#history.probeFlowId(...a);
  markInterrupted: HistoryRepo["markInterrupted"] = (...a) => this.#history.markInterrupted(...a);

  // ─── 사람 · 로그인 · 팀 (people.ts) ───────────────────────────────
  listTeams: PeopleRepo["listTeams"] = (...a) => this.#people.listTeams(...a);
  getTeam: PeopleRepo["getTeam"] = (...a) => this.#people.getTeam(...a);
  createTeam: PeopleRepo["createTeam"] = (...a) => this.#people.createTeam(...a);
  renameTeam: PeopleRepo["renameTeam"] = (...a) => this.#people.renameTeam(...a);
  deleteTeam: PeopleRepo["deleteTeam"] = (...a) => this.#people.deleteTeam(...a);
  addMember: PeopleRepo["addMember"] = (...a) => this.#people.addMember(...a);
  removeMember: PeopleRepo["removeMember"] = (...a) => this.#people.removeMember(...a);
  teamsOf: PeopleRepo["teamsOf"] = (...a) => this.#people.teamsOf(...a);
  countUsers: PeopleRepo["countUsers"] = (...a) => this.#people.countUsers(...a);
  insertUser: PeopleRepo["insertUser"] = (...a) => this.#people.insertUser(...a);
  getUser: PeopleRepo["getUser"] = (...a) => this.#people.getUser(...a);
  userByEmail: PeopleRepo["userByEmail"] = (...a) => this.#people.userByEmail(...a);
  listUsers: PeopleRepo["listUsers"] = (...a) => this.#people.listUsers(...a);
  updateUser: PeopleRepo["updateUser"] = (...a) => this.#people.updateUser(...a);
  touchLogin: PeopleRepo["touchLogin"] = (...a) => this.#people.touchLogin(...a);
  insertSession: PeopleRepo["insertSession"] = (...a) => this.#people.insertSession(...a);
  sessionUser: PeopleRepo["sessionUser"] = (...a) => this.#people.sessionUser(...a);
  extendSession: PeopleRepo["extendSession"] = (...a) => this.#people.extendSession(...a);
  deleteSession: PeopleRepo["deleteSession"] = (...a) => this.#people.deleteSession(...a);
  deleteSessionsOf: PeopleRepo["deleteSessionsOf"] = (...a) => this.#people.deleteSessionsOf(...a);
  pruneSessions: PeopleRepo["pruneSessions"] = (...a) => this.#people.pruneSessions(...a);
  createApiToken: PeopleRepo["createApiToken"] = (...a) => this.#people.createApiToken(...a);
  listApiTokens: PeopleRepo["listApiTokens"] = (...a) => this.#people.listApiTokens(...a);
  deleteApiToken: PeopleRepo["deleteApiToken"] = (...a) => this.#people.deleteApiToken(...a);
  apiTokenUser: PeopleRepo["apiTokenUser"] = (...a) => this.#people.apiTokenUser(...a);

  // ─── Suite — 웹 e2e 테스트 묶음 (suites.ts) ────────────────────────
  listSuites: SuiteRepo["listSuites"] = (...a) => this.#suites.listSuites(...a);
  getSuite: SuiteRepo["getSuite"] = (...a) => this.#suites.getSuite(...a);
  createSuite: SuiteRepo["createSuite"] = (...a) => this.#suites.createSuite(...a);
  updateSuite: SuiteRepo["updateSuite"] = (...a) => this.#suites.updateSuite(...a);
  deleteSuite: SuiteRepo["deleteSuite"] = (...a) => this.#suites.deleteSuite(...a);
  insertSuiteRun: SuiteRepo["insertSuiteRun"] = (...a) => this.#suites.insertSuiteRun(...a);
  updateSuiteRun: SuiteRepo["updateSuiteRun"] = (...a) => this.#suites.updateSuiteRun(...a);
  getSuiteRun: SuiteRepo["getSuiteRun"] = (...a) => this.#suites.getSuiteRun(...a);
  listSuiteRuns: SuiteRepo["listSuiteRuns"] = (...a) => this.#suites.listSuiteRuns(...a);
  previousSuiteStatus: SuiteRepo["previousSuiteStatus"] = (...a) => this.#suites.previousSuiteStatus(...a);
  abandonSuiteRuns: SuiteRepo["abandonSuiteRuns"] = (...a) => this.#suites.abandonSuiteRuns(...a);
  claimSuiteFire: SuiteRepo["claimSuiteFire"] = (...a) => this.#suites.claimSuiteFire(...a);

  // ─── 팀 공용 값 (shared.ts) ───────────────────────────────────────
  listAreas: AreaRepo["listAreas"] = (...a) => this.#areas.listAreas(...a);
  setAreas: AreaRepo["setAreas"] = (...a) => this.#areas.setAreas(...a);
  listShared: SharedRepo["listShared"] = (...a) => this.#shared.listShared(...a);
  putShared: SharedRepo["putShared"] = (...a) => this.#shared.putShared(...a);
  sealedShared: SharedRepo["sealedShared"] = (...a) => this.#shared.sealedShared(...a);
  sharedVar: SharedRepo["sharedVar"] = (...a) => this.#shared.sharedVar(...a);
  deleteShared: SharedRepo["deleteShared"] = (...a) => this.#shared.deleteShared(...a);
  deleteSharedScope: SharedRepo["deleteSharedScope"] = (...a) => this.#shared.deleteSharedScope(...a);

  // ─── 워커 · 어디서 돌리나 (workers.ts) ────────────────────────────
  listWorkers: WorkerRepo["listWorkers"] = (...a) => this.#workers.listWorkers(...a);
  findWorker: WorkerRepo["findWorker"] = (...a) => this.#workers.findWorker(...a);
  getWorker: WorkerRepo["getWorker"] = (...a) => this.#workers.getWorker(...a);
  createWorker: WorkerRepo["createWorker"] = (...a) => this.#workers.createWorker(...a);
  updateWorker: WorkerRepo["updateWorker"] = (...a) => this.#workers.updateWorker(...a);
  renewWorkerToken: WorkerRepo["renewWorkerToken"] = (...a) => this.#workers.renewWorkerToken(...a);
  deleteWorker: WorkerRepo["deleteWorker"] = (...a) => this.#workers.deleteWorker(...a);
  workerByToken: WorkerRepo["workerByToken"] = (...a) => this.#workers.workerByToken(...a);
  touchWorker: WorkerRepo["touchWorker"] = (...a) => this.#workers.touchWorker(...a);
  flowRunOn: WorkerRepo["flowRunOn"] = (...a) => this.#workers.flowRunOn(...a);
  checkRunOn: WorkerRepo["checkRunOn"] = (...a) => this.#workers.checkRunOn(...a);
  setFlowRunOn: WorkerRepo["setFlowRunOn"] = (...a) => this.#workers.setFlowRunOn(...a);
}
