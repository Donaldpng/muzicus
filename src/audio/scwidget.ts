/**
 * SoundCloud official embedded player (Widget API) — plays public SoundCloud links
 * without an API key. The widget stays visible (SoundCloud's terms require their player
 * and attribution to be shown). Audio lives inside SoundCloud's iframe, so EQ, speed,
 * visualizer and downloads are not available for these tracks.
 */
import { create } from "zustand";

interface ScwState {
  active: boolean;
  url: string | null;
  set: (p: Partial<ScwState>) => void;
}
export const useScw = create<ScwState>((set) => ({ active: false, url: null, set: (p) => set(p) }));

type Handlers = {
  onPlay: () => void;
  onPause: () => void;
  onProgress: (posSec: number, durSec: number) => void;
  onFinish: () => void;
  onError: () => void;
};

let apiPromise: Promise<void> | null = null;
let widget: any = null;
let iframe: HTMLIFrameElement | null = null;
let handlers: Handlers | null = null;
let duration = 0;
let pendingVolume = 85;

function loadApi(): Promise<void> {
  if ((window as any).SC?.Widget) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://w.soundcloud.com/player/api.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        apiPromise = null;
        reject(new Error("SoundCloud widget API failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

function widgetSrc(url: string) {
  const p = new URLSearchParams({
    url,
    auto_play: "true",
    visual: "false",
    show_comments: "false",
    hide_related: "true",
    show_reposts: "false",
    show_teaser: "false",
    color: "#ff8f6b",
  });
  return `https://w.soundcloud.com/player/?${p.toString()}`;
}

/** Host element is rendered by <ScWidgetHost/>; the iframe is created once and reused. */
function ensureIframe(): HTMLIFrameElement | null {
  const host = document.getElementById("scw-host");
  if (!host) return null;
  if (iframe && host.contains(iframe)) return iframe;
  iframe = document.createElement("iframe");
  iframe.allow = "autoplay; encrypted-media";
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("frameborder", "no");
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  host.appendChild(iframe);
  widget = null;
  return iframe;
}

export async function scwLoad(url: string, h: Handlers) {
  handlers = h;
  duration = 0;
  useScw.getState().set({ active: true, url });
  await new Promise((r) => requestAnimationFrame(() => r(null))); // let the host mount
  try {
    await loadApi();
  } catch {
    h.onError();
    return;
  }
  const SC = (window as any).SC;
  const fr = ensureIframe();
  if (!fr) return h.onError();
  if (widget) {
    widget.load(url, { auto_play: true, visual: false, show_comments: false, hide_related: true, callback: () => widget.setVolume(pendingVolume) });
    return;
  }
  fr.src = widgetSrc(url);
  widget = SC.Widget(fr);
  const E = SC.Widget.Events;
  widget.bind(E.READY, () => {
    widget.setVolume(pendingVolume);
    widget.play();
  });
  widget.bind(E.PLAY, () => {
    widget.getDuration((ms: number) => (duration = ms / 1000));
    handlers?.onPlay();
  });
  widget.bind(E.PAUSE, () => handlers?.onPause());
  widget.bind(E.FINISH, () => handlers?.onFinish());
  widget.bind(E.ERROR, () => handlers?.onError());
  widget.bind(E.PLAY_PROGRESS, (e: { currentPosition: number }) => {
    if (!duration) widget.getDuration((ms: number) => (duration = ms / 1000));
    handlers?.onProgress(e.currentPosition / 1000, duration);
  });
}

export function scwToggle() {
  widget?.toggle();
}
export function scwPause() {
  widget?.pause();
}
export function scwSeek(sec: number) {
  widget?.seekTo(Math.max(0, sec) * 1000);
}
export function scwVolume(v01: number) {
  pendingVolume = Math.round(v01 * 100);
  widget?.setVolume(pendingVolume);
}
/** Stop and hide the widget (switching to a regular track). */
export function scwStop() {
  if (!useScw.getState().active) return;
  widget?.pause();
  useScw.getState().set({ active: false });
}
export const scwActive = () => useScw.getState().active;
