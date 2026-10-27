/**
 * 주소(해시)로 화면을 고른다 — #/ 플로우(첫 화면) · #/templates 템플릿 · #/users 사람 · #/teams 팀(관리자) · #/workers 워커 · #/dashboard 대시보드 · #/docs/:문서 가이드 · #/api(/tokens) API · #/run/:id 실행 폼 · #/flows/:id 편집 ·
 * #/flows/:id/runs/:runId 그 실행 기록 · #/flows/:id/monitor 변경 감시(알림의 링크) · #/tests 테스트(Suite) · #/tests/:id(/runs/:runId) Suite 하나 · #/plugins 확장(플러그인) · #/me 내 설정(AI 키).
 * 해시를 쓰는 이유: 서버가 /api 밖의 모든 주소를 index.html로 돌려줄 필요가 없다.
 * 틀은 작업대 — 위 앱 막대 + 본문(shell/AppBar.tsx). 로그인을 켠 서버면 먼저 들어가는 문(shell/AuthGate.tsx).
 */
import { useEffect, useState } from "react";
import { FlowList } from "./FlowList.tsx";
import { FlowEditor } from "./editor/FlowEditor.tsx";
import { AppBar } from "./shell/AppBar.tsx";
import { AuthGate } from "./shell/AuthGate.tsx";
import { Users } from "./shell/Users.tsx";
import { Teams } from "./shell/Teams.tsx";
import { Workers } from "./shell/Workers.tsx";
import { Plugins } from "./shell/Plugins.tsx";
import { MySettings } from "./shell/MySettings.tsx";
import { AiDock } from "./ai/AiDock.tsx";
import { Dashboard } from "./dashboard/Dashboard.tsx";
import { Docs } from "./docs/Docs.tsx";
import { ApiPage } from "./apidocs/ApiPage.tsx";
import { RunForm } from "./run/RunForm.tsx";
import { Suites } from "./tests/Suites.tsx";
import { SuitePage } from "./tests/SuitePage.tsx";

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const m = /^#\/flows\/([^/]+)(?:\/runs\/([^/]+)|\/(monitor))?$/.exec(hash);
  // 가이드 — 없는 문서(한글 · 오타)도 가이드로 연다(첫 문서를 보인다)
  const doc = /^#\/docs(?:\/([^/]*))?$/.exec(hash);
  const apiTab = hash === "#/api" ? "list" : hash === "#/api/tokens" ? "tokens" : null;
  // 실행 폼 — 편집 화면 없이 게시된 버전을 돌린다(실행자에게 주는 주소)
  const runForm = /^#\/run\/([^/]+)$/.exec(hash);
  // 테스트 — Suite 목록 · Suite 하나(실행 하나)
  const suite = /^#\/tests\/([^/]+)(?:\/runs\/([^/]+))?$/.exec(hash);
  const page = m ? "flow" : suite || hash === "#/tests" ? "tests" : doc ? "docs" : apiTab ? "api" : runForm ? "home" : hash === "#/templates" ? "templates" : hash === "#/users" ? "users" : hash === "#/teams" ? "teams" : hash === "#/workers" ? "workers" : hash === "#/plugins" ? "plugins" : hash === "#/me" ? "me" : hash === "#/dashboard" ? "dashboard" : "home";
  return (
    <AuthGate>
      {(me, logout) => (
        <div className="app">
          <AppBar page={page} me={me} onLogout={logout} />
          <div className="app-main">
            {m ? <FlowEditor key={`${m[1]}/${m[2] ?? m[3] ?? ""}`} id={decodeURIComponent(m[1]!)} {...(m[2] ? { runId: decodeURIComponent(m[2]) } : {})} {...(m[3] ? { panel: "monitor" as const } : {})} />
              : page === "users" ? <Users />
              : page === "teams" ? <Teams />
              : page === "workers" ? <Workers />
              : page === "plugins" ? <Plugins />
              : page === "me" ? <MySettings />
              : page === "dashboard" ? <Dashboard />
              : suite ? <SuitePage key={suite[1]} id={decodeURIComponent(suite[1]!)} runId={suite[2] ? decodeURIComponent(suite[2]) : null} />
              : page === "tests" ? <Suites />
              : page === "docs" ? <Docs slug={doc?.[1] ? decodeURIComponent(doc[1]) : null} />
              : apiTab ? <ApiPage tab={apiTab} />
              : runForm ? <RunForm key={runForm[1]} flowId={decodeURIComponent(runForm[1]!)} />
              : <FlowList key={page} only={page === "templates" ? "templates" : null} />}
          </div>
          <AiDock />
        </div>
      )}
    </AuthGate>
  );
}
