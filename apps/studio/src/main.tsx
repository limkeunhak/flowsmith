import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
// 글꼴 — 쓰는 글자의 조각만 받는다(dynamic subset)
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./styles/tokens.css";
// 화면의 모양 — 이 차례가 덮어쓰는 차례다(layout이 editor를 덮는다)
import "./styles/base.css";
import "./styles/editor.css";
import "./styles/layout.css";
import "./styles/pages.css";
import "./styles/dashboard.css";
import "./styles/docs.css";
import "./styles/api.css";
import { applyTheme, readTheme } from "./shell/theme.ts";
import { App } from "./App.tsx";

// 고른 화면 색을 그리기 전에 — 밝게 그렸다가 어둡게 바뀌며 번쩍이지 않게
applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
