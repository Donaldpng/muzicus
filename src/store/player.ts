import { create } from "zustand";
import { engine } from "../audio/engine";
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
  /** where the current audio comes from: local | offline | YouTube Music | open source */
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
    engine.ensureGraph();
    if (!a.src) return load(true);
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  },

  next: (auto = false) => {
    const { queue, index, repeat } = get();
    if (!queue.length) return;
    if (auto && repeat === "one") {
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
let loadedTrackId: string | null = null;
const resolving = new Map<string, Promise<Track | null>>();

const PROVIDERS_OK = new Set(["audius", "archive"]);
const isDownloaded = (t: Track) => !!useLib.getState().downloads[t.id];

/**
 * Make sure a track has something to play: local file, downloaded copy, or a matching
 * full-length file on an open platform (Audius / Internet Archive).
 * If an imported metadata-only track has no playable source, never fall back to a short preview.
 */
export async function ensurePlayable(t: Track, force = false): Promise<Track | null> {
  if (t.local || t.ytUrl || isDownloaded(t)) return t;
  // sources removed in later versions (SoundCloud, Jamendo) are re-matched
  if (t.src && t.src.full && !force && PROVIDERS_OK.has(t.src.provider)) return t;
  let p = resolving.get(t.id);
  if (!p) {
    p = api
      .resolveSource(t)
      .then((src) => {
        if (!src) return null;
        const patch: Partial<Track> = { src };
        // Only persist stable full-length sources.
        if (src.full) useLib.getState().patchTrack(t.id, patch);
        return { ...t, ...patch };
      })
      .catch(() => null)
      .finally(() => resolving.delete(t.id));
    resolving.set(t.id, p);
  }
  return p;
}

async function load(autoplay: boolean, startAt = 0) {
  const seq = ++loadSeq;
  const t0 = currentTrack();
  const a = engine.audio;
  if (!t0) return;
  loadedTrackId = null;
  engine.ensureGraph();
  usePlayer.setState({ loading: true, position: startAt, duration: t0.duration ?? 0, buffered: 0 });
  a.pause();
  const t = await ensurePlayable(t0);
  if (seq !== loadSeq) return;
  const url = t && trackUrl(t, isDownloaded(t));
  if (!url) {
    usePlayer.setState({ loading: false });
    toast(`Нет в открытых источниках: ${t0.artist} — ${t0.title}`, "err");
    skipOnError(seq);
    return;
  }
  playingSource = t!.local
    ? "local"
    : isDownloaded(t!)
      ? "offline"
      : t!.ytUrl
        ? t!.source === "ytmusic"
          ? "ytmusic"
          : "yt-dlp"
        : t!.src?.provider ?? null;
  usePlayer.setState({ sourceLabel: playingSource });
  a.src = url;
  loadedTrackId = t0.id;
  a.playbackRate = useSettings.getState().rate;
  useLib.getState().pushHistory(t0.id);
  updateMediaSession(t);
  if (startAt > 0) {
    if (a.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timeout);
          a.removeEventListener("loadedmetadata", done);
          a.removeEventListener("error", done);
          resolve();
        };
        const timeout = window.setTimeout(done, 10000);
        a.addEventListener("loadedmetadata", done, { once: true });
        a.addEventListener("error", done, { once: true });
      });
    }
    if (seq !== loadSeq || a.error) return;
    a.currentTime = Math.min(startAt, isFinite(a.duration) ? a.duration : startAt);
    usePlayer.setState({ position: a.currentTime });
  }
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
  if (!t?.yt) return;
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

// ---------------------------------------------------------------- playback persistence
interface PersistedPlayback {
  version: 1;
  queue: string[];
  original: string[];
  index: number;
  context: QueueContext | null;
  shuffle: boolean;
  repeat: Repeat;
  position: number;
  wasPlaying: boolean;
  tracks: Track[];
}

function isQueueContext(value: unknown): value is QueueContext | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const context = value as { type: unknown; id?: unknown };
  if (context.type === "playlist") return typeof context.id === "string";
  return ["liked", "downloads", "local", "search", "radio", "history", "single"].includes(String(context.type));
}

