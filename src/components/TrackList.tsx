import { memo, useEffect, useRef, useState } from "react";
import { fmtTime } from "../lib/api";
import type { QueueContext, Track } from "../lib/types";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { Cover } from "./Common";
import { I } from "./Icons";

const ROW_H = 58;
const SRC_TAG: Record<string, string> = { audius: "AU", archive: "IA", jamendo: "JA", soundcloud: "SC" };

interface RowProps {
  t: Track;
  i: number;
  current: boolean;
  playing: boolean;
  liked: boolean;
  downloaded: boolean;
  dl?: number;
  onPlay: (i: number) => void;
  onMenu: (e: React.MouseEvent, t: Track, i: number) => void;
}

const Row = memo(function Row({ t, i, current, playing, liked, downloaded, dl, onPlay, onMenu }: RowProps) {
  const pending = !t.src && !t.local && !downloaded && t.source !== "deezer";
  return (
    <div
      className={`trow ${current ? "current" : ""} ${pending ? "pending" : ""}`}
      onDoubleClick={() => onPlay(i)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (window.matchMedia("(max-width: 860px)").matches) onPlay(i);
      }}
      onContextMenu={(e) => onMenu(e, t, i)}
    >
      <div className="num">
        {current ? (
          <span className={`eqbars ${playing ? "" : "paused"}`}>
            <i /> <i /> <i />
          </span>
        ) : (
          i + 1
        )}
      </div>
      <button style={{ position: "relative" }} onClick={() => onPlay(i)} aria-label="play">
        <Cover src={t.cover} size={42} radius={9} />
      </button>
      <div style={{ minWidth: 0 }}>
        <div className="t-title ellipsis">
          {t.title}
          <span className="t-flags">
            {downloaded && <I.check size={13} />}
            {dl != null && <span style={{ fontFamily: "var(--f-mono)", fontSize: 10 }}>{Math.round(dl * 100)}%</span>}
            {t.local && <I.file size={13} />}
            {!t.local && t.src?.full && <span className="src-tag">{SRC_TAG[t.src.provider] ?? "OK"}</span>}
          </span>
        </div>
        <div className="t-sub ellipsis">{t.artist || "—"}</div>
      </div>
      <div className="t-album ellipsis">{t.album ?? ""}</div>
      <div className="t-dur">{fmtTime(t.duration)}</div>
      <div className="t-act">
        <button
          className={`icon-btn sm hide-m ${liked ? "on" : ""}`}
          onClick={() => useLib.getState().toggleLike(t.id)}
          aria-label="like"
        >
          {liked ? <I.heartFill size={17} /> : <I.heart size={17} />}
        </button>
        <button className="icon-btn sm" onClick={(e) => onMenu(e, t, i)} aria-label="menu">
          <I.more size={18} />
        </button>
      </div>
    </div>
  );
});

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  while (el) {
    const o = getComputedStyle(el).overflowY;
    if (o === "auto" || o === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

/** Virtualized track list — handles thousands of rows smoothly. */
export function TrackList({
  tracks,
  ctx,
  playlistId,
  onPlay,
}: {
  tracks: Track[];
  ctx: QueueContext;
  playlistId?: string;
  onPlay?: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 60]);
  const curId = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const liked = useLib((s) => s.liked);
  const downloads = useLib((s) => s.downloads);
  const dl = useLib((s) => s.dl);
  const likedSet = new Set(liked);

  useEffect(() => {
    const el = ref.current;
    const sp = scrollParent(el);
    if (!el || !sp) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top - sp.getBoundingClientRect().top;
      const rowH = el.firstElementChild ? (el.firstElementChild as HTMLElement).offsetHeight || ROW_H : ROW_H;
      const start = Math.max(0, Math.floor(-top / rowH) - 10);
      const end = Math.min(tracks.length, Math.ceil((-top + sp.clientHeight) / rowH) + 10);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    sp.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      sp.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [tracks.length]);

  const play = (i: number) => {
    if (onPlay) return onPlay(i);
    const { playTrack } = usePlayer.getState();
    playTrack(tracks[i], tracks, ctx);
  };
  const menu = (e: React.MouseEvent, t: Track, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    useUi.getState().set({ menu: { x: e.clientX, y: e.clientY, track: t, playlistId, index: i } });
  };

  const virtual = tracks.length > 120;
  const [s, e] = virtual ? range : [0, tracks.length];
  const rowH = window.matchMedia("(max-width: 860px)").matches ? 62 : ROW_H;
  return (
    <div ref={ref} className="tracklist" style={virtual ? { height: tracks.length * rowH } : undefined}>
      {virtual && <div style={{ height: s * rowH }} />}
      {tracks.slice(s, e).map((t, k) => {
        const i = s + k;
        return (
          <Row
            key={t.id + ":" + i}
            t={t}
            i={i}
            current={t.id === curId}
            playing={playing}
            liked={likedSet.has(t.id)}
            downloaded={!!downloads[t.id]}
            dl={dl[t.id]}
            onPlay={play}
            onMenu={menu}
          />
        );
      })}
    </div>
  );
}
