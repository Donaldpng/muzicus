import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLib } from "./store/library";
import { usePlayer, currentTrack } from "./store/player";
import { useSettings } from "./store/settings";
import { useUi } from "./store/ui";
import { ContextMenu, ImportModal, Toasts } from "./components/Overlays";
import { MiniPlayer, NowPlaying, PlayerBar } from "./components/Player";
import { MobileHeader, MobileNav, Sidebar, TitleBar, UpdateBanner } from "./components/Shell";
import { Home } from "./views/Home";
import { Library, ListView } from "./views/Library";
import { Search } from "./views/Search";
import { SettingsView } from "./views/Settings";

function Main() {
  const view = useUi((s) => s.view);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [view]);
  let page: React.ReactNode;
  switch (view.name) {
    case "home": page = <Home />; break;
    case "search": page = <Search />; break;
    case "library": page = <Library />; break;
    case "playlist": page = <ListView key={view.id} kind="playlist" id={view.id} />; break;
    case "liked": page = <ListView key="liked" kind="liked" />; break;
    case "downloads": page = <ListView key="dl" kind="downloads" />; break;
    case "local": page = <ListView key="local" kind="local" />; break;
    case "settings": page = <SettingsView />; break;
  }
  return (
    <main className="main" ref={ref}>
      {page}
    </main>
  );
}

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const P = usePlayer.getState();
      if (e.code === "Space") {
        e.preventDefault();
        P.toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.ctrlKey ? P.next() : P.seek(P.position + 5);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.ctrlKey ? P.prev() : P.seek(P.position - 5);
      } else if (e.key === "ArrowUp" && e.ctrlKey) {
        const s = useSettings.getState();
        s.set({ volume: Math.min(1, s.volume + 0.05) });
      } else if (e.key === "ArrowDown" && e.ctrlKey) {
        const s = useSettings.getState();
        s.set({ volume: Math.max(0, s.volume - 0.05) });
      } else if (e.key.toLowerCase() === "l" || e.key.toLowerCase() === "д") {
        const t = currentTrack();
        if (t) useLib.getState().toggleLike(t.id);
      } else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) {
        useUi.getState().back();
      }
    };
    window.addEventListener("keydown", onKey);
    // mouse "back" button
    const onMouse = (e: MouseEvent) => e.button === 3 && useUi.getState().back();
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, []);
}

export default function App() {
  useHotkeys();
  useEffect(() => {
    const un = listen<{ id: string; progress: number }>("dl-progress", (e) => {
      const { id, progress } = e.payload;
      if (progress >= 1) return;
      useLib.setState((s) => ({ dl: { ...s.dl, [id]: progress } }));
    });
    const block = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
    };
    window.addEventListener("contextmenu", block);
    return () => {
      un.then((f) => f());
      window.removeEventListener("contextmenu", block);
    };
  }, []);
  return (
    <div className="app">
      <TitleBar />
      <MobileHeader />
      <Sidebar />
      <Main />
      <PlayerBar />
      <MiniPlayer />
      <MobileNav />
      <NowPlaying />
      <ImportModal />
      <ContextMenu />
      <Toasts />
      <UpdateBanner />
    </div>
  );
}
