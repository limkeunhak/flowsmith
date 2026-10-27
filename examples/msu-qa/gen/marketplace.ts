/** 마켓플레이스 — 원본 tests/marketplace/ */
import { MARKET, T, check, click, cookie, custom, fill, flow, goto, item, judge, noLeak, openAt, pause, press, read, waitUrl, web, where, type Service } from "./lib.ts";

const svc: Service = {
  file: "marketplace",
  suite: { name: "MSU QA · 마켓플레이스 (msu-e2e-test)", description: "msu-e2e-test tests/marketplace/의 visitor 시나리오 — 대상 qa.msu.io/marketplace" },
  flows: [],
  items: [],
  notes: [],
};
export default svc;
