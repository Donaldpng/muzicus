import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fmtTime } from "../lib/api";
import { downloadTrack } from "../lib/actions";
import { useLib } from "../store/library";
import { usePlayer, useCurrentTrack } from "../store/player";
import { useSettings, type VisMode } from "../store/settings";
import { useUi } from "../store/ui";
import { Cover, Pill, Range, Spinner } from "./Common";
import { Cat, I } from "./Icons";
import { EqPanel, Lyrics, QueuePanel, SpeedControl } from "./Panels";
import { Visualizer } from "./Visualizer";

function PlayButton({ big }: { big?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  return (
    <button className={`play-btn ${big ? "big" : ""}`} onClick={() => usePlayer.getState().toggle()} aria-label="play/pause">
      {loading && !playing ? <Spinner size={big ? 30 : 22} /> : playing ? <I.pause size={big ? 30 : 22} /> : <I.play size={big ? 30 : 22} style={{ marginLeft: 3 }} />}
    </button>
  );
}

function ShuffleBtn() {
  const on = usePlayer((s) => s.shuffle);
  return (
    <button className={`icon-btn ${on ? "on" : ""}`} onClick={() => usePlayer.getState().setShuffle(!on)} title="Перемешать">
      <I.shuffle size={19} />
    </button>
  );
}

function RepeatBtn() {
  const r = usePlayer((s) => s.repeat);
  const nextMode = r === "off" ? "all" : r === "all" ? "one" : "off";
  return (
    <button className={`icon-btn ${r !== "off" ? "on" : ""}`} onClick={() => usePlayer.getState().setRepeat(nextMode)} title={r === "one" ? "Повтор трека" : r === "all" ? "Повтор очереди" : "Повтор выкл."}>
      {r === "one" ? <I.repeat1 size={19} /> : <I.repeat size={19} />}
    </button>
  );
}

function Controls({ big }: { big?: boolean }) {
  const P = usePlayer.getState();
  return (
    <div className={big ? "np-ctrl" : "pb-controls"}>
      <ShuffleBtn />
      <button className="icon-btn" onClick={() => P.prev()} title="Назад"><I.prev size={big ? 26 : 20} /></button>
      <PlayButton big={big} />
      <button className="icon-btn" onClick={() => P.next()} title="Вперёд"><I.next size={big ? 26 : 20} /></button>
      <RepeatBtn />
    </div>
  );
}

function Progress() {
  const pos = usePlayer((s) => s.position);
  const dur = usePlayer((s) => s.duration);
  const buf = usePlayer((s) => s.buffered);
  return (
    <div className="pb-progress">
      <span className="seg">{fmtTime(pos)}</span>
      <Pill value={pos} max={dur || 1} buffered={buf} onSeek={(v) => usePlayer.getState().seek(v)} />
      <span className="seg">{fmtTime(dur)}</span>
    </div>
  );
}

function LikeBtn({ id }: { id: string }) {
  const liked = useLib((s) => s.liked.includes(id));
  return (
    <button className={`icon-btn ${liked ? "on" : ""}`} onClick={() => useLib.getState().toggleLike(id)} title="В любимые">
      {liked ? <I.heartFill size={19} /> : <I.heart size={19} />}
    </button>
  );
}

function Volume() {
  const v = useSettings((s) => s.volume);
  const set = useSettings((s) => s.set);
  const last = useRef(0.8);
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="icon-btn sm" onClick={() => { if (v > 0) { last.current = v; set({ volume: 0 }); } else set({ volume: last.current || 0.8 }); }}>
        {v === 0 ? <I.mute size={18} /> : <I.volume size={18} />}
      </button>
      <div className="pb-vol"><Range min={0} max={1} step={0.01} value={v} onChange={(x) => set({ volume: x })} /></div>
    </div>
  );
}

function SpeedPop() {
  const [open, setOpen] = useState(false);
  const rate = useSettings((s) => s.rate);
  const pitch = useSettings((s) => s.preservePitch);
  return (
    <div style={{ position: "relative" }}>
      <button className="rate-tag" onClick={() => setOpen(!open)} title="Скорость" style={rate !== 1 ? { background: "var(--accent)", color: "var(--on-accent)" } : undefined}>
        {Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0$/, "")}x
      </button>
      {open && (
        <>
          <div className="overlay" style={{ background: "transparent" }} onMouseDown={() => setOpen(false)} />
          <div className="pop card" style={{ zIndex: 61, padding: 0, border: 0, background: "transparent", boxShadow: "none" }}>
            <SpeedControl rate={rate} pitch={pitch} />
          </div>
        </>
      )}
    </div>
  );
}

const SRC_NAMES: Record<string, string> = {
  local: "Свой файл",
  offline: "Офлайн",
  audius: "Audius",
  archive: "Internet Archive",
  preview: "Превью 30 с",
};

function SourcePill() {
  const label = usePlayer((s) => s.sourceLabel);
  const t = useCurrentTrack();
  if (!label) return null;
  const page = t?.src?.page;
  return (
    <div style={{ marginTop: 10 }}>
      <button
        className={`src-pill ${label === "preview" ? "warn" : ""}`}
        title={page ? "Открыть страницу источника" : undefined}
        onClick={() => page && openUrl(page)}
        style={{ cursor: page ? "pointer" : "default" }}
      >
        {SRC_NAMES[label] ?? label}
        {page && <I.link size={11} />}
      </button>
    </div>
  );
}

