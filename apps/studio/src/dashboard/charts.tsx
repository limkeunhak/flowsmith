/**
 * 대시보드의 그림 — 도넛 · 쌓은 막대 · 꺾은선. SVG로 직접 그린다(차트 꾸러미를 들이지 않는다).
 * 색은 토큰(var(--…))만 쓴다 — 밝게 · 어둡게가 저절로 따라간다. 값 위에 올리면 <title>로 숫자가 뜬다.
 */
import type { ReactNode } from "react";
import { durationText } from "@flowsmith/core";

export interface Slice { label: string; value: number; color: string }

/** 숫자를 짧게 — 1,234 · 12.3만 */
export const num = (n: number): string => (n >= 100_000 ? `${(n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1)}만` : n.toLocaleString("ko-KR"));
/** 걸린 시간 — core의 durationText(화면 · 알림이 같은 말) · 없으면 «—» */
export const dur = (ms: number | null): string => durationText(ms, "—");
export const pct = (r: number | null): string => (r === null ? "—" : `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`);

/** 도넛 — 가운데 큰 숫자, 아래에 범례 */
export function Donut({ slices, center, sub, size = 168 }: { slices: Slice[]; center: ReactNode; sub?: string; size?: number }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 15.9155;   // 둘레 100
  let at = 25;         // 12시에서 시작
  return (
    <div className="donut">
      <div className="donut-ring" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(", ")}>
          <circle cx="21" cy="21" r={r} fill="none" stroke="var(--sunken)" strokeWidth="6" />
          {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * 100;
            const el = (
              <circle key={s.label} cx="21" cy="21" r={r} fill="none" stroke={s.color} strokeWidth="6"
                strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 0.6 : 0))} ${100 - len + (slices.length > 1 ? 0.6 : 0)}`} strokeDashoffset={at}>
                <title>{`${s.label} ${num(s.value)} (${Math.round((s.value / total) * 100)}%)`}</title>
              </circle>
            );
            at -= len;
            return el;
          })}
        </svg>
        <div className="donut-center"><b>{center}</b>{sub && <span>{sub}</span>}</div>
      </div>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.label}><i style={{ background: s.color }} /><span className="legend-label">{s.label}</span><b>{num(s.value)}</b></li>
        ))}
      </ul>
    </div>
  );
}

/** 보기 좋은 눈금의 끝 — 0 · 5 · 10 · 20 · 50 … */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const W = 640, H = 220, L = 40, B = 26, T = 10, Rr = 8;

/** 날 이름 — 10/17 */
const md = (day: string) => { const [, m, d] = day.split("-"); return `${Number(m)}/${Number(d)}`; };
/** 눈금 글자를 몇 칸마다 — 많으면 건너뛴다 */
const every = (n: number) => (n <= 10 ? 1 : n <= 31 ? Math.ceil(n / 8) : Math.ceil(n / 10));

/** 쌓은 막대 — 날마다 결과별 수 */
export function StackBars({ days, series }: { days: string[]; series: { label: string; color: string; values: number[] }[] }) {
  const totals = days.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(...totals, 0));
  const plotW = W - L - Rr, plotH = H - T - B;
  const slot = plotW / Math.max(1, days.length);
  const bw = Math.max(2, Math.min(28, slot * 0.62));
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="날마다 실행 수">
      {ticks.map((t) => (
        <g key={t}><line x1={L} x2={W - Rr} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 8} y={y(t) + 4} className="axis" textAnchor="end">{num(t)}</text></g>
      ))}
      {days.map((d, i) => {
        let acc = 0;
        const x = L + slot * i + (slot - bw) / 2;
        return (
          <g key={d}>
            {series.map((s) => {
              const v = s.values[i] ?? 0;
              if (v === 0) return null;
              const top = y(acc + v), h = y(acc) - top;
              acc += v;
              return <rect key={s.label} x={x} y={top} width={bw} height={Math.max(1, h)} rx={bw > 6 ? 2 : 0} fill={s.color}><title>{`${md(d)} ${s.label} ${num(v)}`}</title></rect>;
            })}
            {i % every(days.length) === 0 && <text x={x + bw / 2} y={H - 8} className="axis" textAnchor="middle">{md(d)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** 꺾은선 — 날마다 값(없는 날은 끊는다) */
export function Line({ days, values, color = "var(--accent)", format = dur }: { days: string[]; values: (number | null)[]; color?: string; format?: (v: number) => string }) {
  const max = niceMax(Math.max(...values.map((v) => v ?? 0), 0));
  const plotW = W - L - Rr, plotH = H - T - B;
  const step = plotW / Math.max(1, days.length - 1);
  const x = (i: number) => L + (days.length === 1 ? plotW / 2 : step * i);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const parts: string[] = [];
  let pen = false;
  values.forEach((v, i) => { if (v === null) { pen = false; return; } parts.push(`${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`); pen = true; });
  const ticks = [0, max / 2, max];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="날마다 실행 시간">
      {ticks.map((t) => (
        <g key={t}><line x1={L} x2={W - Rr} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 8} y={y(t) + 4} className="axis" textAnchor="end">{t === 0 ? "0" : format(t)}</text></g>
      ))}
      <path d={parts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => v !== null && (
        <circle key={days[i]} cx={x(i)} cy={y(v)} r="3" fill="var(--panel)" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"><title>{`${md(days[i]!)} ${format(v)}`}</title></circle>
      ))}
      {days.map((d, i) => i % every(days.length) === 0 && <text key={d} x={x(i)} y={H - 8} className="axis" textAnchor="middle">{md(d)}</text>)}
    </svg>
  );
}
