import { useState } from "react";
import { api } from "../lib/api";
import { downloadTrack, removeDownload } from "../lib/actions";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { toast, useUi } from "../store/ui";
import { Modal, Spinner, useFit } from "./Common";
import { I } from "./Icons";

export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  if (!menu) return null;
  return <MenuInner key={menu.track.id + menu.x + menu.y} />;
}

function MenuInner() {
  const menu = useUi((s) => s.menu)!;
  const close = () => useUi.getState().set({ menu: null });
  const { ref, pos } = useFit(menu.x, menu.y);
  const playlists = useLib((s) => s.playlists);
  const liked = useLib((s) => s.liked.includes(menu.track.id));
  const downloaded = useLib((s) => !!s.downloads[menu.track.id]);
  const [sub, setSub] = useState(false);
  const t = menu.track;
  const P = usePlayer.getState();
  const L = useLib.getState();
  const act = (f: () => void) => () => {
    f();
    close();
  };
  return (
    <div className="overlay" style={{ background: "transparent", display: "block" }} onMouseDown={(e) => e.target === e.currentTarget && close()} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div ref={ref} className="card ctx" style={{ left: pos.x, top: pos.y }}>
        <div style={{ padding: "8px 12px 6px" }}>
          <div className="t-title ellipsis" style={{ maxWidth: 240 }}>{t.title}</div>
          <div className="t-sub ellipsis" style={{ maxWidth: 240 }}>{t.artist}</div>
        </div>
        <hr />
        <button onClick={act(() => P.playTrack(t))}><I.play size={16} /> Воспроизвести</button>
        <button onClick={act(() => P.playNext(t))}><I.next size={16} /> Играть следующим</button>
        <button onClick={act(() => P.enqueue(t))}><I.queue size={16} /> В очередь</button>
        <button onClick={act(() => L.toggleLike(t.id))}>{liked ? <I.heartFill size={16} /> : <I.heart size={16} />} {liked ? "Убрать из любимых" : "В любимые"}</button>
        <button onClick={() => setSub(!sub)}><I.plus size={16} /> В плейлист… <span className="spacer" /><I.down size={14} /></button>
        {sub && (
          <>
            <button className="sub" onClick={act(() => {
              const p = L.createPlaylist("Новый плейлист", [t.id]);
              L.upsert([t]);
              useUi.getState().go({ name: "playlist", id: p.id });
            })}>+ Новый плейлист</button>
            {playlists.map((p) => (
              <button key={p.id} className="sub ellipsis" onClick={act(() => {
                L.upsert([t]);
                L.addToPlaylist(p.id, [t.id]);
                toast(`Добавлено в «${p.name}»`);
              })}>{p.name}</button>
            ))}
          </>
        )}
        {!t.local && !t.ytUrl && (
          downloaded ? (
            <button onClick={act(() => removeDownload(t))}><I.trash size={16} /> Удалить загрузку</button>
          ) : (
            <button onClick={act(() => { L.upsert([t]); downloadTrack(t); })}><I.download size={16} /> Скачать</button>
          )
        )}
        {t.yt && !t.local && (
          <button onClick={act(async () => {
            try {
              const list = await api.radio(t);
              usePlayer.getState().playTrack(t, [t, ...list], { type: "radio" });
            } catch (e) { toast("Не удалось: " + e, "err"); }
          })}><I.radio size={16} /> Похожие треки</button>
        )}
        {menu.playlistId && menu.index != null && (
          <>
            <hr />
            <button onClick={act(() => L.moveInPlaylist(menu.playlistId!, menu.index!, menu.index! - 1))}><I.up size={16} /> Выше</button>
            <button onClick={act(() => L.moveInPlaylist(menu.playlistId!, menu.index!, menu.index! + 1))}><I.down size={16} /> Ниже</button>
            <button className="danger" style={{ color: "var(--danger)" }} onClick={act(() => L.removeFromPlaylist(menu.playlistId!, menu.index!))}><I.trash size={16} /> Убрать из плейлиста</button>
          </>
        )}
        {t.local && (
          <button style={{ color: "var(--danger)" }} onClick={act(() => L.removeLocal(t.id))}><I.trash size={16} /> Удалить файл из библиотеки</button>
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ""}`}>{t.text}</div>
      ))}
    </div>
  );
}

const PLATFORMS = ["YouTube", "YT Music", "Spotify", "Deezer", "Яндекс Музыка", "Apple Music"];

export function ImportModal() {
  const open = useUi((s) => s.importOpen);
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open) return null;
  const close = () => {
    useUi.getState().set({ importOpen: false });
    setErr("");
  };
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const L = useLib.getState();
      let pl;
      if (mode === "url") {
        pl = await api.importPlaylist(url.trim());
      } else {
        const tracks = await api.importText(text);
        pl = { name: name.trim() || "Импорт", cover: undefined, tracks };
      }
      if (!pl.tracks.length) throw "Треки не найдены";
      L.upsert(pl.tracks);
      const p = L.createPlaylist(pl.name || "Импорт", pl.tracks.map((t) => t.id), pl.cover, mode === "url" ? url : "text");
      toast(`Импортировано треков: ${pl.tracks.length}`, "ok");
      setUrl("");
      setText("");
      setName("");
      close();
      useUi.getState().go({ name: "playlist", id: p.id });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Перенос плейлиста" onClose={close}>
      <div className="row">
        <button className={`chip ${mode === "url" ? "on" : ""}`} onClick={() => setMode("url")}><I.link size={14} /> По ссылке</button>
        <button className={`chip ${mode === "text" ? "on" : ""}`} onClick={() => setMode("text")}><I.lyrics size={14} /> Списком</button>
      </div>
      {mode === "url" ? (
        <>
          <input className="input" placeholder="https://open.spotify.com/playlist/…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && url && run()} />
          <div className="row wrap" style={{ gap: 6 }}>
            {PLATFORMS.map((p) => <span key={p} className="chip" style={{ height: 24, fontSize: 11, pointerEvents: "none" }}>{p}</span>)}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Плейлист должен быть публичным. Треки подбираются автоматически при воспроизведении. Если площадки нет в списке
            (VK, Zvuk и др.) — экспортируйте список треков и вставьте во вкладке «Списком».
          </div>
        </>
      ) : (
        <>
          <input className="input" placeholder="Название плейлиста" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" placeholder={"Исполнитель - Название\nИсполнитель - Название\n…"} value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}
      {err && <div style={{ color: "var(--danger)", fontWeight: 600, fontSize: 13 }}>{err}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={close}>Отмена</button>
        <button className="btn primary" disabled={busy || (mode === "url" ? !url.trim() : !text.trim())} onClick={run}>
          {busy ? <Spinner size={16} /> : <I.download size={16} />} Импортировать
        </button>
      </div>
    </Modal>
  );
}
