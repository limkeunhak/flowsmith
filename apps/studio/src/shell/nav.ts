/**
 * **주소(해시) 길잡이** — 화면 이동 · 떠나기 전 확인을 한 곳에서.
 *
 * 화면은 주소의 해시로 고른다(App.tsx). 해시가 바뀌는 길은 셋이다 — 링크(<a href="#/…">) · 브라우저의 뒤로/앞으로 · 화면이 부르는 navigate().
 * ★셋 모두 지킴이(useLeaveGuard)를 거친다 — 저장하지 않은 고침이 있는 화면을 떠나려 하면 묻고, 그만두면 주소를 되돌린다.
 * 링크 · 뒤로는 이미 주소가 바뀐 뒤에 알게 되므로 원래 주소를 다시 넣는다(앞으로 갈 기록은 그때 끊긴다 — 고침을 잃는 것보다 낫다).
 */
import { useEffect, useRef, useState } from "react";

/** 떠날 때 — ask면 묻고(그만두면 머문다) · leave는 떠나기로 했을 때 할 일(빈 워크플로우 지우기 등). 상관없으면 null */
export type LeaveCheck = { ask?: string; leave?: () => void } | null;
type Guard = (from: string, to: string) => LeaveCheck;

const guards = new Set<{ current: Guard }>();
const NAV = "flowsmith:navigate";
/** 지금 화면이 보고 있는 주소 — 바뀌기 전 주소를 알아야 되돌릴 수 있다 */
let shown = typeof location === "undefined" ? "" : location.hash;

/** 떠나도 되나 — 묻고 · 떠나기로 했으면 할 일을 한다 */
function mayLeave(from: string, to: string): boolean {
  const checks = [...guards].map((g) => g.current(from, to)).filter((c): c is NonNullable<LeaveCheck> => c !== null);
  const ask = checks.find((c) => c.ask)?.ask;
  if (ask && !confirm(ask)) return false;
  for (const c of checks) c.leave?.();
  return true;
}

/**
 * 화면이 주소를 바꾼다 — replace면 기록을 쌓지 않는다(같은 목록 안에서 고르기 등).
 * state는 그 기록에 붙는다(replace면 없을 때 지금 것을 이어 간다). 떠나지 않기로 하면 false
 */
export function navigate(hash: string, { replace = false, state }: { replace?: boolean; state?: unknown } = {}): boolean {
  if (hash === location.hash) return true;
  if (!mayLeave(shown, hash)) return false;
  if (replace) history.replaceState(state === undefined ? history.state : state, "", hash);
  else history.pushState(state ?? null, "", hash);
  dispatchEvent(new Event(NAV));
  return true;
}

/** 지금 주소 — 링크 · 뒤로/앞으로 · navigate 모두에 따라 바뀐다(떠나지 않기로 하면 그대로) */
export function useHash(): string {
  const [hash, setHash] = useState(() => (shown = location.hash));
  useEffect(() => {
    const on = (e: Event) => {
      const to = location.hash;
      if (to === shown) return;                      // 뒤로 가기는 popstate · hashchange 둘 다 온다
      if (e.type !== NAV && !mayLeave(shown, to)) {
        history.pushState(null, "", shown || "#/"); // 되돌린다 — hashchange가 나지 않는다
        return;
      }
      shown = to;
      setHash(to);
    };
    addEventListener("hashchange", on);
    addEventListener("popstate", on);
    addEventListener(NAV, on);
    return () => { removeEventListener("hashchange", on); removeEventListener("popstate", on); removeEventListener(NAV, on); };
  }, []);
  return hash;
}

/** 이 화면을 떠날 때 물을 것 — guard는 매번 지금 값으로 불린다(ref) */
export function useLeaveGuard(guard: Guard): void {
  const ref = useRef(guard);
  ref.current = guard;
  useEffect(() => {
    guards.add(ref);
    return () => { guards.delete(ref); };
  }, []);
}
