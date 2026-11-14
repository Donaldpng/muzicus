export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  cover?: string;
  /** YouTube video id used as audio source */
  yt?: string;
  /** file name inside app data /files */
  local?: string;
  /** Deezer catalog id */
  dz?: number;
  /** resolved playable source */
  src?: Source;
  source: string;
}

export interface Source {
  provider: "audius" | "archive" | "preview" | string;
  id: string;
  url: string;
  title: string;
  artist: string;
  duration?: number;
  full: boolean;
  page?: string;
}

export interface SourceConfig {
  audius: boolean;
  archive: boolean;
  preview: boolean;
}

export type Repeat = "off" | "all" | "one";

export interface Playlist {
  id: string;
  name: string;
  cover?: string;
  trackIds: string[];
  shuffle: boolean;
  repeat: Repeat;
  created: number;
  source?: string;
}

export interface ImportedPlaylist {
  name: string;
  cover?: string;
  tracks: Track[];
}

export interface LyricsResult {
  synced?: string;
  plain?: string;
  source: string;
}

export type QueueContext =
  | { type: "playlist"; id: string }
  | { type: "liked" | "downloads" | "local" | "search" | "radio" | "history" | "single"; id?: string };
