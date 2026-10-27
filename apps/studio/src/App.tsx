/**
 * 주소(해시)로 화면을 고른다 — #/ 플로우(첫 화면) · #/templates 템플릿 · #/users 사람 · #/teams 팀(관리자) · #/workers 워커 · #/dashboard 대시보드 · #/docs/:문서 가이드 · #/api(/tokens) API · #/run/:id 실행 폼 · #/flows/:id 편집 ·
 * #/flows/:id/nodes/:nodeId 그 단계의 작업 시트 · #/flows/:id/runs(/:runId) 실행 기록(그 실행) · #/flows/:id/monitor 변경 감시(알림의 링크) · #/tests 테스트(Suite) · #/tests/:id(/runs/:runId) Suite 하나 · #/plugins 확장(플러그인) · #/me 내 설정(AI 키).
 * 해시를 쓰는 이유: 서버가 /api 밖의 모든 주소를 index.html로 돌려줄 필요가 없다. 이동 · 떠나기 전 확인은 shell/nav.ts.
 * ★편집 화면 안의 상태(시트 · 실행 기록)도 주소에 둔다 — 뒤로 가기가 시트를 닫고 탭을 돌린다 · 링크로 건넬 수 있다.
 * 틀은 작업대 — 위 앱 막대 + 본문(shell/AppBar.tsx). 로그인을 켠 서버면 먼저 들어가는 문(shell/AuthGate.tsx).
 */
import { useHash } from "./shell/nav.ts";
import { useTitle } from "./shell/title.ts";
import { EmptyState } from "./EmptyState.tsx";
import { IconSearch } from "./icons.tsx";
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

export function App() {
  const hash = useHash();
  // 편집 — #/flows/:id · /nodes/:nodeId(시트) · /runs(/:runId)(실행 기록) · /monitor
  const m = /^#\/flows\/([^/]+)(?:\/nodes\/([^/]+)|\/(runs)(?:\/([^/]+))?|\/(monitor))?$/.exec(hash);
  // 가이드 — 없는 문서(한글 · 오타)도 가이드로 연다(첫 문서를 보인다)
  const doc = /^#\/docs(?:\/([^/]*))?$/.exec(hash);
  const apiTab = hash === "#/api" ? "list" : hash === "#/api/tokens" ? "tokens" : null;
  // 실행 폼 — 편집 화면 없이 게시된 버전을 돌린다(실행자에게 주는 주소)
  const runForm = /^#\/run\/([^/]+)$/.exec(hash);
  // 테스트 — Suite 목록 · Suite 하나(실행 하나)
  const suite = /^#\/tests\/([^/]+)(?:\/runs\/([^/]+))?$/.exec(hash);
  // 아는 주소인가 — 모르면(오타 · 옛 링크) 첫 화면인 척하지 않고 «없는 화면»을 보인다
  const known = !!(m || suite || doc || apiTab || runForm) || ["", "#", "#/", "#/tests", "#/templates", "#/users", "#/teams", "#/workers", "#/plugins", "#/me", "#/dashboard"].includes(hash);
  const page = m ? "flow" : suite || hash === "#/tests" ? "tests" : doc ? "docs" : apiTab ? "api" : runForm ? "home" : hash === "#/templates" ? "templates" : hash === "#/users" ? "users" : hash === "#/teams" ? "teams" : hash === "#/workers" ? "workers" : hash === "#/plugins" ? "plugins" : hash === "#/me" ? "me" : hash === "#/dashboard" ? "dashboard" : "home";
  // 탭 제목 — 이름을 아는 화면(편집 · Suite · 가이드 · 실행 폼)은 제 것을 정한다
  const TITLE: Record<string, string> = { home: "워크플로우", templates: "템플릿", users: "사람", teams: "팀", workers: "워커", plugins: "확장", me: "내 설정", dashboard: "대시보드", tests: "테스트", api: "API" };
  useTitle(m || suite || doc || runForm ? null : known ? TITLE[page] ?? "" : "없는 화면");
  return (
    <AuthGate>
      {(me, logout) => (
        <div className="app">
          <AppBar page={known ? page : "none"} me={me} onLogout={logout} />
          <div className="app-main">
            {/* key는 워크플로우만 — 시트 · 탭 · 실행을 바꿔도 편집 화면(초안)은 그대로 */}
            {m ? <FlowEditor key={m[1]} id={decodeURIComponent(m[1]!)} tab={m[3] ? "runs" : "editor"}
                {...(m[2] ? { nodeId: decodeURIComponent(m[2]) } : {})} {...(m[4] ? { runId: decodeURIComponent(m[4]) } : {})} {...(m[5] ? { panel: "monitor" as const } : {})} />
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
              : !known ? <NotFound />
              : <FlowList key={page} only={page === "templates" ? "templates" : null} />}
          </div>
          <AiDock />
        </div>
      )}
    </AuthGate>
  );
}

function NotFound() {
  return (
    <div className="page">
      <EmptyState icon={<IconSearch size={22} />} title="없는 화면입니다" action={<a className="button" href="#/">워크플로우로 가기</a>}>
        주소가 바뀌었거나 잘못 적혔습니다 — 위 메뉴에서 찾아가세요.
      </EmptyState>
    </div>
  );
}
