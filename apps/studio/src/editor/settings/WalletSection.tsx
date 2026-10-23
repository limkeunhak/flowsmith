/**
 * 플로우 설정 — **테스트 지갑**(core wallet.ts · PLAN §40). 블록체인 사이트를 메타마스크 없이 자동화한다.
 * 개인키는 시크릿(글자)에 · 체인마다 RPC 주소와 «거래 허용». ★테스트 지갑 · QA 체인 전용.
 */
import type { Flow, WalletChain, WalletSettings } from "@flowsmith/core";
import { WALLET_ANNOUNCE } from "@flowsmith/core";
import { IconX } from "../../icons.tsx";
import { Field } from "../widgets.tsx";

type Update = (fn: (f: Flow) => Flow) => void;

export function WalletSection({ flow, update }: { flow: Flow; update: Update }) {
  const w = flow.settings.wallet;
  const set = (next: WalletSettings | null) => update((f) => ({ ...f, settings: { ...f.settings, wallet: next } }));
  const textSecrets = flow.secrets.filter((s) => s.kind === "text");
  const setChain = (i: number, patch: Partial<WalletChain>) => w && set({ ...w, chains: w.chains.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <>
      <h3>테스트 지갑 — 블록체인 사이트(메타마스크 대신)</h3>
      <label className="check">
        <input type="checkbox" checked={w !== null} onChange={(e) => set(e.target.checked
          ? { secret: textSecrets[0]?.name ?? "wallet_key", announceAs: "MetaMask", defaultChainId: 31337, chains: [{ chainId: 31337, name: "QA", rpcUrl: "", allowTx: false }] }
          : null)} />
        페이지에 테스트 지갑을 넣습니다 — 사이트의 «지갑 연결» · 서명을 서버가 개인키로 처리합니다
      </label>
      {w && (
        <div className="subcard stack" style={{ gap: 8 }}>
          {flow.settings.browser === "attach" && <div className="banner warn small">사람의 크롬에 붙는 워크플로우에는 넣지 않습니다 — 그 크롬의 메타마스크를 쓰고 «사람 기다리기»로 승인하세요</div>}
          <div className="row wrap">
            <Field label="개인키 시크릿(글자 하나 — 0x…64자리)">
              <select value={w.secret} onChange={(e) => set({ ...w, secret: e.target.value })}>
                {!textSecrets.some((s) => s.name === w.secret) && <option value={w.secret}>{w.secret} — 아직 정의 안 됨</option>}
                {textSecrets.map((s) => <option key={s.name} value={s.name}>{s.name}{s.description ? ` — ${s.description}` : ""}</option>)}
              </select>
            </Field>
            <Field label="사이트에 보이는 이름">
              <select value={w.announceAs} onChange={(e) => set({ ...w, announceAs: e.target.value as WalletSettings["announceAs"] })}>
                {WALLET_ANNOUNCE.map((a) => <option key={a} value={a}>{a}{a === "MetaMask" ? "(isMetaMask · io.metamask)" : ""}</option>)}
              </select>
            </Field>
          </div>
          {!textSecrets.some((s) => s.name === w.secret) && <span className="small" style={{ color: "var(--warn)" }}>위 «시크릿»에 «글자 하나» 종류로 «{w.secret}»을(를) 만들고 개인키를 넣으세요</span>}
          <span className="small muted">체인 — 사이트가 바꾸자고 하면 이 목록 안에서만 바꿉니다(목록 밖은 거절)</span>
          {w.chains.map((c, i) => (
            <div key={i} className="row wrap wallet-chain">
              <label className="check" title="처음 연결된 체인"><input type="radio" checked={w.defaultChainId === c.chainId} onChange={() => set({ ...w, defaultChainId: c.chainId })} />처음</label>
              <input type="number" min={1} style={{ width: 110 }} value={c.chainId} aria-label="체인 id" onChange={(e) => { const id = Number(e.target.value) || 1; set({ ...w, defaultChainId: w.defaultChainId === c.chainId ? id : w.defaultChainId, chains: w.chains.map((x, j) => (j === i ? { ...x, chainId: id } : x)) }); }} />
              <input style={{ width: 110 }} value={c.name} placeholder="이름" aria-label="체인 이름" onChange={(e) => setChain(i, { name: e.target.value })} />
              <input className="mono grow" value={c.rpcUrl} placeholder="RPC 주소 — https://qa-rpc… (비우면 서명만)" aria-label="RPC 주소" onChange={(e) => setChain(i, { rpcUrl: e.target.value })} />
              <label className="check" title="★QA 체인에서만 켜세요 — 사이트가 요청한 거래를 테스트 지갑으로 서명해 보냅니다"><input type="checkbox" checked={c.allowTx} onChange={(e) => setChain(i, { allowTx: e.target.checked })} />거래 허용</label>
              {w.chains.length > 1 && <button className="icon-btn" title="빼기" onClick={() => set({ ...w, chains: w.chains.filter((_, j) => j !== i), defaultChainId: w.defaultChainId === c.chainId ? w.chains.find((_, j) => j !== i)!.chainId : w.defaultChainId })}><IconX size={14} /></button>}
            </div>
          ))}
          <button className="small" onClick={() => set({ ...w, chains: [...w.chains, { chainId: Math.max(...w.chains.map((c) => c.chainId)) + 1, name: "", rpcUrl: "", allowTx: false }] })}>＋ 체인</button>
          <span className="small muted">
            계정 연결 · 로그인 서명(personal_sign · EIP-712)은 늘 자동입니다. 거래 전송은 «거래 허용»을 켠 체인에서만 · 그 밖은 거절(4100)합니다.
            아무 해시나 서명하는 eth_sign은 늘 거절합니다. 지갑이 한 일은 실행 기록의 그 노드 로그에 남습니다. ★테스트 지갑 · QA 체인 전용 — 실제 자산이 든 키를 넣지 마세요.
          </span>
        </div>
      )}
    </>
  );
}
