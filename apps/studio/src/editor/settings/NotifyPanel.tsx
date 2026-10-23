/**
 * **알림** — 언제(실패 · 회복 · 성공 · 멈춤 · 사이트가 바뀜) · 어디로(메일 · Slack · Teams · 웹훅) (PLAN §15 · §17).
 *
 * 규칙은 플로우 설정(매니페스트)에 들어간다 — 버전과 함께 간다. ★게시된 버전의 실행 · 점검만 알린다.
 * 주소는 시크릿에 넣고 `{{ $secrets.이름 }}`으로 쓰기를 권한다 — Slack 웹훅 주소는 그 자체가 열쇠다.
 */
import { useEffect, useState } from "react";
import { NOTIFY_EVENT_LABEL, NOTIFY_EVENTS, type Flow, type NotifyChannel, type NotifyRule } from "@flowsmith/core";
import { api, ApiError, type NoticeRow } from "../../api.ts";
import { nextId } from "../../model/index.ts";
import { IconBell, IconX } from "../../icons.tsx";
import { Field } from "../widgets.tsx";
import { dateTime } from "../../format.ts";

const CHANNEL: Record<NotifyChannel, { label: string; hint: string; placeholder: string }> = {
  email: { label: "메일", hint: "받는 사람 — 여럿이면 쉼표로", placeholder: "kim@example.com, lee@example.com" },
  slack: { label: "Slack", hint: "Slack 앱의 Incoming Webhook 주소", placeholder: "https://hooks.slack.com/services/…" },
  teams: { label: "Teams", hint: "Teams 채널의 «웹훅 요청을 받으면 채널에 게시»(Workflows) 주소", placeholder: "https://….logic.azure.com/workflows/…" },
  webhook: { label: "웹훅(JSON)", hint: "아무 주소 — 무엇이 일어났는지 JSON으로 POST합니다(메일 · 문자 서비스에 잇기)", placeholder: "https://example.com/hooks/flowsmith" },
};
const EVENT_LABEL: Record<string, string> = { ...NOTIFY_EVENT_LABEL, test: "시험" };

