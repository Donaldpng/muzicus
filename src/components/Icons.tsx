import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const S = ({ size = 20, children, ...p }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {children}
  </svg>
);

export const I = {
  home: (p: P) => <S {...p}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></S>,
  search: (p: P) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></S>,
  library: (p: P) => <S {...p}><path d="M4 4v16M9 4v16M14 4l6 16" /></S>,
  settings: (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></S>,
  play: (p: P) => <S {...p} fill="currentColor" stroke="none"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></S>,
  pause: (p: P) => <S {...p} fill="currentColor" stroke="none"><rect x="6" y="4" width="4.5" height="16" rx="1.2" /><rect x="13.5" y="4" width="4.5" height="16" rx="1.2" /></S>,
  next: (p: P) => <S {...p} fill="currentColor" stroke="none"><path d="M5 5.2v13.6a.8.8 0 0 0 1.2.7L16 13v5.5a1 1 0 0 0 2 0v-13a1 1 0 0 0-2 0V11L6.2 4.5a.8.8 0 0 0-1.2.7z" /></S>,
  prev: (p: P) => <S {...p} fill="currentColor" stroke="none"><path d="M19 5.2v13.6a.8.8 0 0 1-1.2.7L8 13v5.5a1 1 0 0 1-2 0v-13a1 1 0 0 1 2 0V11l9.8-6.5a.8.8 0 0 1 1.2.7z" /></S>,
  shuffle: (p: P) => <S {...p}><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></S>,
  repeat: (p: P) => <S {...p}><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></S>,
  repeat1: (p: P) => <S {...p}><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /><path d="M11 10h1v4" /></S>,
  heart: (p: P) => <S {...p}><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6z" /></S>,
  heartFill: (p: P) => <S {...p} fill="currentColor"><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6z" /></S>,
  download: (p: P) => <S {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></S>,
  check: (p: P) => <S {...p}><path d="M20 6 9 17l-5-5" /></S>,
  more: (p: P) => <S {...p}><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></S>,
  plus: (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
  close: (p: P) => <S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>,
  back: (p: P) => <S {...p}><path d="M15 18l-6-6 6-6" /></S>,
  down: (p: P) => <S {...p}><path d="m6 9 6 6 6-6" /></S>,
  volume: (p: P) => <S {...p}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></S>,
  mute: (p: P) => <S {...p}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6M16 9l6 6" /></S>,
  eq: (p: P) => <S {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></S>,
  lyrics: (p: P) => <S {...p}><path d="M4 6h16M4 10h10M4 14h16M4 18h8" /></S>,
  queue: (p: P) => <S {...p}><path d="M3 6h13M3 12h13M3 18h9M19 15v6M16 18h6" /></S>,
  wave: (p: P) => <S {...p}><path d="M2 12h2l2-6 3 12 3-15 3 18 3-12 2 3h2" /></S>,
  speed: (p: P) => <S {...p}><path d="M12 14l4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></S>,
  file: (p: P) => <S {...p}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M10 17a2 2 0 1 1-2-2 2 2 0 0 1 2 2zm0 0v-6l4-1" /></S>,
  link: (p: P) => <S {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></S>,
  trash: (p: P) => <S {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></S>,
  edit: (p: P) => <S {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" /></S>,
  radio: (p: P) => <S {...p}><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.5M7.8 16.2a6 6 0 0 1 0-8.5M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></S>,
  music: (p: P) => <S {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></S>,
  image: (p: P) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></S>,
  folder: (p: P) => <S {...p}><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /></S>,
  sun: (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>,
  moon: (p: P) => <S {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></S>,
  refresh: (p: P) => <S {...p}><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5" /></S>,
  up: (p: P) => <S {...p}><path d="m18 15-6-6-6 6" /></S>,
  loader: (p: P) => <S {...p}><path d="M12 3a9 9 0 1 0 9 9" /></S>,
};

/** Original round-cat doodle used as the MUZICUS mascot. */
export function Cat({ size = 120, mood = "chill" }: { size?: number; mood?: "chill" | "sleep" }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 150 120" fill="none" className="cat">
      <ellipse cx="75" cy="78" rx="56" ry="38" fill="var(--card)" stroke="currentColor" strokeWidth="3" />
      <path d="M34 58 30 26l26 18M116 58l4-32-26 18" fill="var(--card)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 66c10-14 22-18 35-18s25 4 35 18" stroke="none" />
      <ellipse cx="96" cy="70" rx="17" ry="13" fill="currentColor" opacity=".9" />
      {mood === "sleep" ? (
        <>
          <path d="M52 72q6 5 12 0M86 72q6 5 12 0" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" />
          <path d="M52 72q6 5 12 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="58" cy="72" r="4" fill="currentColor" />
          <circle cx="92" cy="72" r="4" fill="var(--bg)" />
        </>
      )}
      <path d="M71 82q4 4 8 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M128 92q16-2 12-20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 40q-4-10 4-16M58 34q0-8 6-12" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="var(--ink)" />
      <path d="M8 21V11l4 6 4-6v10M20 11v10" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.5" cy="10" r="2.3" fill="var(--accent)" />
    </svg>
  );
}