export function PlayerBar() {
  const t = useCurrentTrack();
  const ui = useUi.getState();
  const openNp = (tab: "vis" | "lyrics" | "queue" | "eq") => ui.set({ nowPlaying: true, npTab: tab });
  const eqOn = useSettings((s) => s.eq.enabled);
  return (
    <div className="playerbar">
      <div className="pb-vis"><Visualizer compact /></div>
      <button className="pb-track" onClick={() => t && openNp("vis")} disabled={!t}>
        <Cover src={t?.cover} />
        <div style={{ minWidth: 0 }}>
          <div className="t-title ellipsis">{t?.title ?? "Ничего не играет"}</div>
          <div className="t-sub ellipsis">{t?.artist ?? "Найдите трек в поиске"}</div>
        </div>
      </button>
      <div className="pb-center">
        <Controls />
        <Progress />
      </div>
      <div className="pb-right">
        {t && <LikeBtn id={t.id} />}
        <SpeedPop />
        <button className={`icon-btn ${eqOn ? "on" : ""}`} title="Эквалайзер" onClick={() => openNp("eq")}><I.eq size={19} /></button>
        <button className="icon-btn" title="Текст" onClick={() => openNp("lyrics")}><I.lyrics size={19} /></button>
        <button className="icon-btn" title="Очередь" onClick={() => openNp("queue")}><I.queue size={19} /></button>
        <Volume />
      </div>
    </div>
  );
}

export function MiniPlayer() {
  const t = useCurrentTrack();
  const pos = usePlayer((s) => s.position);
  const dur = usePlayer((s) => s.duration);
  if (!t) return null;
  return (
    <div className="mini-player card" onClick={(e) => !(e.target as HTMLElement).closest("button") && useUi.getState().set({ nowPlaying: true })}>
      <Cover src={t.cover} />
      <div className="grow">
        <div className="t-title ellipsis">{t.title}</div>
        <div className="t-sub ellipsis">{t.artist}</div>
      </div>
      <LikeBtn id={t.id} />
      <PlayButton />
      <div className="mp-prog" style={{ width: (dur ? (pos / dur) * 100 : 0) + "%" }} />
    </div>
  );
}

const VIS_MODES: { id: VisMode; name: string }[] = [
  { id: "bars", name: "Полосы" },
  { id: "mirror", name: "Зеркало" },
  { id: "wave", name: "Волна" },
  { id: "radial", name: "Круг" },
  { id: "grid", name: "HUD" },
  { id: "blocks", name: "LED" },
];

export function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const tab = useUi((s) => s.npTab);
  const t = useCurrentTrack();
  const mode = useSettings((s) => s.vis.mode);
  const isDl = useLib((s) => !!(t && s.downloads[t.id]));
  const dlp = useLib((s) => (t ? s.dl[t.id] : undefined));
  const close = () => useUi.getState().set({ nowPlaying: false });
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  if (!open) return null;
  const setTab = (x: typeof tab) => useUi.getState().set({ npTab: x });
  const setMode = (m: VisMode) => useSettings.getState().set({ vis: { ...useSettings.getState().vis, mode: m } });
  return (
    <div className="np has-panel">
      <div className="np-top">
        <button className="icon-btn" onClick={close}><I.down size={22} /></button>
        <div className="grow">
          <div className="label">Сейчас играет</div>
        </div>
        {t && !t.local && (
          <button className="icon-btn" title="Скачать" onClick={() => downloadTrack(t)} disabled={isDl}>
            {isDl ? <I.check size={19} /> : dlp != null ? <span className="seg" style={{ fontSize: 10 }}>{Math.round(dlp * 100)}</span> : <I.download size={19} />}
          </button>
        )}
      </div>
      <div className="np-left">
        <div className="np-cover">
          {t?.cover ? <Cover src={t.cover} className="" /> : <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Cat size={160} /></div>}
        </div>
        <div className="np-meta">
          <div className="h2 ellipsis">{t?.title ?? "—"}</div>
          <div className="muted ellipsis" style={{ marginTop: 4, fontWeight: 600 }}>{t?.artist}</div>
          <SourcePill />
        </div>
        <div style={{ width: "min(460px, 100%)" }}><Progress /></div>
        <Controls big />
        <div className="row" style={{ gap: 6 }}>
          {t && <LikeBtn id={t.id} />}
          <SpeedPop />
        </div>
      </div>
      <div className="np-right">
        <div className="tabs">
          <button className={`chip ${tab === "vis" ? "on" : ""}`} onClick={() => setTab("vis")}><I.wave size={14} /> Визуализатор</button>
          <button className={`chip ${tab === "lyrics" ? "on" : ""}`} onClick={() => setTab("lyrics")}><I.lyrics size={14} /> Текст</button>
          <button className={`chip ${tab === "queue" ? "on" : ""}`} onClick={() => setTab("queue")}><I.queue size={14} /> Очередь</button>
          <button className={`chip ${tab === "eq" ? "on" : ""}`} onClick={() => setTab("eq")}><I.eq size={14} /> EQ и скорость</button>
        </div>
        <div className="np-panel">
          {tab === "vis" && (
            <div className="vis-wrap hud-corners">
              <div style={{ position: "absolute", inset: "40px 28px 70px" }}><Visualizer /></div>
              <div className="vis-modes">
                {VIS_MODES.map((m) => (
                  <button key={m.id} className={`chip ${mode === m.id ? "on" : ""}`} style={{ height: 26, fontSize: 11 }} onClick={() => setMode(m.id)}>{m.name}</button>
                ))}
              </div>
            </div>
          )}
          {tab === "lyrics" && <Lyrics track={t} />}
          {tab === "queue" && <QueuePanel />}
          {tab === "eq" && <EqPanel />}
        </div>
      </div>
    </div>
  );
}
