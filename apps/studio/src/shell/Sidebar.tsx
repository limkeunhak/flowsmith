/**
 * 왼쪽 사이드바 — n8n처럼 앱 전체의 길(워크플로우 · 템플릿 · 워커 · 확장 · 사람 · 팀)과 아래에 나(역할 · 비밀번호 · 로그아웃) · 테마 · 접기.
 * 편집 화면에서는 접힌 채로 시작한다.
 * ★색은 짙은 남색(styles/tokens.css의 --side-*) — 파랑을 중심에 둔 Flowsmith의 얼굴.
 */
import { useState } from "react";
import { BrandMark, IconTestTube, IconBook, IconChart, IconCode, IconFolder, IconGear, IconGrid, IconHome, IconKey, IconMonitor, IconMoon, IconPuzzle, IconSidebar, IconSun, IconX } from "../icons.tsx";
import { applyTheme, readTheme, type Theme } from "./theme.ts";
import { ROLE_LABEL, type Me } from "./me.ts";
import { ChangePassword } from "./AuthGate.tsx";
import { recall, remember } from "./remember.ts";

const KEY = "flowsmith:side";
/** 사람이 접기/펼치기를 직접 골랐으면 그것 — 화면마다(편집 · 그 밖) 따로 기억한다 */
const readFolded = (where: string): boolean | null => { const v = recall(`${KEY}:${where}`); return v === null ? null : v === "1"; };

export function Sidebar({ page, editing, me, onLogout }: { page: "home" | "templates" | "users" | "teams" | "workers" | "plugins" | "me" | "dashboard" | "docs" | "api" | "flow" | "tests"; editing: boolean; me: Me; onLogout: () => void }) {
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  // 편집 화면은 캔버스가 넓어야 한다 — 따로 정하지 않았으면 편집 화면에서는 접고, 첫 화면에서는 편다
  const where = editing ? "editor" : "pages";
  const [chosen, setChosen] = useState<Record<string, boolean | null>>(() => ({ editor: readFolded("editor"), pages: readFolded("pages") }));
  const folded = chosen[where] ?? editing;
  const [theme, setTheme] = useState<Theme>(readTheme);
  const fold = (v: boolean) => { setChosen((c) => ({ ...c, [where]: v })); remember(`${KEY}:${where}`, v ? "1" : "0"); };
  const pick = (t: Theme) => { setTheme(t); applyTheme(t); };
  const item = (href: string, on: boolean, Icon: typeof IconHome, label: string) => (
    <a href={href} className={`side-item${on ? " on" : ""}`} title={folded ? label : undefined}><Icon size={18} /><span className="side-label">{label}</span></a>
  );
  const THEMES: { t: Theme; Icon: typeof IconSun; label: string }[] = [
    { t: "light", Icon: IconSun, label: "밝게" }, { t: "system", Icon: IconMonitor, label: "시스템" }, { t: "dark", Icon: IconMoon, label: "어둡게" },
  ];
  return (
    <nav className={`side${folded ? " folded" : ""}`} aria-label="Flowsmith">
      <a href="#/" className="side-brand" title="Flowsmith">
        <span className="side-mark"><BrandMark size={32} /></span>
        <span className="side-label">Flowsmith</span>
      </a>
      <div className="side-nav">
        {item("#/", page === "home" || page === "flow", IconHome, "워크플로우")}
        {item("#/dashboard", page === "dashboard", IconChart, "대시보드")}
        {item("#/tests", page === "tests", IconTestTube, "테스트")}
        {item("#/templates", page === "templates", IconGrid, "템플릿")}
        {item("#/workers", page === "workers", IconMonitor, "워커")}
        {me.can("editor") && item("#/plugins", page === "plugins", IconPuzzle, "확장")}
        {me.can("admin") && me.auth && item("#/users", page === "users", IconKey, "사람")}
        {me.can("admin") && me.auth && item("#/teams", page === "teams", IconFolder, "팀")}
      </div>
      <span className="grow" />
      <div className="side-foot">
        {item("#/api", page === "api", IconCode, "API")}
        {item("#/docs", page === "docs", IconBook, "가이드")}
        {item("#/me", page === "me", IconGear, "내 설정")}
        {me.user && (
          <div className="side-me-anchor">
            <button className="side-item side-me" title={folded ? `${me.user.name} · ${ROLE_LABEL[me.user.role]}` : undefined} onClick={() => setMenu(!menu)}>
              <span className="avatar small">{(me.user.name || me.user.email).slice(0, 1).toUpperCase()}</span>
              <span className="side-label side-me-text"><b>{me.user.name}</b><span>{ROLE_LABEL[me.user.role]}</span></span>
            </button>
            {menu && (
              <div className="menu side-menu">
                <div className="menu-note">{me.user.email}<br />{ROLE_LABEL[me.user.role]}</div>
                <button className="menu-item" onClick={() => { setMenu(false); setPw(true); }}>비밀번호 바꾸기</button>
                <button className="menu-item danger" onClick={() => { setMenu(false); onLogout(); }}>로그아웃</button>
              </div>
            )}
          </div>
        )}
        <div className="side-theme" role="radiogroup" aria-label="화면 색">
          {THEMES.filter((x) => !folded || x.t === theme).map(({ t, Icon, label }) => (
            <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} title={folded ? `화면 색: ${label} — 눌러 바꾸기` : label}
              onClick={() => pick(folded ? THEMES[(THEMES.findIndex((x) => x.t === theme) + 1) % 3]!.t : t)}><Icon size={15} />{!folded && <span>{label}</span>}</button>
          ))}
        </div>
        <button className="side-item side-fold" title={folded ? "펼치기" : "접기"} onClick={() => fold(!folded)}><IconSidebar size={18} /><span className="side-label">접기</span></button>
      </div>
      {pw && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPw(false); }}>
          <div className="modal card">
            <div className="row"><h2 className="grow">비밀번호 바꾸기</h2><button className="icon-btn" onClick={() => setPw(false)}><IconX /></button></div>
            <ChangePassword forced={false} onDone={() => setPw(false)} onCancel={() => setPw(false)} />
          </div>
        </div>
      )}
    </nav>
  );
}
