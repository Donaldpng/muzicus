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
  source: string;
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
