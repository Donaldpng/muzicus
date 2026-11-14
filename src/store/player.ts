import { create } from "zustand";
import { engine } from "../audio/engine";
import { scwActive, scwLoad, scwSeek, scwStop, scwToggle, scwVolume } from "../audio/scwidget";
import { api, shuffleArr, trackUrl } from "../lib/api";
import type { QueueContext, Repeat, Track } from "../lib/types";
import { useLib } from "./library";
import { useSettings } from "./settings";
import { toast } from "./ui";

interface PlayerState {
  queue: string[];
  original: string[];
  index: number;
  context: QueueContext | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  buffered: number;
  shuffle: boolean;
  repeat: Repeat;
  /** where the current audio comes from: local | offline | audius | archive | jamendo | soundcloud | preview */
  sourceLabel: string | null;

  playList: (ids: string[], start?: number, ctx?: QueueContext) => void;
  playTrack: (t: Track, list?: Track[], ctx?: QueueContext) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  jump: (i: number) => void;
  setShuffle: (v: boolean) => void;
  setRepeat: (r: Repeat) => void;
  playNext: (t: Track) => void;
  enqueue: (t: Track) => void;
  removeAt: (i: number) => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  original: [],
  index: -1,
  context: null,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  buffered: 0,
  shuffle: false,
  repeat: "off",
  sourceLabel: null,

  playList: (ids, start = 0, ctx) => {
    if (!ids.length) return;
    let shuffle = get().shuffle;
    let repeat = get().repeat;
    if (ctx?.type === "playlist") {
      const p = useLib.getState().playlists.find((x) => x.id === ctx.id);
      if (p) {
        shuffle = p.shuffle;
        repeat = p.repeat;
      }
    }
    const startId = ids[start] ?? ids[0];
    let queue = ids.slice();
    let index = Math.max(0, ids.indexOf(startId));
    if (shuffle) {
      const rest = shuffleArr(ids.filter((_, i) => i !== index));
      queue = [startId, ...rest];
      index = 0;
    }
    set({ queue, original: ids.slice(), index, context: ctx ?? null, shuffle, repeat });
    load(true);
  },

  playTrack: (t, list, ctx) => {
    const lib = useLib.getState();
    if (list) {
      lib.upsert(list);
      const ids = list.map((x) => x.id);
      get().playList(ids, Math.max(0, ids.indexOf(t.id)), ctx ?? { type: "single" });
    } else {
      lib.upsert([t]);
      get().playList([t.id], 0, ctx ?? { type: "single" });
    }
  },

  toggle: () => {
    const a = engine.audio;
    if (get().index < 0) return;
    if (scwActive()) return scwToggle();
    engine.ensureGraph();
    if (!a.src) return load(true);
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  },

  next: (auto = false) => {
    const { queue, index, repeat } = get();
    if (!queue.length) return;
    if (auto && repeat === "one") {
      if (scwActive()) return load(true);
      engine.audio.currentTime = 0;
      engine.audio.play().catch(() => {});
      return;
    }
    if (index + 1 < queue.length) {
      set({ index: index + 1 });
      load(true);
    } else if (repeat === "all" || (!auto && queue.length > 1)) {
      set({ index: 0 });
      load(true);
    } else if (auto && useSettings.getState().autoplay) {
      autoRadio();
    } else {
      engine.audio.pause();
      engine.audio.currentTime = 0;
    }
  },

  prev: () => {
    const { index, queue } = get();
    if (engine.audio.currentTime > 4 || index <= 0) {
      if (index <= 0 && queue.length > 1 && get().repeat === "all" && engine.audio.currentTime <= 4) {
        set({ index: queue.length - 1 });
        return load(true);
      }
      engine.audio.currentTime = 0;
      return;
    }
    set({ index: index - 1 });
    load(true);
  },

  seek: (t) => {
    if (scwActive()) {
      scwSeek(t);
      return set({ position: t });
    }
    const a = engine.audio;
    if (isFinite(t)) a.currentTime = Math.max(0, Math.min(t, a.duration || t));
    set({ position: a.currentTime });
  },

  jump: (i) => {
    if (i < 0 || i >= get().queue.length) return;
    set({ index: i });
    load(true);
  },

