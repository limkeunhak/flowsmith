/**
 * 플로우 설정 — **팀 공용 변수** 고르기 · 팀 공용 시크릿 더하기. 값은 팀 화면(관리자)에서 넣는다.
 * 이 플로우가 닿는 범위(제 팀 · 공용)의 값만 보인다 — 같은 이름이면 팀 것이 이긴다.
 */
import { useEffect, useState } from "react";
import type { Flow } from "@flowsmith/core";
import { api, type SharedValue } from "../../api.ts";

type Update = (fn: (f: Flow) => Flow) => void;

/** 이 플로우가 쓸 수 있는 팀 공용 값 — 이름마다 이기는 것(팀 → 공용) */
export function useShared(flowId: string): { vars: SharedValue[]; secrets: SharedValue[]; teamName: (scope: string) => string } | null {
  const [data, setData] = useState<{ teams: { id: string; name: string }[]; values: SharedValue[] } | null>(null);
  useEffect(() => { void api.listShared(flowId).then(setData, () => setData({ teams: [], values: [] })); }, [flowId]);
  if (!data) return null;
  const winner = (kind: SharedValue["kind"]) => {
    const m = new Map<string, SharedValue>();
    for (const v of data.values.filter((x) => x.kind === kind)) {
      const cur = m.get(v.name);
      if (!cur || (cur.scope === "" && v.scope !== "")) m.set(v.name, v);   // 팀 것이 공용을 이긴다
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  return { vars: winner("var"), secrets: winner("secret"), teamName: (s) => (s === "" ? "공용" : data.teams.find((t) => t.id === s)?.name ?? "팀") };
}

export function SharedVarsSection({ flow, update }: { flow: Flow; update: Update }) {
  const shared = useShared(flow.id);
  const chosen = flow.sharedVars ?? [];
  const set = (names: string[]) => update((f) => ({ ...f, sharedVars: names }));
  return (
    <>
      <h3>팀 공용 변수 — 여러 워크플로우가 함께 쓰는 값 ({"{{ $vars.이름 }}"})</h3>
      {!shared ? <span className="small muted">불러오는 중…</span> : shared.vars.length === 0 && chosen.length === 0
        ? <span className="small muted">이 워크플로우가 쓸 수 있는 팀 공용 변수가 없습니다 — 관리자가 «팀» 화면에서 넣습니다</span>
        : (
          <div className="stack" style={{ gap: 4 }}>
            {shared.vars.map((v) => (
              <label key={v.name} className="check">
                <input type="checkbox" checked={chosen.includes(v.name)} disabled={v.name in flow.vars}
                  onChange={(e) => set(e.target.checked ? [...chosen, v.name] : chosen.filter((n) => n !== v.name))} />
                <span className="mono">{v.name}</span>
                <span className="small muted">= {v.value} · {shared.teamName(v.scope)}{v.name in flow.vars ? " · 이 워크플로우의 변수와 이름이 같아 쓸 수 없습니다" : ""}</span>
              </label>
            ))}
            {chosen.filter((n) => !shared.vars.some((v) => v.name === n)).map((n) => (
              <div key={n} className="row small">
                <span className="pill warn">값 없음</span><span className="mono grow">{n}</span>
                <button className="small ghost" onClick={() => set(chosen.filter((x) => x !== n))}>빼기</button>
              </div>
            ))}
          </div>
        )}
    </>
  );
}
