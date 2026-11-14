import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLib } from "../store/library";
import { useUi, type View } from "../store/ui";
import { Cover } from "./Common";
import { I, Logo } from "./Icons";
import { checkForUpdate, installUpdate, type UpdateInfo } from "../lib/updater";
import { isMobile } from "../lib/api";

export function TitleBar() {
  if (isMobile()) return null;
  const w = getCurrentWindow();
  return (
    <div className="titlebar desktop-only" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <Logo size={20} /> MUZICUS
      </div>
      <div className="drag" data-tauri-drag-region onDoubleClick={() => w.toggleMaximize()} />
      <div className="winbtns">
        <button title="Свернуть" onClick={() => w.minimize()} />
        <button title="Развернуть" onClick={() => w.toggleMaximize()} />
        <button className="close" title="Закрыть" onClick={() => w.close()} />
      </div>
    </div>
  );
}

const NAV: { v: View; label: string; icon: keyof typeof I }[] = [
  { v: { name: "home" }, label: "Главная", icon: "home" },
  { v: { name: "search" }, label: "Поиск", icon: "search" },
  { v: { name: "library" }, label: "Библиотека", icon: "library" },
  { v: { name: "downloads" }, label: "Скачанные", icon: "download" },
  { v: { name: "settings" }, label: "Настройки", icon: "settings" },
];

export function Sidebar() {
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const playlists = useLib((s) => s.playlists);
  return (
    <aside className="sidebar">
      {NAV.map((n) => {
        const Ico = I[n.icon];
        return (
          <button key={n.label} className={`nav-item ${view.name === n.v.name ? "active" : ""}`} onClick={() => go(n.v)}>
            <Ico size={19} /> {n.label}
          </button>
        );
      })}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 18, padding: "0 6px" }}>
        <span className="label">Плейлисты</span>
        <button className="icon-btn sm" title="Импорт" onClick={() => useUi.getState().set({ importOpen: true })}><I.link size={16} /></button>
      </div>
      <div className="side-pls">
        <button className={`side-pl ${view.name === "liked" ? "active" : ""}`} onClick={() => go({ name: "liked" })}>
          <div className="cover" style={{ background: "var(--accent)", color: "var(--on-accent)" }}><I.heartFill size={16} /></div>
          <span className="ellipsis" style={{ fontWeight: 600 }}>Любимые</span>
        </button>
        <button className={`side-pl ${view.name === "local" ? "active" : ""}`} onClick={() => go({ name: "local" })}>
          <div className="cover" style={{ background: "var(--ink)", color: "var(--bg)" }}><I.file size={16} /></div>
          <span className="ellipsis" style={{ fontWeight: 600 }}>Мои файлы</span>
        </button>
        {playlists.map((p) => (
          <button key={p.id} className={`side-pl ${view.name === "playlist" && view.id === p.id ? "active" : ""}`} onClick={() => go({ name: "playlist", id: p.id })}>
            <Cover src={p.cover} size={34} radius={8} />
            <div style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="t-sub" style={{ fontSize: 11 }}>{p.trackIds.length} тр.</div>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function MobileHeader() {
  const view = useUi((s) => s.view);
  const hist = useUi((s) => s.history.length);
  const canBack = hist > 0 && !["home", "search", "library", "settings"].includes(view.name);
  return (
    <div className="m-header">
      {canBack ? (
        <button className="icon-btn" onClick={() => useUi.getState().back()}><I.back size={22} /></button>
      ) : (
        <div className="brand"><Logo size={22} /> MUZICUS</div>
      )}
      <div className="spacer" />
      <button className="icon-btn" onClick={() => useUi.getState().set({ importOpen: true })}><I.link size={19} /></button>
      <button className="icon-btn" onClick={() => useUi.getState().go({ name: "downloads" })}><I.download size={19} /></button>
    </div>
  );
}

export function MobileNav() {
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const items = [NAV[0], NAV[1], NAV[2], NAV[4]];
  return (
    <nav className="mobile-nav">
      {items.map((n) => {
        const Ico = I[n.icon];
        const active = view.name === n.v.name || (n.v.name === "library" && ["playlist", "liked", "local", "downloads"].includes(view.name));
        return (
          <button key={n.label} className={active ? "active" : ""} onClick={() => go(n.v)}>
            <Ico size={21} />
            {n.label}
          </button>
        );
      })}
    </nav>
  );
}

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => checkForUpdate().then(setInfo).catch(() => {}), 4000);
    const iv = setInterval(() => checkForUpdate().then((i) => i && setInfo(i)).catch(() => {}), 1000 * 60 * 60 * 3);
    const on = (e: Event) => setInfo((e as CustomEvent).detail);
    window.addEventListener("muz-update", on);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
      window.removeEventListener("muz-update", on);
    };
  }, []);
  if (!info) return null;
  return (
    <div className="card update-banner">
      <div className="grow">
        <div className="label">Обновление</div>
        <div className="h3" style={{ marginTop: 3 }}>Доступна версия {info.version}</div>
        {busy && progress > 0 && <div className="muted" style={{ fontSize: 12 }}>{Math.round(progress * 100)}%</div>}
      </div>
      <button className="btn ghost sm" onClick={() => setInfo(null)}>Позже</button>
      <button
        className="btn accent sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await installUpdate(info, setProgress);
          } finally {
            setBusy(false);
          }
        }}
      >
        {isMobile() ? "Скачать APK" : busy ? "Установка…" : "Обновить"}
      </button>
    </div>
  );
}