  setShuffle: (v) => {
    const { queue, index, original, context } = get();
    const cur = queue[index];
    if (v) {
      const rest = shuffleArr(queue.filter((_, i) => i !== index));
      set({ shuffle: true, original: original.length ? original : queue.slice(), queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
    } else {
      const base = original.length ? original : queue;
      set({ shuffle: false, queue: base.slice(), index: Math.max(0, base.indexOf(cur)) });
    }
    if (context?.type === "playlist") useLib.getState().updatePlaylist(context.id, { shuffle: v });
  },

  setRepeat: (r) => {
    set({ repeat: r });
    const c = get().context;
    if (c?.type === "playlist") useLib.getState().updatePlaylist(c.id, { repeat: r });
  },

  playNext: (t) => {
    useLib.getState().upsert([t]);
    const { queue, index, original } = get();
    if (index < 0) return get().playTrack(t);
    const q = queue.slice();
    q.splice(index + 1, 0, t.id);
    set({ queue: q, original: [...original, t.id] });
    toast("Будет следующим");
  },

  enqueue: (t) => {
    useLib.getState().upsert([t]);
    const { queue, index, original } = get();
    if (index < 0) return get().playTrack(t);
    set({ queue: [...queue, t.id], original: [...original, t.id] });
    toast("Добавлено в очередь");
  },

  removeAt: (i) => {
    const { queue, index } = get();
    if (i === index) return;
    const q = queue.slice();
    q.splice(i, 1);
    set({ queue: q, index: i < index ? index - 1 : index });
  },
}));

export const currentTrack = (): Track | undefined => {
  const { queue, index } = usePlayer.getState();
  return useLib.getState().tracks[queue[index]];
};

export function useCurrentTrack(): Track | undefined {
  const id = usePlayer((s) => s.queue[s.index]);
  return useLib((s) => (id ? s.tracks[id] : undefined));
}

// ---------------------------------------------------------------- loading
let loadSeq = 0;
let playingSource: string | null = null;
const resolving = new Map<string, Promise<Track | null>>();

const isDownloaded = (t: Track) => !!useLib.getState().downloads[t.id];

/**
 * Make sure a track has something to play: local file, downloaded copy, or a matching
 * full-length file on an open platform (Audius / Archive / Jamendo / SoundCloud).
 * A 30-second Deezer preview is the last resort and is re-checked on every play.
 */
export async function ensurePlayable(t: Track, force = false): Promise<Track | null> {
  if (t.local || isDownloaded(t)) return t;
  if (t.src && t.src.full && !force) return t;
  let p = resolving.get(t.id);
  if (!p) {
    p = api
      .resolveSource(t)
      .then((src) => {
        if (!src) return null;
        const patch: Partial<Track> = { src };
        // previews expire — don't persist them
        if (src.full) useLib.getState().patchTrack(t.id, patch);
        return { ...t, ...patch };
      })
      .catch(() => null)
      .finally(() => resolving.delete(t.id));
    resolving.set(t.id, p);
  }
  return p;
}

async function load(autoplay: boolean) {
  const seq = ++loadSeq;
  const t0 = currentTrack();
  const a = engine.audio;
  if (!t0) return;
  engine.ensureGraph();
  usePlayer.setState({ loading: true, position: 0, duration: t0.duration ?? 0, buffered: 0 });
  a.pause();
  // SoundCloud link without API key → official embedded player
  if (t0.scw && !t0.local && !isDownloaded(t0)) {
    a.removeAttribute("src");
    a.load();
    usePlayer.setState({ sourceLabel: "scwidget" });
    useLib.getState().pushHistory(t0.id);
    updateMediaSession(t0);
    scwVolume(useSettings.getState().volume);
    scwLoad(t0.scw, {
      onPlay: () => seq === loadSeq && usePlayer.setState({ playing: true, loading: false }),
      onPause: () => seq === loadSeq && usePlayer.setState({ playing: false }),
      onProgress: (p, d) => seq === loadSeq && usePlayer.setState({ position: p, duration: d || usePlayer.getState().duration, buffered: d }),
      onFinish: () => seq === loadSeq && usePlayer.getState().next(true),
      onError: () => {
        if (seq !== loadSeq) return;
        usePlayer.setState({ loading: false, playing: false });
        toast("SoundCloud: трек недоступен для встраивания", "err");
        skipOnError(seq);
      },
    });
    return;
  }
  scwStop();
  const t = await ensurePlayable(t0);
  if (seq !== loadSeq) return;
  const url = t && trackUrl(t, isDownloaded(t));
  if (!url) {
    usePlayer.setState({ loading: false });
    toast(`Нет в открытых источниках: ${t0.artist} — ${t0.title}`, "err");
    skipOnError(seq);
    return;
  }
  playingSource = t!.local ? "local" : isDownloaded(t!) ? "offline" : t!.src?.provider ?? null;
  usePlayer.setState({ sourceLabel: playingSource });
  if (t!.src && !t!.src.full && !t!.local && !isDownloaded(t!)) toast("Полная версия не найдена — играет 30-секундное превью");
  a.src = url;
  a.playbackRate = useSettings.getState().rate;
  useLib.getState().pushHistory(t0.id);
  updateMediaSession(t);
  if (autoplay) a.play().catch((e) => console.warn("play", e));
  prefetchNext();
}

