/**
 * 플로우 설정 — **지갑**(core wallet.ts). 브라우저에 따라 둘 중 하나:
 *   지갑 브라우저(MetaMask · PLAN §44) — 진짜 MetaMask에 키를 불러온다. 승인은 «MetaMask 승인» 동작이 한다
 *   띄우는 브라우저 — **테스트 지갑**(PLAN §40): 페이지에 지갑을 넣고 서버가 개인키로 답한다
 * 키는 시크릿(글자)에 · 체인마다 RPC 주소와 «거래 허용». ★테스트 지갑 · QA 체인 전용.
 */
import type { Flow, WalletChain, WalletSettings } from "@flowsmith/core";
import { WALLET_ANNOUNCE, walletSecretParam } from "@flowsmith/core";
import { IconX } from "../../icons.tsx";
import { Field } from "../widgets.tsx";

type Update = (fn: (f: Flow) => Flow) => void;

const firstTextSecret = (flow: Flow): string => flow.secrets.find((s) => s.kind === "text")?.name ?? "wallet_key";

/** 지갑 브라우저를 고를 때 — 체인 없이 시작한다(MetaMask의 기본 체인에서 연결 · 서명) */
export function newMetaMaskWallet(flow: Flow): WalletSettings {
  return { mode: "metamask", secret: firstTextSecret(flow), announceAs: "MetaMask", defaultChainId: 1, chains: [] };
}

export function WalletSection({ flow, update }: { flow: Flow; update: Update }) {
  const w = flow.settings.wallet;
  const set = (next: WalletSettings | null) => update((f) => ({ ...f, settings: { ...f.settings, wallet: next } }));
  const textSecrets = flow.secrets.filter((s) => s.kind === "text");
  const metamask = flow.settings.browser === "wallet";

  // 지갑 브라우저 — 지갑 설정은 늘 있다(브라우저를 고를 때 만들어졌다)
  if (metamask) {
    const mw = w?.mode === "metamask" ? w : newMetaMaskWallet(flow);
    return (
      <>
        <h3>MetaMask 지갑 — 지갑 브라우저</h3>
        <div className="subcard stack" style={{ gap: 8 }}>
          <SecretPick w={mw} set={set} flow={flow} textSecrets={textSecrets} label="키 시크릿(글자 하나 — 개인키 0x…64자리 또는 복구 문구 12~24 단어)" />
          <Chains w={mw} set={set} optional />
          <span className="small muted">
            «MetaMask 승인» 동작이 MetaMask 화면을 읽고 연결 · 로그인 서명은 누르고, 체인 추가 · 바꾸기는 위 목록 안만, 거래는 «거래 허용»을 켠 체인만 누릅니다.
            모르는 화면은 누르지 않고 멈춥니다. 처음 돌 때 지갑을 준비하고(30초쯤) 다음부터는 잠금만 풉니다 — 이메일 재인증 같은 사람 몫은 한 번 풀면 남습니다.
            ★테스트 지갑 · QA 체인 전용 — 실제 자산이 든 키를 넣지 마세요.
          </span>
        </div>
      </>
    );
  }

  const tw = w?.mode === "inject" ? w : null;
  return (
    <>
      <h3>테스트 지갑 — 블록체인 사이트(메타마스크 대신)</h3>
      <label className="check">
        <input type="checkbox" checked={tw !== null} onChange={(e) => set(e.target.checked
          ? { mode: "inject", secret: firstTextSecret(flow), announceAs: "MetaMask", defaultChainId: 31337, chains: [{ chainId: 31337, name: "QA", rpcUrl: "", allowTx: false }] }
          : null)} />
        페이지에 테스트 지갑을 넣습니다 — 사이트의 «지갑 연결» · 서명을 서버가 개인키로 처리합니다
      </label>
      <span className="small muted">사이트가 MetaMask 확장을 직접 확인하면(로그인 창에 «MetaMask Installed»가 떠야 하는 곳) 위 «브라우저»에서 지갑 브라우저(MetaMask)를 고르세요.</span>
      {tw && (
        <div className="subcard stack" style={{ gap: 8 }}>
          {flow.settings.browser === "attach" && <div className="banner warn small">사람의 크롬에 붙는 워크플로우에는 넣지 않습니다 — 그 크롬의 메타마스크를 쓰고 «사람 기다리기»로 승인하세요</div>}
          <div className="row wrap">
            <SecretPick w={tw} set={set} flow={flow} textSecrets={textSecrets} label="개인키 시크릿(글자 하나 — 0x…64자리)" />
            <Field label="사이트에 보이는 이름">
              <select value={tw.announceAs} onChange={(e) => set({ ...tw, announceAs: e.target.value as WalletSettings["announceAs"] })}>
                {WALLET_ANNOUNCE.map((a) => <option key={a} value={a}>{a}{a === "MetaMask" ? "(isMetaMask · io.metamask)" : ""}</option>)}
              </select>
            </Field>
          </div>
          <Chains w={tw} set={set} />
          <span className="small muted">
            계정 연결 · 로그인 서명(personal_sign · EIP-712)은 늘 자동입니다. 거래 전송은 «거래 허용»을 켠 체인에서만 · 그 밖은 거절(4100)합니다.
            아무 해시나 서명하는 eth_sign은 늘 거절합니다. 지갑이 한 일은 실행 기록의 그 노드 로그에 남습니다. ★테스트 지갑 · QA 체인 전용 — 실제 자산이 든 키를 넣지 마세요.
          </span>
        </div>
      )}
    </>
  );
}

