/**
 * 작은 아이콘 묶음 — 선 아이콘(24 격자, stroke 1.8). 외부 아이콘 꾸러미를 들이지 않는다.
 */
import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconGlobe = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></Svg>;
export const IconBranch = (p: P) => <Svg {...p}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-11.3 7.2" /></Svg>;
export const IconCode = (p: P) => <Svg {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" stroke="none" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconX = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 4 2.8 19.5h18.4L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></Svg>;
/** 톱니바퀴 — 톱니 여덟 개(예전 것은 햇살 모양이라 해로 보였다) */
export const IconGear = (p: P) => <Svg {...p}><path d="M10.2 4.9 L10.8 2.5 L13.2 2.5 L13.8 4.9 L15.8 5.7 L17.9 4.4 L19.6 6.1 L18.3 8.2 L19.1 10.2 L21.5 10.8 L21.5 13.2 L19.1 13.8 L18.3 15.8 L19.6 17.9 L17.9 19.6 L15.8 18.3 L13.8 19.1 L13.2 21.5 L10.8 21.5 L10.2 19.1 L8.2 18.3 L6.1 19.6 L4.4 17.9 L5.7 15.8 L4.9 13.8 L2.5 13.2 L2.5 10.8 L4.9 10.2 L5.7 8.2 L4.4 6.1 L6.1 4.4 L8.2 5.7 Z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const IconChevronDown = (p: P) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconChevronUp = (p: P) => <Svg {...p}><path d="m6 15 6-6 6 6" /></Svg>;
export const IconArrowLeft = (p: P) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
export const IconSkip = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const IconRocket = (p: P) => <Svg {...p}><path d="M5 19c0-3 1-5 3-5l2 2c0 2-2 3-5 3Z" /><path d="M9.5 14.5 14 10c3-3 6-4.5 7-4.5 0 1-1.5 4-4.5 7L12 17M9 10H5.5L8 7h4M14 15v3.5L17 16v-4" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>;
export const IconList = (p: P) => <Svg {...p}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></Svg>;
export const IconKey = (p: P) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l2.5 2.5M14.5 8.5 16.5 10.5" /></Svg>;
export const IconPuzzle = (p: P) => <Svg {...p}><path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h-1.5a2 2 0 1 0 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3V4.5Z" /></Svg>;
export const IconSave = (p: P) => <Svg {...p}><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 19h14" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7Z" /></Svg>;
export const IconFileIn = (p: P) => <Svg {...p}><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" /><path d="M14 3.5V8h4.5M12 11v6M9.5 14.5 12 17l2.5-2.5" /></Svg>;
export const IconFileOut = (p: P) => <Svg {...p}><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" /><path d="M14 3.5V8h4.5M12 17v-6M9.5 13.5 12 11l2.5 2.5" /></Svg>;
export const IconFlowCall = (p: P) => <Svg {...p}><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /><path d="M10 7h3.5a2 2 0 0 1 2 2v5" /><path d="m13.5 12 2 2 2-2" /></Svg>;
export const IconLink = (p: P) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconCopy = (p: P) => <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></Svg>;
export const IconBell = (p: P) => <Svg {...p}><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5l1.5-2Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Svg>;
export const IconHttp = (p: P) => <Svg {...p}><path d="M4 12h11M11 7l5 5-5 5" /><path d="M19 5v14" /></Svg>;
export const IconSliders = (p: P) => <Svg {...p}><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></Svg>;
export const IconHome = (p: P) => <Svg {...p}><path d="M4 11 12 4l8 7" /><path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5" /></Svg>;
export const IconGrid = (p: P) => <Svg {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></Svg>;
export const IconSun = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Svg>;
export const IconMoon = (p: P) => <Svg {...p}><path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" /></Svg>;
export const IconMonitor = (p: P) => <Svg {...p}><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></Svg>;
export const IconChart = (p: P) => <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></Svg>;
export const IconBook = (p: P) => <Svg {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z" /></Svg>;
export const IconNote = (p: P) => <Svg {...p}><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /><path d="M8.5 9h7M8.5 12.5h4" /></Svg>;

/** 브랜드 마크 — 이어진 세 단계(Flow) 중 가운데를 망치(Smith)가 내리친다. 맞은 단계만 달군 주황.
 *  색이 정해진 그림이라 Svg · currentColor를 쓰지 않는다 — 바탕(숯빛 타일)은 감싸는 쪽(.brand-tile)이 깐다. public/favicon.svg와 같은 그림.
 *  sparks — 맞은 자리의 불꽃. 24px 밑에서는 뭉개지니 끈다 */
export const BrandMark = ({ size = 32, sparks = size >= 24, ...rest }: P & { sparks?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" {...rest}>
    <path d="M19 46.5h6.5M38.5 46.5H45" stroke="#f3e9dc" strokeWidth={3.2} strokeLinecap="round" />
    <rect x="6" y="40" width="13" height="13" rx="3.2" fill="#f3e9dc" />
    <rect x="25.5" y="40" width="13" height="13" rx="3.2" fill="#ff6b2c" />
    <rect x="45" y="40" width="13" height="13" rx="3.2" fill="#f3e9dc" />
    <g transform="translate(32 38) rotate(-12)" fill="#f3e9dc">
      <path d="M1 -13 L25 -24" stroke="#f3e9dc" strokeWidth={4.6} strokeLinecap="round" />
      <path d="M-7 -2q0 2 2 2h10q2 0 2-2v-11l-2.6-3.2v-6.3q0-1.5-1.5-1.5h-5.8q-1.5 0-1.5 1.5v6.3L-7 -13Z" />
    </g>
    {sparks && <path d="M21.5 37l-4.4-2.4M42.5 37l4.4-2.4M20.5 31.5l-4-.4" stroke="#ff6b2c" strokeWidth={2.6} strokeLinecap="round" />}
  </svg>
);

/* ── 노드 아이콘 — 두 겹(연한 면 + 선). 타일 · 노드 고르기 · 노드 창 머리에 쓴다 ── */
const soft = { fill: "currentColor", fillOpacity: 0.14, stroke: "none" } as const;
export const NodeIconWeb = (p: P) => <Svg {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" {...soft} /><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 9h18" /><path d="M6 6.8h.01M8.4 6.8h.01" strokeWidth={2.4} /><path d="m12.6 12.2 5.6 2.2-2.4.9-.9 2.4z" fill="currentColor" /></Svg>;
/** 사람 기다리기 — 사람 + 모래시계 점 */
export const NodeIconHuman = (p: P) => <Svg {...p}><circle cx="10" cy="7.5" r="3.5" {...soft} /><path d="M3.5 20c.6-3.9 3.2-6 6.5-6s5.9 2.1 6.5 6Z" {...soft} /><circle cx="10" cy="7.5" r="3.5" /><path d="M3.5 20c.6-3.9 3.2-6 6.5-6 1.5 0 2.8.4 3.9 1.2" /><circle cx="18" cy="17" r="3.6" /><path d="M18 15.3V17l1.2.9" /></Svg>;
/** 페이지 접속 — 창 + 들어가는 화살표 */
export const NodeIconOpen = (p: P) => <Svg {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" {...soft} /><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 9h18" /><path d="M6 6.8h.01M8.4 6.8h.01" strokeWidth={2.4} /><path d="M8 14.5h7m-2.5-2.5 2.5 2.5-2.5 2.5" /></Svg>;
export const NodeIconIf = (p: P) => <Svg {...p}><path d="M12 3.2 20.8 12 12 20.8 3.2 12Z" {...soft} /><path d="M12 3.2 20.8 12 12 20.8 3.2 12Z" /><path d="M8.6 12h3.1m0 0 2.7-2.7m-2.7 2.7 2.7 2.7" /></Svg>;
export const NodeIconTransform = (p: P) => <Svg {...p}><path d="M4 5h16l-6 7.4V19l-4-1.8v-4.8Z" {...soft} /><path d="M4 5h16l-6 7.4V19l-4-1.8v-4.8Z" /><path d="M18.5 15.5v4M16.5 17.5h4" /></Svg>;
export const NodeIconFileIn = (p: P) => <Svg {...p}><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" {...soft} /><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" /><path d="M14 3.5V8h4.5M12 11v6M9.5 14.5 12 17l2.5-2.5" /></Svg>;
export const NodeIconFileOut = (p: P) => <Svg {...p}><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" {...soft} /><path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" /><path d="M14 3.5V8h4.5M12 17v-6M9.5 13.5 12 11l2.5 2.5" /></Svg>;
export const NodeIconCall = (p: P) => <Svg {...p}><rect x="3" y="3.5" width="8" height="7" rx="1.8" {...soft} /><rect x="13" y="13.5" width="8" height="7" rx="1.8" {...soft} /><rect x="3" y="3.5" width="8" height="7" rx="1.8" /><rect x="13" y="13.5" width="8" height="7" rx="1.8" /><path d="M11 7h3.5a2.5 2.5 0 0 1 2.5 2.5v4" /><path d="m15 11.5 2 2 2-2" /></Svg>;
export const NodeIconHttp = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="3" {...soft} /><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 10.2h10m-2.6-2.6 2.6 2.6M17 13.8H7m2.6 2.6L7 13.8" /></Svg>;
export const NodeIconCode = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="3" {...soft} /><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m9.5 9.5-2.5 2.5 2.5 2.5M14.5 9.5l2.5 2.5-2.5 2.5M12.8 8.5l-1.6 7" /></Svg>;
export const NodeIconApproval = (p: P) => <Svg {...p}><path d="M12 3.2 19.5 6v5.6c0 4.4-3.1 7.6-7.5 9.2-4.4-1.6-7.5-4.8-7.5-9.2V6Z" {...soft} /><path d="M12 3.2 19.5 6v5.6c0 4.4-3.1 7.6-7.5 9.2-4.4-1.6-7.5-4.8-7.5-9.2V6Z" /><path d="m8.8 12.2 2.3 2.3 4.3-4.6" /></Svg>;
export const NodeIconCheck = (p: P) => <Svg {...p}><rect x="4" y="3.5" width="16" height="17" rx="2.5" {...soft} /><rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="m7.5 9 1.6 1.6 3-3.2" /><path d="M14 9.5h3" /><path d="m7.5 15 1.6 1.6 3-3.2" /><path d="M14 15.5h3" /></Svg>;
export const IconTestTube = (p: P) => <Svg {...p}><path d="M9 3.5h6M10 3.5v11.5a2 2 0 0 0 4 0V3.5" /><path d="M10 11h4" /><path d="m15.5 17.5 1.8 1.8 3.2-3.6" /></Svg>;
export const NodeIconExt = (p: P) => <Svg {...p}><path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h-1.5a2 2 0 1 0 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3V4.5Z" {...soft} /><path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h-1.5a2 2 0 1 0 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3V4.5Z" /></Svg>;
