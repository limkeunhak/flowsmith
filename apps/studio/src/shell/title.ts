/**
 * **탭 제목** — 화면마다 «이름 · Flowsmith». 브라우저 탭과 뒤로 가기 목록(길게 누르기)에서 어디였는지 알아보게.
 * null이면 건드리지 않는다 — 이름을 아는 화면(편집 · Suite · 가이드 · 실행 폼)이 제 것을 정한다(App은 나머지만).
 */
import { useEffect } from "react";

export function useTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) document.title = title ? `${title} · Flowsmith` : "Flowsmith";
  }, [title]);
}
