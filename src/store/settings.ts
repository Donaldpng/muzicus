import { create } from "zustand";
import { api } from "../lib/api";

export type VisMode = "bars" | "mirror" | "wave" | "radial" | "grid" | "blocks";

export interface VisSettings {
  mode: VisMode;
  bars: number;
  smoothing: number;
  sensitivity: number;
  color: "accent" | "ink" | "gradient" | "custom";
  customColor: string;
  peaks: boolean;
  glow: boolean;
  lineWidth: number;
}

export interface EqSettings {
  enabled: boolean;
  preamp: number;
  gains: number[]; // 10 bands, dB
  preset: string;
}

export interface Settings {
  theme: "dark" | "light";
  accent: string;
  volume: number;
  rate: number;
  preservePitch: boolean;
  autoplay: boolean;
  eq: EqSettings;
  vis: VisSettings;
}

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<string, number[]> = {
  "Ровно": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Бас": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  "Супер бас": [9, 8, 6, 3, 0, -1, -1, 0, 0, 0],
  "Рок": [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
  "Поп": [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  "Электро": [5, 4, 1, 0, -2, 1, 1, 2, 4, 5],
  "Хип-хоп": [5, 4, 2, 3, -1, -1, 1, -1, 2, 3],
  "Вокал": [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  "Акустика": [3, 3, 2, 1, 1, 1, 2, 3, 2, 1],
  "Высокие": [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  "Ночь": [2, 1, 0, -1, -2, -2, -3, -4, -5, -6],
};

export const ACCENTS = ["#ff8f6b", "#f6c35b", "#8fd694", "#7fb8ff", "#c79bff", "#ff6fa3", "#e9e2d6"];

export const defaults: Settings = {
  theme: "dark",
  accent: ACCENTS[0],
  volume: 0.85,
  rate: 1,
  preservePitch: true,
  autoplay: true,
  eq: { enabled: false, preamp: 0, gains: EQ_PRESETS["Ровно"].slice(), preset: "Ровно" },
  vis: {
    mode: "bars",
    bars: 48,
    smoothing: 0.78,
    sensitivity: 1.1,
    color: "accent",
    customColor: "#7fb8ff",
    peaks: true,
    glow: true,
    lineWidth: 2,
  },
};

export const useSettings = create<Settings & { set: (p: Partial<Settings>) => void }>((set) => ({
  ...defaults,
  set: (p) => set(p),
}));

export function applyTheme(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty("--accent", s.accent);
  try {
    localStorage.setItem("muz-theme", JSON.stringify(s.theme));
  } catch {}
}

export async function loadSettings() {
  try {
    const raw = await api.loadState("settings");
    if (raw) {
      const d = JSON.parse(raw);
      useSettings.setState({
        ...defaults,
        ...d,
        eq: { ...defaults.eq, ...d.eq },
        vis: { ...defaults.vis, ...d.vis },
      });
    }
  } catch {}
  applyTheme(useSettings.getState());
  let t: number | undefined;
  useSettings.subscribe((s, prev) => {
    if (s.theme !== prev.theme || s.accent !== prev.accent) applyTheme(s);
    clearTimeout(t);
    t = window.setTimeout(() => {
      const { set: _s, ...data } = useSettings.getState();
      api.saveState("settings", JSON.stringify(data)).catch(() => {});
    }, 500);
  });
}
