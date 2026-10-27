/**
 * 빈 화면 — 아이콘 · 제목 · 한 줄 설명 · (있으면) 다음에 할 일 하나. 화면마다 모양이 같게.
 * ★행동은 하나만 — 제목 줄에 같은 단추가 이미 있으면 여기에는 두지 않는다.
 */
import type { ReactNode } from "react";

export function EmptyState({ icon, title, children, action, bare }: { icon: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; bare?: boolean }) {
  return (
    <div className={`empty-state${bare ? "" : " card"}`}>
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <b>{title}</b>
      {children && <span>{children}</span>}
      {action}
    </div>
  );
}
