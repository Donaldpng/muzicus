import { create } from "zustand";
import type { Track } from "../lib/types";

export type View =
  | { name: "home" }
  | { name: "search" }
  | { name: "library" }
  | { name: "playlist"; id: string }
  | { name: "liked" }
  | { name: "downloads" }
  | { name: "local" }
  | { name: "settings" };

export interface Toast {
  id: number;
  text: string;
  kind?: "ok" | "err";
}

export interface MenuState {
  x: number;
  y: number;
  track: Track;
  playlistId?: string;
  index?: number;
}

interface UiState {
  view: View;
  history: View[];
  nowPlaying: boolean;
  npTab: "vis" | "lyrics" | "queue" | "eq";
  importOpen: boolean;
  menu: MenuState | null;
  toasts: Toast[];
  searchQuery: string;
  go: (v: View) => void;
  back: () => void;
  set: (p: Partial<UiState>) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
}

let tid = 1;
export const useUi = create<UiState>((set, get) => ({
  view: { name: "home" },
  history: [],
  nowPlaying: false,
  npTab: "vis",
  importOpen: false,
  menu: null,
  toasts: [],
  searchQuery: "",
  go: (v) => set((s) => ({ view: v, history: [...s.history.slice(-30), s.view], menu: null })),
  back: () =>
    set((s) => {
      const h = s.history.slice();
      const v = h.pop();
      return v ? { view: v, history: h } : {};
    }),
  set: (p) => set(p),
  toast: (text, kind) => {
    const id = tid++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
    void get;
  },
}));

export const toast = (text: string, kind?: Toast["kind"]) => useUi.getState().toast(text, kind);