function SecretPick({ w, set, flow, textSecrets, label }: { w: WalletSettings; set: (w: WalletSettings) => void; flow: Flow; textSecrets: Flow["secrets"]; label: string }) {
  // 실행마다 고르기 — «고르기» 실행 입력의 보기가 시크릿 이름들(두 지갑이 차례를 주고받는 거래)
  const choosers = flow.params.filter((p) => p.type === "select");
  const byParam = walletSecretParam(w.secret);
  const known = byParam !== null ? choosers.some((p) => p.name === byParam) : textSecrets.some((s) => s.name === w.secret);
  const missing = byParam !== null ? (choosers.find((p) => p.name === byParam)?.options ?? []).filter((o) => !textSecrets.some((s) => s.name === o)) : [];
  return (
    <>
      <Field label={label}>
        <select value={w.secret} onChange={(e) => set({ ...w, secret: e.target.value })}>
          {!known && <option value={w.secret}>{w.secret} — 아직 정의 안 됨</option>}
          {textSecrets.map((s) => <option key={s.name} value={s.name}>{s.name}{s.description ? ` — ${s.description}` : ""}</option>)}
          {choosers.map((p) => <option key={p.name} value={`{{ $params.${p.name} }}`}>실행 입력 «{p.label}»으로 고르기</option>)}
        </select>
      </Field>
      {!known && byParam === null && <span className="small" style={{ color: "var(--warn)" }}>위 «시크릿»에 «글자 하나» 종류로 «{w.secret}»을(를) 만들고 키를 넣으세요</span>}
      {!known && byParam !== null && <span className="small" style={{ color: "var(--warn)" }}>«고르기» 종류의 실행 입력 «{byParam}»을 만들고 보기에 시크릿 이름들을 넣으세요</span>}
      {missing.length > 0 && <span className="small" style={{ color: "var(--warn)" }}>보기 {missing.map((m) => `«${m}»`).join(" · ")}가 «글자 하나» 시크릿에 없습니다</span>}
      {byParam !== null && known && <span className="small muted">실행마다 지갑을 고릅니다 — 판매자 · 구매자가 실행 때 정해지는 거래에서 역할 워크플로우 한 벌을 두 지갑으로 돌립니다. 녹화는 입력의 기본값 지갑으로 합니다.</span>}
    </>
  );
}

/** 체인 목록 — optional이면 비워도 된다(MetaMask) */
function Chains({ w, set, optional = false }: { w: WalletSettings; set: (w: WalletSettings) => void; optional?: boolean }) {
  const setChain = (i: number, patch: Partial<WalletChain>) => set({ ...w, chains: w.chains.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const add = () => {
    const id = w.chains.length ? Math.max(...w.chains.map((c) => c.chainId)) + 1 : 1;
    set({ ...w, chains: [...w.chains, { chainId: id, name: "", rpcUrl: "", allowTx: false }], ...(w.chains.length === 0 ? { defaultChainId: id } : {}) });
  };
  return (
    <>
      <span className="small muted">
        {optional ? "체인 — 비우면 MetaMask의 기본 체인에서 연결 · 서명만 합니다. 넣으면 «MetaMask 승인»이 처음 체인으로 맞추고, 사이트가 바꾸자고 하면 이 목록 안에서만 바꿉니다"
          : "체인 — 사이트가 바꾸자고 하면 이 목록 안에서만 바꿉니다(목록 밖은 거절)"}
      </span>
      {w.chains.map((c, i) => (
        <div key={i} className="row wrap wallet-chain">
          <label className="check" title="처음 연결된 체인"><input type="radio" checked={w.defaultChainId === c.chainId} onChange={() => set({ ...w, defaultChainId: c.chainId })} />처음</label>
          <input type="number" min={1} style={{ width: 110 }} value={c.chainId} aria-label="체인 id" onChange={(e) => { const id = Number(e.target.value) || 1; set({ ...w, defaultChainId: w.defaultChainId === c.chainId ? id : w.defaultChainId, chains: w.chains.map((x, j) => (j === i ? { ...x, chainId: id } : x)) }); }} />
          <input style={{ width: 110 }} value={c.name} placeholder="이름" aria-label="체인 이름" onChange={(e) => setChain(i, { name: e.target.value })} />
          {optional && <input style={{ width: 70 }} value={c.symbol ?? ""} placeholder="ETH" aria-label="화폐 기호" title="화폐 기호 — MetaMask에 체인을 넣을 때(없으면 ETH)" onChange={(e) => {
            const symbol = e.target.value.trim();
            set({ ...w, chains: w.chains.map((x, j) => { if (j !== i) return x; const { symbol: _old, ...rest } = x; return symbol ? { ...rest, symbol } : rest; }) });
          }} />}
          <input className="mono grow" value={c.rpcUrl} placeholder={optional ? "RPC 주소 — 비우면 MetaMask가 아는 체인만(바꾸기)" : "RPC 주소 — https://qa-rpc… (비우면 서명만)"} aria-label="RPC 주소" onChange={(e) => setChain(i, { rpcUrl: e.target.value })} />
          <label className="check" title="★QA 체인에서만 켜세요 — 사이트가 요청한 거래를 승인합니다"><input type="checkbox" checked={c.allowTx} onChange={(e) => setChain(i, { allowTx: e.target.checked })} />거래 허용</label>
          {(optional || w.chains.length > 1) && <button className="icon-btn" title="빼기" onClick={() => { const rest = w.chains.filter((_, j) => j !== i); set({ ...w, chains: rest, defaultChainId: w.defaultChainId === c.chainId ? rest[0]?.chainId ?? 1 : w.defaultChainId }); }}><IconX size={14} /></button>}
        </div>
      ))}
      <button className="small" onClick={add}>＋ 체인</button>
    </>
  );
}
