import { recall, remember } from "./remember.ts";
/**
 * 밝게 · 어둡게 — 고르지 않으면 시스템을 따른다. 고른 것은 이 브라우저에만 기억한다(styles/tokens.css가 html[data-theme]을 본다).
 */
export type Theme = "light" | "dark" | "system";

const KEY = "flowsmith:theme";

export function readTheme(): Theme {
  const v = recall(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function applyTheme(t: Theme): void {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", t);
  remember(KEY, t === "system" ? null : t);
}
