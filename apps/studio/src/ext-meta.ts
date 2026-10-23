/** 워커에 설치된 확장 — packages/engine의 ExtensionMeta와 같은 모양. ☆브라우저 API에 기대지 않는 파일이다(순수 함수 시험이 가져다 쓴다) */
export interface ExtensionMeta {
  id: string;
  title: string;
  description: string;
  options: { name: string; label: string; required: boolean; default?: string; hint?: string }[];
  outputs: string[];
  browser: "none" | "attach";
  risk: "safe" | "unsafe";
  pii?: string[];
  /** 확장 플러그인에서 왔으면 — «확장» 화면에서 올린 것(PLAN §41) */
  plugin?: { id: string; name: string; version: string };
}