export function NotifyPanel({ flow, activeVersion, dirty, update, onClose, onToast }: {
  flow: Flow; activeVersion: number | null; dirty: boolean; update: (fn: (f: Flow) => Flow) => void; onClose: () => void; onToast: (t: string) => void;
}) {
  const rules = flow.settings.notify;
  const setRules = (fn: (r: NotifyRule[]) => NotifyRule[]) => update((f) => ({ ...f, settings: { ...f.settings, notify: fn(f.settings.notify) } }));
  const setOne = (id: string, patch: Partial<NotifyRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const reload = () => api.listNotices(flow.id).then(setNotices, () => undefined);
  useEffect(() => { void reload(); }, [flow.id]);
  const textSecrets = flow.secrets.filter((s) => s.kind === "text");
  const [mail, setMail] = useState<{ email: boolean; from: string | null } | null>(null);
  useEffect(() => { void api.notifyConfig().then(setMail, () => undefined); }, []);

  const test = async (r: NotifyRule) => {
    setTesting(r.id);
    try {
      const res = await api.testNotify(flow.id, r);
      onToast(res.ok ? "시험 알림을 보냈습니다 — 채널에서 확인하세요" : `보내지 못했습니다 — ${res.error}`);
    } catch (e) { onToast(e instanceof ApiError ? e.message : String(e)); }
    setTesting(null);
    void reload();
  };

  return (
    <div className="drawer-inner">
      <div className="drawer-head"><IconBell /><h2 className="grow">알림</h2><button className="icon-btn" onClick={onClose}><IconX /></button></div>
      <div className="drawer-body stack">
        <div className="small muted">
          <b>게시된 버전</b>의 실행 · 변경 감시만 알립니다{activeVersion !== null ? ` — 지금 v${activeVersion}` : " — 아직 게시하지 않았습니다"}. 편집 화면에서 초안을 시험할 때는 울리지 않습니다.
          규칙을 고친 뒤에는 새 버전으로 게시해야 바뀝니다.
        </div>

        {rules.length === 0 && <div className="small muted">아직 알림이 없습니다</div>}
        {rules.map((r) => (
          <div key={r.id} className="subcard">
            <div className="row">
              <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => setOne(r.id, { enabled: e.target.checked })} />켬</label>
              <select value={r.channel} onChange={(e) => setOne(r.id, { channel: e.target.value as NotifyChannel })}>
                {(Object.keys(CHANNEL) as NotifyChannel[]).map((c) => <option key={c} value={c}>{CHANNEL[c].label}</option>)}
              </select>
              <span className="grow" />
              <button className="small" disabled={testing !== null || r.url.trim() === "" || dirty} title={dirty ? "먼저 저장하세요 — 서버가 저장된 변수 · 시크릿으로 주소를 채웁니다" : ""}
                onClick={() => void test(r)}>{testing === r.id ? "보내는 중…" : "시험 보내기"}</button>
              <button className="icon-btn" title="알림 지우기" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}><IconX size={14} /></button>
            </div>
            <div className="row wrap">
              <span className="small muted">언제</span>
              {NOTIFY_EVENTS.map((ev) => (
                <label key={ev} className="check">
                  <input type="checkbox" checked={r.on.includes(ev)} onChange={(e) => setOne(r.id, { on: e.target.checked ? NOTIFY_EVENTS.filter((x) => x === ev || r.on.includes(x)) : r.on.filter((x) => x !== ev) })} />
                  {NOTIFY_EVENT_LABEL[ev]}
                </label>
              ))}
            </div>
            <Field label={r.channel === "email" ? "어디로 — 받는 사람" : "어디로 — 주소"} hint={CHANNEL[r.channel].hint}>
              <input className="mono" value={r.url} placeholder={CHANNEL[r.channel].placeholder} onChange={(e) => setOne(r.id, { url: e.target.value })} />
            </Field>
            {r.channel === "email" && mail && !mail.email && (
              <div className="banner warn small">이 서버는 아직 메일을 보낼 수 없습니다 — 서버 관리자에게 메일 서버(SMTP) 설정을 부탁하세요(<code>FLOWSMITH_SMTP_URL</code>)</div>
            )}
            {r.channel === "email" && mail?.email && <span className="small muted">보내는 사람: {mail.from}</span>}
            {r.channel === "email" && (
              <label className="check">
                <input type="checkbox" checked={r.attach} onChange={(e) => setOne(r.id, { attach: e.target.checked })} />
                성공하면 결과(목록)를 엑셀 파일로 붙이기 — 목록마다 시트 한 장
              </label>
            )}
            {r.channel !== "email" && textSecrets.length > 0 && !r.url.includes("$secrets") && (
              <div className="chips">
                <span className="small muted">시크릿으로:</span>
                {textSecrets.map((s) => <button key={s.name} className="secret" onClick={() => setOne(r.id, { url: `{{ $secrets.${s.name} }}` })}>{s.name}</button>)}
              </div>
            )}
            {r.channel !== "email" && /^https?:\/\//i.test(r.url.trim()) && (
              <span className="small" style={{ color: "var(--warn)" }}>주소가 워크플로우에 그대로 남습니다 — Slack · Teams 주소는 그 자체가 열쇠라 «글자 하나» 시크릿에 넣고 <code>{"{{ $secrets.이름 }}"}</code>으로 쓰세요</span>
            )}
            <label className="check">
              <input type="checkbox" checked={r.firstOnly} onChange={(e) => setOne(r.id, { firstOnly: e.target.checked })} />
              실패 · 사이트 바뀜이 이어지면 처음 한 번만(다시 성공하면 처음부터)
            </label>
          </div>
        ))}
        <button onClick={() => setRules((rs) => [...rs, { id: nextId("n", rs.map((x) => x.id)), on: ["failure", "recovered", "drift"], channel: mail?.email ? "email" : "slack", url: "", attach: false, firstOnly: true, enabled: true }])}>＋ 알림 더하기</button>
        <span className="small muted">
          알림에는 워크플로우 이름 · 무엇이 일어났나 · 멈춘 노드 · 실행 방법(일정 · 웹훅 …) · 걸린 시간과 이 화면으로 오는 링크가 들어갑니다.
          링크는 서버의 <code>FLOWSMITH_PUBLIC_URL</code>(없으면 서버 주소)로 만듭니다. 다른 워크플로우가 부른 실행은 부른 쪽이 알립니다.
        </span>

        <h3>보낸 알림</h3>
        {notices.length === 0 && <div className="small muted">아직 보낸 알림이 없습니다</div>}
        {notices.map((n) => (
          <div key={n.id} className="row small">
            <span className={`pill ${n.ok ? "ok" : "bad"}`}>{n.ok ? "보냄" : "못 보냄"}</span>
            <span className="muted">{dateTime(n.at)}</span>
            <span>{EVENT_LABEL[n.event] ?? n.event} → {CHANNEL[n.channel as NotifyChannel]?.label ?? n.channel}</span>
            <span className="grow muted" title={n.error}>{n.ok ? "" : n.error}</span>
          </div>
        ))}
        {notices.length > 0 && <button className="small ghost" onClick={() => void reload()}>다시 보기</button>}
      </div>
    </div>
  );
}
