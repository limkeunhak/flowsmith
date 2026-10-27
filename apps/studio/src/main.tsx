import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
// 글꼴 — IBM Plex Sans KR(글) · IBM Plex Mono(단계 번호 · 시간 · 값). 앱에 함께 묶는다(사내망에서도) · 쓰는 글자 조각(unicode-range)만 받는다
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-sans-kr/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles/tokens.css";
// 화면의 모양 — 이 차례가 덮어쓰는 차례다(layout이 editor를 덮는다)
import "./styles/base.css";
import "./styles/editor.css";
import "./styles/layout.css";
import "./styles/pages.css";
import "./styles/dashboard.css";
import "./styles/docs.css";
import "./styles/api.css";
// 작업대 — n8n의 틀을 걷어낸 Flowsmith 모양. 맨 끝에서 앞의 것을 덮는다
import "./styles/workbench.css";
import { applyTheme, readTheme } from "./shell/theme.ts";
import { App } from "./App.tsx";

// 고른 화면 색을 그리기 전에 — 밝게 그렸다가 어둡게 바뀌며 번쩍이지 않게
applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
