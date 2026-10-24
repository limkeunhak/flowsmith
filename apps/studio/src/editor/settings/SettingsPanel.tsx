/**
 * 플로우 설정 — 이름 · 실행 입력 · 변수(팀 공용 변수) · 시크릿(정의와 값 · 팀 공용 값) · 금지 버튼 · 시간.
 *
 * ★시크릿 **값**은 초안에 들어가지 않는다. 정의(이름 · 종류)만 초안에 있고, 값은 서버의 잠긴 저장소로
 *  바로 간다. 한 번 넣은 값은 다시 보이지 않는다 — 보이는 건 «저장됨»과 시각뿐이다.
 */
import { desktop } from "../../live/desktop.ts";
import { useEffect, useState } from "react";
import { NAME_RE, PARAM_TYPES, type Flow, type ParamDef, type ParamType, type SecretKind } from "@flowsmith/core";
import { newParam } from "../../model/index.ts";
import { api, ApiError, type SecretStatus } from "../../api.ts";
import { Field, ListInput } from "../widgets.tsx";
import { useMe } from "../../shell/me.ts";
import { placeLabel, useWorkers } from "../../shell/workers.ts";
import { SharedVarsSection, useShared } from "./SharedVarsSection.tsx";
import { newMetaMaskWallet, WalletSection } from "./WalletSection.tsx";

