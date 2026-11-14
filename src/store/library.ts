import { create } from "zustand";
import { api, uid } from "../lib/api";
import type { Playlist, Track } from "../lib/types";

interface LibraryState {
  ready: boolean;
  tracks: Record<string, Track>;
  playlists: Playlist[];
  liked: string[];
  localIds: string[];
  history: string[];
  downloads: Record<string, true>; // keyed by track id
  dl: Record<string, number>; // download progress by track id

  upsert: (ts: Track[]) => void;
  patchTrack: (id: string, patch: Partial<Track>) => void;
  createPlaylist: (name: string, trackIds?: string[], cover?: string, source?: string) => Playlist;
  updatePlaylist: (id: string, patch: Partial<Playlist>) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (pid: string, ids: string[]) => void;
  removeFromPlaylist: (pid: string, idx: number) => void;
  moveInPlaylist: (pid: string, from: number, to: number) => void;
  toggleLike: (id: string) => void;
  pushHistory: (id: string) => void;
  addLocal: (t: Track) => void;
  removeLocal: (id: string) => void;
}

export const useLib = create<LibraryState>((set, get) => ({
  ready: false,
  tracks: {},
  playlists: [],
  liked: [],
  localIds: [],
  history: [],
  downloads: {},
  dl: {},

  upsert: (ts) =>
    set((s) => {
      const tracks = { ...s.tracks };
      for (const t of ts) tracks[t.id] = { ...tracks[t.id], ...t };
      return { tracks };
    }),
  patchTrack: (id, patch) =>
    set((s) => (s.tracks[id] ? { tracks: { ...s.tracks, [id]: { ...s.tracks[id], ...patch } } } : {})),
  createPlaylist: (name, trackIds = [], cover, source) => {
    const p: Playlist = { id: uid(), name, trackIds, cover, shuffle: false, repeat: "off", created: Date.now(), source };
    set((s) => ({ playlists: [p, ...s.playlists] }));
    return p;
  },
  updatePlaylist: (id, patch) =>
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  deletePlaylist: (id) => {
    const p = get().playlists.find((x) => x.id === id);
    if (p?.cover?.startsWith("f/")) api.deleteFile(p.cover).catch(() => {});
    set((s) => ({ playlists: s.playlists.filter((x) => x.id !== id) }));
  },
  addToPlaylist: (pid, ids) =>
    set((s) => ({
      playlists: s.playlists.map((p) =>
        p.id === pid ? { ...p, trackIds: [...p.trackIds, ...ids.filter((i) => !p.trackIds.includes(i))] } : p,
      ),
    })),
  removeFromPlaylist: (pid, idx) =>
    set((s) => ({
      playlists: s.playlists.map((p) =>
        p.id === pid ? { ...p, trackIds: p.trackIds.filter((_, i) => i !== idx) } : p,
      ),
    })),
  moveInPlaylist: (pid, from, to) =>
    set((s) => ({
      playlists: s.playlists.map((p) => {
        if (p.id !== pid) return p;
        const ids = p.trackIds.slice();
        const [x] = ids.splice(from, 1);
        ids.splice(Math.max(0, Math.min(ids.length, to)), 0, x);
        return { ...p, trackIds: ids };
      }),
    })),
  toggleLike: (id) =>
    set((s) => ({ liked: s.liked.includes(id) ? s.liked.filter((x) => x !== id) : [id, ...s.liked] })),
  pushHistory: (id) => set((s) => ({ history: [id, ...s.history.filter((x) => x !== id)].slice(0, 60) })),
  addLocal: (t) =>
    set((s) => ({
      tracks: { ...s.tracks, [t.id]: t },
      localIds: s.localIds.includes(t.id) ? s.localIds : [t.id, ...s.localIds],
    })),
  removeLocal: (id) => {
    const t = get().tracks[id];
    if (t?.local) api.deleteFile("files/" + t.local).catch(() => {});
    if (t?.cover?.startsWith("f/")) api.deleteFile(t.cover).catch(() => {});
    set((s) => ({
      localIds: s.localIds.filter((x) => x !== id),
      liked: s.liked.filter((x) => x !== id),
      playlists: s.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((x) => x !== id) })),
    }));
  },
}));

// ---------- persistence ----------
type Persisted = Pick<LibraryState, "tracks" | "playlists" | "liked" | "localIds" | "history">;

export async function loadLibrary() {
  try {
    const raw = await api.loadState("library");
    const dls = await api.listDownloads().catch(() => [] as string[]);
    const downloads: Record<string, true> = {};
    dls.forEach((d) => (downloads[d] = true));
    if (raw) {
      const d = JSON.parse(raw) as Persisted;
      useLib.setState({ ...d, downloads, ready: true });
    } else useLib.setState({ downloads, ready: true });
  } catch (e) {
    console.error(e);
    useLib.setState({ ready: true });
  }
  let timer: number | undefined;
  useLib.subscribe((s, prev) => {
    if (
      s.tracks === prev.tracks &&
      s.playlists === prev.playlists &&
      s.liked === prev.liked &&
      s.localIds === prev.localIds &&
      s.history === prev.history
    )
      return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const { tracks, playlists, liked, localIds, history } = useLib.getState();
      // garbage-collect tracks no longer referenced
      const used = new Set<string>([...liked, ...localIds, ...history]);
      playlists.forEach((p) => p.trackIds.forEach((i) => used.add(i)));
      const dls = useLib.getState().downloads;
      const kept: Record<string, Track> = {};
      for (const [id, t] of Object.entries(tracks)) if (used.has(id) || dls[id]) kept[id] = t;
      api.saveState("library", JSON.stringify({ tracks: kept, playlists, liked, localIds, history })).catch(console.error);
    }, 600);
  });
}