function isPersistedPlayback(value: unknown): value is PersistedPlayback {
  if (!value || typeof value !== "object") return false;
  const saved = value as Partial<PersistedPlayback>;
  return (
    saved.version === 1 &&
    Array.isArray(saved.queue) &&
    saved.queue.every((id) => typeof id === "string") &&
    Array.isArray(saved.original) &&
    saved.original.every((id) => typeof id === "string") &&
    Number.isInteger(saved.index) &&
    typeof saved.shuffle === "boolean" &&
    ["off", "all", "one"].includes(String(saved.repeat)) &&
    typeof saved.position === "number" &&
    isFinite(saved.position) &&
    saved.position >= 0 &&
    typeof saved.wasPlaying === "boolean" &&
    Array.isArray(saved.tracks) &&
    saved.tracks.every(
      (track) =>
        !!track &&
        typeof track.id === "string" &&
        typeof track.title === "string" &&
        typeof track.artist === "string" &&
        typeof track.source === "string",
    ) &&
    isQueueContext(saved.context)
  );
}

let persistenceStarted = false;
let persistenceTimer: number | undefined;
let lastPositionSave = 0;
let persistenceWrite = Promise.resolve();

function playbackSnapshot(): PersistedPlayback {
  const state = usePlayer.getState();
  const lib = useLib.getState();
  const trackIds = Array.from(new Set([...state.queue, ...state.original]));
  const tracks = trackIds.map((id) => lib.tracks[id]).filter((track): track is Track => !!track);
  const position =
    loadedTrackId === state.queue[state.index] && engine.audio.readyState >= HTMLMediaElement.HAVE_METADATA
      ? engine.audio.currentTime
      : state.position;
  return {
    version: 1,
    queue: state.queue,
    original: state.original,
    index: state.index,
    context: state.context,
    shuffle: state.shuffle,
    repeat: state.repeat,
    position: isFinite(position) ? Math.max(0, position) : 0,
    wasPlaying: state.playing,
    tracks,
  };
}

function schedulePlaybackSave(delay = 0) {
  if (!persistenceStarted || persistenceTimer !== undefined) return;
  persistenceTimer = window.setTimeout(() => {
    persistenceTimer = undefined;
    const snapshot = JSON.stringify(playbackSnapshot());
    persistenceWrite = persistenceWrite
      .catch((e) => console.error("save playback state", e))
      .then(() => api.saveState("player", snapshot))
      .catch((e) => console.error("save playback state", e));
  }, delay);
}

function startPlaybackPersistence() {
  if (persistenceStarted) return;
  persistenceStarted = true;
  usePlayer.subscribe((state, previous) => {
    if (
      state.queue !== previous.queue ||
      state.original !== previous.original ||
      state.index !== previous.index ||
      state.context !== previous.context ||
      state.shuffle !== previous.shuffle ||
      state.repeat !== previous.repeat ||
      state.playing !== previous.playing
    )
      schedulePlaybackSave();
  });
  a.addEventListener("play", () => schedulePlaybackSave());
  a.addEventListener("pause", () => schedulePlaybackSave());
  a.addEventListener("seeked", () => schedulePlaybackSave());
  a.addEventListener("ended", () => schedulePlaybackSave());
  a.addEventListener("timeupdate", () => {
    if (Date.now() - lastPositionSave < 2000) return;
    lastPositionSave = Date.now();
    schedulePlaybackSave();
  });
}

export async function restorePlayback() {
  try {
    const raw = await api.loadState("player");
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (isPersistedPlayback(value) && value.queue.length) {
        const lib = useLib.getState();
        lib.upsert(value.tracks);
        const loadedLib = useLib.getState();
        const queue = value.queue.filter((id) => {
          const track = loadedLib.tracks[id];
          return !!track && (!track.local || loadedLib.localIds.includes(id) || loadedLib.downloads[id]);
        });
        if (queue.length) {
          const original = value.original.filter((id) => queue.includes(id));
          const savedId = value.queue[value.index];
          const nextId = queue.includes(savedId)
            ? savedId
            : value.queue.slice(Math.max(0, value.index + 1)).find((id) => queue.includes(id)) ?? queue[0];
          const context =
            value.context?.type === "playlist" && !loadedLib.playlists.some((playlist) => playlist.id === value.context?.id)
              ? { type: "single" as const }
              : value.context;
          const state = {
            queue,
            original: original.length ? original : queue.slice(),
            index: queue.indexOf(nextId),
            context,
            shuffle: value.shuffle,
            repeat: value.repeat,
            position: value.position,
            playing: value.wasPlaying,
          };
          usePlayer.setState(state);
          startPlaybackPersistence();
          void load(value.wasPlaying, value.position);
          return;
        }
      }
    }
  } catch (e) {
    console.error("restore playback state", e);
  }
  startPlaybackPersistence();
}

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