let errorStreak = 0;
function skipOnError(seq: number) {
  errorStreak++;
  if (errorStreak > 5) {
    errorStreak = 0;
    return;
  }
  setTimeout(() => {
    if (seq === loadSeq) usePlayer.getState().next(true);
  }, 600);
}

function prefetchNext() {
  const { queue, index } = usePlayer.getState();
  const id = queue[index + 1];
  if (!id) return;
  const t = useLib.getState().tracks[id];
  if (!t) return;
  setTimeout(() => void ensurePlayable(t), 1500);
}

async function autoRadio() {
  const t = currentTrack();
  if (!t || (!t.dz && !t.artist)) return;
  try {
    const list = await api.radio(t);
    if (!list.length) return;
    useLib.getState().upsert(list);
    const { queue, original } = usePlayer.getState();
    const known = new Set(queue);
    const add = list.map((x) => x.id).filter((i) => !known.has(i));
    usePlayer.setState({ queue: [...queue, ...add], original: [...original, ...add], context: { type: "radio" } });
    usePlayer.setState({ index: queue.length });
    load(true);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- audio events
const a = engine.audio;
let lastPos = 0;
a.addEventListener("playing", () => {
  errorStreak = 0;
  usePlayer.setState({ playing: true, loading: false });
});
a.addEventListener("play", () => usePlayer.setState({ playing: true }));
a.addEventListener("pause", () => usePlayer.setState({ playing: false }));
a.addEventListener("waiting", () => usePlayer.setState({ loading: true }));
a.addEventListener("canplay", () => usePlayer.setState({ loading: false }));
a.addEventListener("durationchange", () => {
  if (isFinite(a.duration)) usePlayer.setState({ duration: a.duration });
});
a.addEventListener("timeupdate", () => {
  const p = a.currentTime;
  if (Math.abs(p - lastPos) < 0.2) return;
  lastPos = p;
  let buffered = 0;
  for (let i = 0; i < a.buffered.length; i++) if (a.buffered.start(i) <= p) buffered = a.buffered.end(i);
  usePlayer.setState({ position: p, buffered });
});
a.addEventListener("ended", () => usePlayer.getState().next(true));
a.addEventListener("error", () => {
  const t = currentTrack();
  usePlayer.setState({ loading: false, playing: false });
  if (!a.src) return;
  toast(`Ошибка воспроизведения${t ? ": " + t.title : ""}`, "err");
  skipOnError(loadSeq);
});

// ---------------------------------------------------------------- media session (SMTC / media keys)
function updateMediaSession(t: Track) {
  if (!("mediaSession" in navigator)) return;
  try {
    const art = t.cover && !t.cover.startsWith("f/") ? [{ src: t.cover, sizes: "512x512" }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album ?? "", artwork: art });
  } catch {}
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const P = () => usePlayer.getState();
  try {
    ms.setActionHandler("play", () => P().toggle());
    ms.setActionHandler("pause", () => P().toggle());
    ms.setActionHandler("nexttrack", () => P().next());
    ms.setActionHandler("previoustrack", () => P().prev());
    ms.setActionHandler("seekto", (d) => d.seekTime != null && P().seek(d.seekTime));
  } catch {}
}

// keep the SoundCloud widget volume in sync with the app volume
useSettings.subscribe((s, p) => {
  if (s.volume !== p.volume) scwVolume(s.volume);
});
