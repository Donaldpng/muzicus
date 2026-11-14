import { invoke } from "@tauri-apps/api/core";
import type { ImportedPlaylist, LyricsResult, Source, SourceConfig, Track } from "./types";

let port = 0;
let plat: "windows" | "android" | "other" = "other";

export async function initApi() {
  [port, plat] = await Promise.all([invoke<number>("server_port"), invoke<typeof plat>("platform")]);
}

export const platform = () => plat;
export const isMobile = () => plat === "android";
export const base = () => `http://127.0.0.1:${port}`;

/** Resolve an image reference (remote URL or `f/covers/..`) to a loadable URL. */
export function img(src?: string) {
  if (!src) return undefined;
  if (src.startsWith("f/")) return `${base()}/${src}`;
  return src;
}

/** Playable URL: local file → downloaded copy → resolved open source (proxied). */
export function trackUrl(t: Track, downloaded: boolean): string | null {
  if (t.local) return `${base()}/f/files/${encodeURIComponent(t.local)}`;
  if (downloaded) return `${base()}/dl/${encodeURIComponent(t.id)}`;
  if (t.src?.url) return `${base()}/p?u=${encodeURIComponent(t.src.url)}`;
  return null;
}

export const PROVIDERS: Record<string, string> = {
  audius: "Audius",
  archive: "Internet Archive",
  preview: "Превью 30 с",
};

export const api = {
  loadState: (name: string) => invoke<string | null>("load_state", { name }),
  saveState: (name: string, data: string) => invoke<void>("save_state", { name, data }),
  setSources: (cfg: SourceConfig) => invoke<void>("set_sources", { cfg }),
  search: (query: string) => invoke<Track[]>("search", { query }),
  openSearch: (query: string) => invoke<Track[]>("open_search", { query }),
  chart: () => invoke<Track[]>("chart"),
  suggest: (query: string) => invoke<string[]>("suggest", { query }),
  radio: (t: Track) => invoke<Track[]>("radio", { dz: t.dz ?? null, artist: t.artist || null }),
  resolveSource: (t: Track) =>
    invoke<Source | null>("resolve_source", { title: t.title, artist: t.artist, duration: t.duration ?? null, dz: t.dz ?? null }),
  importPlaylist: (url: string) => invoke<ImportedPlaylist>("import_playlist", { url }),
  importText: (text: string) => invoke<Track[]>("import_text", { text }),
  lyrics: (t: Track) =>
    invoke<LyricsResult | null>("lyrics", { title: t.title, artist: t.artist, duration: t.duration ?? null }),
  download: (id: string, url: string) => invoke<string>("download", { id, url }),
  deleteDownload: (id: string) => invoke<void>("delete_download", { id }),
  listDownloads: () => invoke<string[]>("list_downloads"),
  downloadsDir: () => invoke<string>("downloads_dir"),
  saveUserFile: async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    return invoke<Track>("save_user_file", buf, { headers: { "x-name": encodeURIComponent(file.name) } });
  },
  saveCover: async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    return invoke<string>("save_cover", buf, { headers: { "x-name": encodeURIComponent(file.name) } });
  },
  deleteFile: (rel: string) => invoke<void>("delete_file", { rel }),
};

export function fmtTime(s?: number) {
  if (s == null || !isFinite(s)) return "--:--";
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m).padStart(2, "0");
  return (h ? h + ":" : "") + mm + ":" + String(sec).padStart(2, "0");
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export function shuffleArr<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
