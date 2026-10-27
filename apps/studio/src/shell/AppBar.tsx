/**
 * 위 앱 막대 — 작업대(2026-10-27). 왼쪽 사이드바(n8n의 틀)를 걷어내고 숯빛 한 줄에 앱 전체의 길을 둔다.
 * 왼쪽: 마크 · 길(워크플로우 · 대시보드 · 테스트 · 템플릿 · 워커 · 확장 · 사람 · 팀) — 고른 길은 아래 불씨 밑줄.
 * 오른쪽: API · 가이드 · 화면 색(눌러 바꾸기) · 내 설정 · 나(역할 · 비밀번호 · 로그아웃).
 * ★색은 styles/tokens.css의 --side-*(숯) — 모양은 styles/workbench.css의 .appbar.
 */
import { useState } from "react";
import { BrandMark, IconGear, IconMonitor, IconMoon, IconSun, IconX } from "../icons.tsx";
import { applyTheme, readTheme, type Theme } from "./theme.ts";
import { ROLE_LABEL, type Me } from "./me.ts";
import { ChangePassword } from "./AuthGate.tsx";

export type Page = "home" | "templates" | "users" | "teams" | "workers" | "plugins" | "me" | "dashboard" | "docs" | "api" | "flow" | "tests";

const THEMES: { t: Theme; Icon: typeof IconSun; label: string }[] = [
  { t: "light", Icon: IconSun, label: "밝게" }, { t: "system", Icon: IconMonitor, label: "시스템" }, { t: "dark", Icon: IconMoon, label: "어둡게" },
];

export function AppBar({ page, me, onLogout }: { page: Page; me: Me; onLogout: () => void }) {
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const now = THEMES.find((x) => x.t === theme) ?? THEMES[1]!;
  const cycle = () => { const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]!.t; setTheme(next); applyTheme(next); };
  const link = (href: string, on: boolean, label: string) => (
    <a href={href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>{label}</a>
  );
  return (
    <header className="appbar">
      <a href="#/" className="appbar-brand" title="Flowsmith">
        <span className="brand-tile"><BrandMark size={28} /></span>
        <span>Flowsmith</span>
      </a>
      <nav className="appbar-nav" aria-label="Flowsmith">
        {link("#/", page === "home" || page === "flow", "워크플로우")}
        {link("#/dashboard", page === "dashboard", "대시보드")}
        {link("#/tests", page === "tests", "테스트")}
        {link("#/templates", page === "templates", "템플릿")}
        {link("#/workers", page === "workers", "워커")}
        {me.can("editor") && link("#/plugins", page === "plugins", "확장")}
        {me.can("admin") && me.auth && link("#/users", page === "users", "사람")}
        {me.can("admin") && me.auth && link("#/teams", page === "teams", "팀")}
      </nav>
      <span className="grow" />
      <nav className="appbar-side" aria-label="도움 · 설정">
        {link("#/api", page === "api", "API")}
        {link("#/docs", page === "docs", "가이드")}
        <button type="button" className="appbar-icon" title={`화면 색: ${now.label} — 눌러 바꾸기`} aria-label={`화면 색: ${now.label}`} onClick={cycle}><now.Icon size={16} /></button>
        <a href="#/me" className={`appbar-icon${page === "me" ? " on" : ""}`} title="내 설정" aria-label="내 설정"><IconGear size={16} /></a>
        {me.user && (
          <div className="appbar-me-anchor">
            <button type="button" className="appbar-me" title={`${me.user.name} · ${ROLE_LABEL[me.user.role]}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <span className="avatar small">{(me.user.name || me.user.email).slice(0, 1).toUpperCase()}</span>
              <span className="appbar-me-name">{me.user.name}</span>
            </button>
            {menu && (
              <div className="menu appbar-menu">
                <div className="menu-note">{me.user.email}<br />{ROLE_LABEL[me.user.role]}</div>
                <button className="menu-item" onClick={() => { setMenu(false); setPw(true); }}>비밀번호 바꾸기</button>
                <button className="menu-item danger" onClick={() => { setMenu(false); onLogout(); }}>로그아웃</button>
              </div>
            )}
          </div>
        )}
      </nav>
      {pw && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPw(false); }}>
          <div className="modal card">
            <div className="row"><h2 className="grow">비밀번호 바꾸기</h2><button className="icon-btn" onClick={() => setPw(false)}><IconX /></button></div>
            <ChangePassword forced={false} onDone={() => setPw(false)} onCancel={() => setPw(false)} />
          </div>
        </div>
      )}
    </header>
  );
}