/** team · onMoveTeam — 사내 서버형: 이 플로우의 팀과 옮기기(null이면 공용) · runOn · onRunOn — 어디서 돌리나(워커) */
export function SettingsPanel({ flow, update, dirty, onToast, team, onMoveTeam, runOn = null, onRunOn }: {
  flow: Flow; update: (fn: (f: Flow) => Flow) => void; dirty: boolean; onToast: (t: string) => void;
  team?: { id: string; name: string } | null; onMoveTeam?: (team: string | null) => void;
  runOn?: string | null; onRunOn?: (on: string | null) => void;
}) {
  const me = useMe();
  const s = flow.settings;
  const setSettings = (patch: Partial<Flow["settings"]>) => update((f) => ({ ...f, settings: { ...f.settings, ...patch } }));
  const varEntries = Object.entries(flow.vars);

  return (
    <div className="stack">
      {me.auth && onMoveTeam && (
        <Field label="팀 — 이 팀 사람과 관리자만 봅니다(공용은 모두)">
          <select value={team?.id ?? ""} disabled={!me.can("editor")} onChange={(e) => onMoveTeam(e.target.value || null)}>
            {team && !me.teams.some((t) => t.id === team.id) && <option value={team.id}>{team.name}</option>}
            {me.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="">공용(모두가 봄)</option>
          </select>
        </Field>
      )}
      <Field label="이름"><input value={flow.name} onChange={(e) => update((f) => ({ ...f, name: e.target.value }))} /></Field>
      <Field label="설명"><textarea rows={2} value={flow.description} onChange={(e) => update((f) => ({ ...f, description: e.target.value }))} /></Field>

      <h3>브라우저</h3>
      <div className="stack" style={{ gap: 6 }}>
        {/* ★MetaMask 지갑은 지갑 브라우저에만 실린다 — 브라우저를 바꾸면 지갑 설정도 함께 맞춘다(검문소 graph.ts와 같은 규칙) */}
        <label className="check"><input type="radio" checked={s.browser === "launch"} onChange={() => setSettings({ browser: "launch", ...(s.wallet?.mode === "metamask" ? { wallet: null } : {}) })} />Flowsmith가 브라우저를 띄웁니다(기본) — 로그인은 시크릿으로</label>
        <label className="check"><input type="radio" checked={s.browser === "attach"} onChange={() => setSettings({ browser: "attach", ...(s.wallet ? { wallet: null } : {}) })} />사람이 로그인한 크롬에 붙습니다 — 보안 프로그램 · OTP 사이트</label>
        <label className="check"><input type="radio" checked={s.browser === "app"} onChange={() => setSettings({ browser: "app", ...(s.wallet ? { wallet: null } : {}) })} />앱 안 브라우저 — 데스크톱 앱 창 안에서 녹화 · 실행(사람이 바로 만집니다)</label>
        <label className="check"><input type="radio" checked={s.browser === "wallet"} onChange={() => setSettings({ browser: "wallet", wallet: s.wallet?.mode === "metamask" ? s.wallet : newMetaMaskWallet(flow) })} />지갑 브라우저(MetaMask) — MetaMask 확장으로 로그인하는 블록체인 사이트</label>
        {s.browser === "app" && (
          <div className="banner info small">
            데스크톱 앱 안에 브라우저를 엽니다 — 녹화는 이 화면의 라이브 패널 자리에, 실행은 따로 창에 뜹니다. 실행마다 새 세션(쿠키가 이어지지 않습니다)이라 로그인은 시크릿이나 «사람 기다리기»로 합니다.
            <b> 데스크톱 앱에서만 돕니다</b> — 서버 · 다른 워커에서 돌리려면 «띄우기»로 바꾸세요(워크플로우는 그대로 됩니다).
            {!desktop() && " 지금은 웹에서 열었습니다 — 데스크톱 앱을 켠 사람이 «내 PC에서 실행하기»로 돌릴 때만 돕니다."}
          </div>
        )}
        {s.browser === "wallet" && (
          <div className="banner info small">
            진짜 MetaMask를 실은 크롬을 <b>창을 띄워</b> 엽니다 — 화면이 있는 PC의 워커(데스크톱 앱 · <code>--headed</code>)에서만 돕니다.
            지갑마다 프로필을 하나 두고 계속 씁니다(처음 한 번 지갑을 준비 · 다음부터 잠금만 풉니다). 승인은 웹페이지 노드의 «MetaMask 승인» 동작이 합니다.
          </div>
        )}
        {s.browser === "attach" && (
          <div className="banner info small">
            크롬을 <code>--remote-debugging-port=9222</code>로 띄우고 사이트에 로그인해 두세요. 서버는 <code>FLOWSMITH_CDP_URL</code>(기본 http://127.0.0.1:9222)로 붙습니다.
            웹페이지 노드는 «사람이 연 탭에서» 시작할 수 있고, 사람의 탭 · 브라우저는 닫지 않습니다.
            {" 사내 서버에서 쓴다면 그 PC에 워커를 연결하고, 실행 위치와 녹화할 PC로 고르세요."}
          </div>
        )}
      </div>

      {onRunOn && <RunOnField runOn={runOn} onRunOn={onRunOn} disabled={!me.can("editor")} />}

      <Field label="자원 잠금 — 같은 이름을 쓰는 실행은 한 번에 하나만" hint="예: 쇼핑몰 관리자 계정A ·같은 계정으로 두 실행이 동시에 로그인하면 서로 세션을 끊습니다. 워크플로우가 달라도 이름이 같으면 차례를 기다립니다(쉼표로 여럿, 5개까지)">
        <ListInput placeholder="비우면 잠그지 않음" value={flow.settings.locks} onChange={(locks) => update((f) => ({ ...f, settings: { ...f.settings, locks } }))} />
      </Field>

      <h3>실행 입력 — 돌릴 때마다 받는 값 ({"{{ $params.이름 }}"})</h3>
      {flow.params.map((p, i) => {
        const set = (patch: Partial<ParamDef>) => update((f) => ({ ...f, params: f.params.map((x, j) => j === i ? { ...x, ...patch } : x) }));
        return (
          <div key={i} className="param-def stack">
            <div className="row">
              <input className="mono" placeholder="orderNo" value={p.name} onChange={(e) => set({ name: e.target.value })} />
              <input placeholder="주문번호" value={p.label} onChange={(e) => set({ label: e.target.value })} />
              <select value={p.type} title="종류 — 돌리기 전에 맞는지 봅니다" style={{ width: 96 }} onChange={(e) => set({ type: e.target.value as ParamType })}>
                {PARAM_TYPES.map((t) => <option key={t} value={t}>{PARAM_TYPE_LABEL[t]}</option>)}
              </select>
              <label className="check" title="꼭 받아야 하나"><input type="checkbox" checked={p.required} onChange={(e) => set({ required: e.target.checked })} />필수</label>
              <button className="small ghost" onClick={() => update((f) => ({ ...f, params: f.params.filter((_, j) => j !== i) }))}>✕</button>
            </div>
            <div className="row">
              {p.type === "select" && (
                <ListInput className="grow" placeholder="보기 — 쉼표로(연필, 공책, 지우개)" value={p.options} onChange={(options) => set({ options })} />
              )}
              <input placeholder={p.type === "date" ? "기본값 2026-10-18" : "기본값(비우면 없음)"} value={p.default} style={{ width: 150 }} onChange={(e) => set({ default: e.target.value })} />
              <input className="grow" placeholder="설명 — 실행할 때 보입니다" value={p.help} onChange={(e) => set({ help: e.target.value })} />
            </div>
          </div>
        );
      })}
      <button className="small" onClick={() => update((f) => ({ ...f, params: [...f.params, newParam()] }))}>＋ 실행 입력</button>

      <h3>변수 — 이 워크플로우에서만 쓰는 값, 화면에 보입니다 ({"{{ $vars.이름 }}"})</h3>
      {varEntries.map(([k, v], i) => (
        <div key={i} className="row">
          <input className="mono" value={k} onChange={(e) => update((f) => ({ ...f, vars: Object.fromEntries(Object.entries(f.vars).map(([kk, vv], j) => (j === i ? [e.target.value, vv] : [kk, vv]))) }))} />
          <input className="mono grow" value={v} onChange={(e) => update((f) => ({ ...f, vars: { ...f.vars, [k]: e.target.value } }))} />
          <button className="small ghost" onClick={() => update((f) => ({ ...f, vars: Object.fromEntries(Object.entries(f.vars).filter(([kk]) => kk !== k)) }))}>✕</button>
        </div>
      ))}
      <button className="small" onClick={() => update((f) => {
        let n = 1;
        while (`var${n}` in f.vars) n++;
        return { ...f, vars: { ...f.vars, [`var${n}`]: "" } };
      })}>＋ 변수</button>

      <SharedVarsSection flow={flow} update={update} />

      <SecretsSection flow={flow} update={update} dirty={dirty} onToast={onToast} />

      <WalletSection flow={flow} update={update} />

      <h3>금지 버튼 — 글자가 이 정규식에 걸리면 누르지 않습니다(웹페이지 노드)</h3>
      <textarea rows={3} className="mono" value={s.forbiddenLabels.join("\n")} placeholder={"삭제\n결제\n주문\\s*취소"}
        onChange={(e) => setSettings({ forbiddenLabels: e.target.value.split("\n").filter((x) => x.trim() !== "") })} />
      <span className="small muted">한 줄에 하나. 커스텀 노드는 이 검사 밖입니다.</span>

      <div className="row">
        <Field label="동작 기본 시간 제한(ms)"><input type="number" value={s.defaultTimeoutMs} onChange={(e) => setSettings({ defaultTimeoutMs: Math.max(100, Number(e.target.value)) })} /></Field>
        <Field label="변경 감시 주기(분) — 5 이상, 비우면 끔"><input type="number" min={5} value={s.monitorIntervalMin ?? ""} placeholder="끔" onChange={(e) => setSettings({ monitorIntervalMin: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      </div>

      <h3>실패하면 · 오래 걸리면</h3>
      <div className="row wrap">
        <Field label="다시 해 보기(번, 0~5)">
          <input type="number" min={0} max={5} style={{ width: 90 }} value={s.retries} onChange={(e) => setSettings({ retries: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} />
        </Field>
        <Field label="다시 하기 전 쉬기(초)">
          <input type="number" min={0} style={{ width: 90 }} value={s.retryDelayMs / 1000} onChange={(e) => setSettings({ retryDelayMs: Math.max(0, Math.round((Number(e.target.value) || 0) * 1000)) })} />
        </Field>
        <Field label="실행 전체 시간 제한(분) — 비우면 없음">
          <input type="number" min={1} max={1440} style={{ width: 110 }} value={s.runTimeoutMin ?? ""} placeholder="없음" onChange={(e) => setSettings({ runTimeoutMin: e.target.value === "" ? null : Math.max(1, Math.min(1440, Number(e.target.value) || 1)) })} />
        </Field>
      </div>
      <span className="small muted">
        다시 해 보기는 웹페이지 동작이 시간 초과 · 못 찾음 같은 실패로 멈출 때만 하고, «되돌릴 수 없는 동작»(제출 · 저장)은 다시 하지 않습니다.
        금지 버튼 · 고르면 안 되는 행 · 기대한 건이 아님은 다시 해도 같아서 바로 멈춥니다. 전체 시간 제한을 넘으면 실행을 멈추고 실패로 남깁니다.
      </span>
      {flow.params.length > 0 && (
        <>
          <h3>점검용 입력값 — 변경 감시가 페이지를 따라갈 때 쓰는 값</h3>
          {flow.params.map((p) => (
            <Field key={p.name} label={p.label || p.name}>
              <input value={s.probeParams[p.name] ?? ""} onChange={(e) => setSettings({ probeParams: { ...s.probeParams, [p.name]: e.target.value } })} />
            </Field>
          ))}
          <span className="small muted">점검은 이 값으로 페이지를 따라가며 요소가 녹화 때와 같은지 봅니다. 되돌릴 수 없는 동작은 누르지 않습니다.</span>
        </>
      )}
    </div>
  );
}

function SecretsSection({ flow, update, dirty, onToast }: { flow: Flow; update: (fn: (f: Flow) => Flow) => void; dirty: boolean; onToast: (t: string) => void }) {
  const [status, setStatus] = useState<SecretStatus[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const reload = () => api.listSecrets(flow.id).then(setStatus, () => undefined);
  useEffect(() => { void reload(); }, [flow.id, dirty]);

  const save = async (name: string, kind: SecretKind) => {
    const value = kind === "text" ? vals["text"] ?? "" : { username: vals["username"] ?? "", password: vals["password"] ?? "", ...(vals["extra"] ? { extra: vals["extra"] } : {}) };
    try {
      await api.putSecret(flow.id, name, value);
      onToast(`시크릿 '${name}'을(를) 잠가 저장했습니다`);
      setEditing(null);
      setVals({});
      void reload();
    } catch (e) {
      onToast(e instanceof ApiError ? e.message : String(e));
    }
  };

  const stored = new Map(status.map((x) => [x.name, x]));
  const shared = useShared(flow.id);
  const setShared = (i: number, on: boolean) => update((f) => ({ ...f, secrets: f.secrets.map((x, j) => (j === i ? { ...x, shared: on } : x)) }));
  // 팀 공용 시크릿 중 아직 이 플로우에 없는 것 — 골라 더한다
  const addable = (shared?.secrets ?? []).filter((v) => !flow.secrets.some((s) => s.name === v.name));
  return (
    <>
      <h3>시크릿 — 로그인 정보 등. 값은 잠겨 저장되고 다시 보이지 않습니다</h3>
      {flow.secrets.map((sec, i) => {
        const st = stored.get(sec.name);
        return (
          <div key={i} className="subcard">
            <div className="row">
              <input className="mono" style={{ width: 120 }} value={sec.name} onChange={(e) => update((f) => ({ ...f, secrets: f.secrets.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} />
              <select style={{ width: 110 }} value={sec.kind} onChange={(e) => update((f) => ({ ...f, secrets: f.secrets.map((x, j) => j === i ? { ...x, kind: e.target.value as SecretKind } : x) }))}>
                <option value="login">로그인</option>
                <option value="text">글자 하나</option>
              </select>
              <input className="grow" placeholder="설명" value={sec.description} onChange={(e) => update((f) => ({ ...f, secrets: f.secrets.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
              <button className="small ghost" onClick={() => update((f) => ({ ...f, secrets: f.secrets.filter((_, j) => j !== i) }))}>✕</button>
            </div>
            <label className="check small" title="팀 화면(관리자)에서 넣은 같은 이름의 값을 씁니다 — 계정이 바뀌면 한 곳만 고칩니다">
              <input type="checkbox" checked={sec.shared === true} onChange={(e) => setShared(i, e.target.checked)} />팀 공용 값 쓰기
            </label>
            {sec.shared ? (
              <div className="row">
                {st?.stored
                  ? <span className="pill ok">팀 공용 값 · {shared?.teamName(st.sharedScope ?? "") ?? "공용"}</span>
                  : <div className="banner warn small">팀 공용 값이 없습니다{dirty ? "(저장하면 다시 봅니다)" : ""} — 관리자가 «팀» 화면에서 같은 이름 · 종류로 넣습니다</div>}
              </div>
            ) : <div className="row">
              {st?.stored ? <span className="pill ok">저장됨 · {new Date(st.updatedAt!).toLocaleString("ko-KR")}</span> : <span className="pill warn">값 없음</span>}
              <span className="grow" />
              {editing !== sec.name && (
                <button className="small" disabled={dirty || !NAME_RE.test(sec.name)} title={dirty ? "먼저 초안을 저장하세요" : ""}
                  onClick={() => { setEditing(sec.name); setVals({}); }}>{st?.stored ? "값 바꾸기" : "값 넣기"}</button>
              )}
              {st?.stored && <button className="small ghost danger" onClick={() => api.deleteSecret(flow.id, sec.name).then(reload, () => undefined)}>값 지우기</button>}
            </div>}
            {!sec.shared && dirty && editing === null && <span className="small muted">값을 넣으려면 먼저 초안을 저장하세요 — 서버가 저장된 정의를 보고 확인합니다</span>}
            {editing === sec.name && (
              <div className="stack" style={{ gap: 6 }}>
                {sec.kind === "text"
                  ? <input type="password" autoComplete="new-password" placeholder="값" onChange={(e) => setVals({ text: e.target.value })} />
                  : (
                    <>
                      <input autoComplete="off" placeholder="아이디" onChange={(e) => setVals((v) => ({ ...v, username: e.target.value }))} />
                      <input type="password" autoComplete="new-password" placeholder="비밀번호" onChange={(e) => setVals((v) => ({ ...v, password: e.target.value }))} />
                      <input autoComplete="off" placeholder="추가 칸(있으면)" onChange={(e) => setVals((v) => ({ ...v, extra: e.target.value }))} />
                    </>
                  )}
                <div className="row"><span className="grow" />
                  <button className="small" onClick={() => { setEditing(null); setVals({}); }}>그만두기</button>
                  <button className="small primary" onClick={() => save(sec.name, sec.kind)}>잠가 저장</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {status.filter((x) => x.orphan).map((x) => (
        <div key={x.name} className="row small">
          <span className="pill">정의 없음</span><span className="mono grow">{x.name}</span>
          <button className="small ghost danger" onClick={() => api.deleteSecret(flow.id, x.name).then(reload, () => undefined)}>저장된 값 지우기</button>
        </div>
      ))}
      <div className="row wrap">
        <button className="small" onClick={() => update((f) => {
          let n = 1;
          while (f.secrets.some((x) => x.name === `secret${n}`)) n++;
          return { ...f, secrets: [...f.secrets, { name: `secret${n}`, kind: "login", description: "", shared: false }] };
        })}>＋ 시크릿</button>
        {addable.length > 0 && (
          <select className="small" value="" aria-label="팀 공용 시크릿 쓰기" onChange={(e) => {
            const v = addable.find((x) => x.name === e.target.value);
            if (v) update((f) => ({ ...f, secrets: [...f.secrets, { name: v.name, kind: v.secretKind ?? "login", description: v.description, shared: true }] }));
          }}>
            <option value="">＋ 팀 공용 시크릿 쓰기</option>
            {addable.map((v) => <option key={v.name} value={v.name}>{v.name} · {v.secretKind === "text" ? "글자" : "로그인"} · {shared?.teamName(v.scope)}</option>)}
          </select>
        )}
      </div>
    </>
  );
}

/** 어디서 돌리나 — 서버 · 워커 하나 · 라벨(그 라벨의 비어 있는 워커). 일정 · 웹훅 · 점검도 그곳에서 돈다 */
function RunOnField({ runOn, onRunOn, disabled }: { runOn: string | null; onRunOn: (on: string | null) => void; disabled: boolean }) {
  const all = useWorkers();
  if (!all) return null;
  // ★개인 워커(내 PC)에는 워크플로우를 맡기지 않는다 — 실행할 때 «내 PC에서 실행하기»로만
  const v = { ...all, workers: all.workers.filter((w) => w.kind !== "personal") };
  const chosen = runOn?.startsWith("worker:") ? v.workers.find((w) => `worker:${w.id}` === runOn) : undefined;
  return (
    <>
      <h3>실행 위치</h3>
      {v.workers.length === 0 && !runOn ? (
        <div className="small muted">서버에서 실행합니다. 사람 PC에서 실행하려면 워커를 연결하세요.</div>
      ) : (
        <Field label="일정 · 웹훅 · 점검도 여기서 실행합니다">
          <select value={runOn ?? ""} disabled={disabled} onChange={(e) => onRunOn(e.target.value || null)}>
            <option value="">서버</option>
            {runOn && !v.workers.some((w) => `worker:${w.id}` === runOn) && !runOn.startsWith("label:") && <option value={runOn}>{placeLabel(runOn, v)}</option>}
            <optgroup label="워커">
              {v.workers.map((w) => <option key={w.id} value={`worker:${w.id}`}>{w.name} — {!w.enabled ? "잠시 끔" : w.online ? "연결됨" : "꺼짐"}{w.labels.length ? ` · ${w.labels.join(", ")}` : ""}</option>)}
            </optgroup>
            {v.labels.length > 0 && <optgroup label="라벨 (비어 있는 워커)">
              {v.labels.map((l) => <option key={l} value={`label:${l}`}>라벨 {l}</option>)}
            </optgroup>}
          </select>
        </Field>
      )}
      {chosen && !chosen.online && <div className="banner warn small">«{chosen.name}»가 연결돼 있지 않아 지금 실행하면 실패합니다.</div>}
    </>
  );
}

const PARAM_TYPE_LABEL: Record<ParamType, string> = { text: "글자", number: "숫자", date: "날짜", select: "고르기" };
