/**
 * 되풀이해 읽기 — 화면이 보일 때만. 탭을 가리면 쉬고, 돌아오면 바로 한 번 읽는다.
 * (대시보드 30초 · 워커 3초 — 사람이 안 볼 때 서버를 두드리지 않게)
 */
export function poll(load: () => void, ms: number): () => void {
  const t = setInterval(() => { if (!document.hidden) load(); }, ms);
  const back = () => { if (!document.hidden) load(); };
  document.addEventListener("visibilitychange", back);
  return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
}
