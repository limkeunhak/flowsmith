/**
 * 노드 종류의 얼굴 — 이름 · 한 줄 설명 · 아이콘 · 찾는 말 · 무리(노드 고르기의 묶음).
 * 캔버스 타일 · 노드 고르기 · 노드 창이 같이 쓴다(한 곳에 두어 서로를 가져가지 않게 — 의존 점검 2026-10-17).
 */
import type { FlowNode, NodeType } from "@flowsmith/core";
import { NodeIconApproval, NodeIconCall, NodeIconCheck, NodeIconCode, NodeIconExt, NodeIconFileIn, NodeIconFileOut, NodeIconHttp, NodeIconHuman, NodeIconIf, NodeIconOpen, NodeIconZip, NodeIconTransform, NodeIconWeb } from "../icons.tsx";
import { webFace } from "../model/split.ts";

export type NodeGroup = "web" | "data" | "flow" | "connect" | "advanced";

export const NODE_GROUPS: { id: NodeGroup; title: string }[] = [
  { id: "web", title: "웹에서" },
  { id: "data", title: "값과 파일" },
  { id: "flow", title: "흐름" },
  { id: "connect", title: "다른 시스템" },
  { id: "advanced", title: "고급" },
];

export const NODE_META: Record<NodeType, { title: string; desc: string; icon: typeof NodeIconWeb; keywords: string; group: NodeGroup }> = {
  web: { title: "웹페이지", desc: "페이지를 열고 누르기 · 넣기 · 읽기를 합니다. 사람이 한 일을 녹화해 만듭니다", icon: NodeIconWeb, group: "web", keywords: "web page 브라우저 클릭 입력 읽기 로그인 녹화" },
  transform: { title: "값 다듬기", desc: "코드 없이 목록을 다듬습니다 — 칸 고르기 · 거르기 · 겹침 빼기 · 값 바꾸기 · 숫자/날짜 형식 · 정렬", icon: NodeIconTransform, group: "data", keywords: "transform filter map dedupe sort format 다듬기 거르기 필터 중복 정렬 변환 칸 열 이름 바꾸기 숫자 날짜" },
  zip: { title: "압축(zip)", desc: "폴더의 파일들(PDF · 캡처 · CSV)을 zip 하나로 묶습니다 — 한 번에 내려받게", icon: NodeIconZip, group: "data", keywords: "zip 압축 묶기 묶음 아카이브 archive 내려받기 다운로드" },
  fileWrite: { title: "파일 쓰기", desc: "앞에서 모은 것을 파일에 씁니다 — CSV · JSON · 텍스트, 이어 붙이기 · 날짜별 파일 · 엑셀로 받기", icon: NodeIconFileOut, group: "data", keywords: "store save file csv json excel 엑셀 저장 파일 쓰기 기록 수집" },
  fileRead: { title: "파일 읽기", desc: "다른 워크플로우가 파일 쓰기로 남긴 파일을 읽습니다 — 오늘 · 어제 · 가장 최근 파일", icon: NodeIconFileIn, group: "data", keywords: "file read csv json load 파일 읽기 불러오기" },
  condition: { title: "조건", desc: "앞에서 받은 값에 따라 갈래를 나누거나 워크플로우를 끝냅니다", icon: NodeIconIf, group: "flow", keywords: "if 분기 갈래 비교 조건" },
  check: { title: "검사", desc: "앞 노드의 값이 기대대로인지 봅니다 — 같다 · 포함 · 숫자 크기 · 행 수 … 틀리면 «불통과»(웹 e2e 테스트)", icon: NodeIconCheck, group: "flow", keywords: "check assert test expect verify 검사 확인 테스트 기대값 판정 통과" },
  approval: { title: "승인 기다리기", desc: "되돌릴 수 없는 일(제출 · 저장 · 발송) 앞에서 사람이 승인해야 이어 갑니다 — 거절하면 멈춥니다", icon: NodeIconApproval, group: "flow", keywords: "approval approve wait 승인 결재 확인 허락 검토" },
  flowCall: { title: "다른 워크플로우 실행", desc: "다른 워크플로우를 돌립니다 — 목록이면 행마다 한 번씩(행마다 실행 기록이 남습니다)", icon: NodeIconCall, group: "flow", keywords: "flow call sub workflow 반복 행마다 하위 워크플로우 실행" },
  http: { title: "HTTP 요청", desc: "다른 시스템의 API를 부릅니다 — 모은 것을 보내거나 받은 값을 다음 노드로(Slack · 사내 API)", icon: NodeIconHttp, group: "connect", keywords: "http api rest request fetch post get webhook 요청 호출 보내기 연동 슬랙" },
  custom: { title: "커스텀(코드)", desc: "개발자용 — 코드로 직접 정합니다. 값을 다듬을 때는 «값 다듬기»를 쓰세요(페이지를 직접 다루면 안전장치 밖)", icon: NodeIconCode, group: "advanced", keywords: "code 코드 스크립트 javascript 변환" },
  extension: { title: "확장", desc: "워커에 설치된 코드 모듈을 부릅니다", icon: NodeIconExt, group: "connect", keywords: "extension 확장 모듈" },
};

/** 웹페이지 노드의 다른 얼굴(속은 웹페이지 노드) — 사람 기다리기뿐 · 페이지 접속만(사용자 요청 2026-10-22 · 노드 나누기) */
export const HUMAN_META = { title: "사람 기다리기", desc: "로그인 · 본인 인증처럼 사람이 직접 할 일을 기다렸다가 같은 페이지에서 이어 갑니다 — 일정 · 웹훅 실행이면 알림으로 사람을 부릅니다", icon: NodeIconHuman, group: "web" as NodeGroup, keywords: "human wait login 사람 기다리기 로그인 인증 대기 본인 확인 캡차" };
export const OPEN_META = { title: "페이지 접속", desc: "주소를 열기만 합니다 — 뒤 노드가 이 페이지에서 이어서 합니다", icon: NodeIconOpen, group: "web" as NodeGroup, keywords: "" };

/** 캔버스 · 노드 창이 쓸 얼굴 — 노드 종류의 것, 웹페이지면 사람 기다리기 · 페이지 접속 */
export function metaOf(n: FlowNode): { title: string; icon: typeof NodeIconWeb; cls: string } {
  const face = webFace(n);
  if (face === "human") return { title: HUMAN_META.title, icon: HUMAN_META.icon, cls: "t-human" };
  if (face === "open") return { title: OPEN_META.title, icon: OPEN_META.icon, cls: "t-web t-open" };
  return { title: NODE_META[n.type].title, icon: NODE_META[n.type].icon, cls: `t-${n.type}` };
}
