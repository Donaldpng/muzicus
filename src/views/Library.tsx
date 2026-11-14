import { useMemo, useState } from "react";
import { api, pickFiles } from "../lib/api";
import { downloadMany, playlistAsText } from "../lib/actions";
import type { Playlist, QueueContext, Track } from "../lib/types";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { toast, useUi } from "../store/ui";
import { Cover } from "../components/Common";
import { Cat, I } from "../components/Icons";
import { TrackList } from "../components/TrackList";

async function addFiles(after?: (ids: string[]) => void) {
  const files = await pickFiles("audio/*,.mp3,.flac,.m4a,.ogg,.opus,.wav,.aac,.webm");
  const ids: string[] = [];
  for (const f of files) {
    try {
      const t = await api.saveUserFile(f);
      useLib.getState().addLocal(t);
      ids.push(t.id);
    } catch (e) {
      toast(`${f.name}: ${e}`, "err");
    }
  }
  if (ids.length) toast(`Добавлено файлов: ${ids.length}`, "ok");
  after?.(ids);
}

export function Library() {
  const playlists = useLib((s) => s.playlists);
  const liked = useLib((s) => s.liked.length);
  const local = useLib((s) => s.localIds.length);
  const dls = useLib((s) => Object.keys(s.downloads).length);
  const go = useUi((s) => s.go);
  const create = () => {
    const p = useLib.getState().createPlaylist("Новый плейлист");
    go({ name: "playlist", id: p.id });
  };
  const Special = ({ name, count, icon, onClick, inv }: { name: string; count: number; icon: React.ReactNode; onClick: () => void; inv?: boolean }) => (
    <button className="card pl-card" onClick={onClick}>
      <div className="cover" style={inv ? { background: "var(--accent)", color: "var(--on-accent)" } : { background: "var(--ink)", color: "var(--bg)" }}>{icon}</div>
      <div><div className="h3 ellipsis">{name}</div><div className="t-sub">{count} треков</div></div>
    </button>
  );
  return (
    <div className="page">
      <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 22, gap: 14 }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Library</div>
          <h1 className="h1">Библиотека</h1>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => addFiles()}><I.file size={16} /> Добавить файлы</button>
          <button className="btn" onClick={() => useUi.getState().set({ importOpen: true })}><I.link size={16} /> Перенести плейлист</button>
          <button className="btn primary" onClick={create}><I.plus size={16} /> Создать</button>
        </div>
      </div>
      <div className="grid-cards">
        <Special name="Любимые" count={liked} icon={<I.heartFill size={42} />} onClick={() => go({ name: "liked" })} inv />
        <Special name="Скачанные" count={dls} icon={<I.download size={42} />} onClick={() => go({ name: "downloads" })} />
        <Special name="Мои файлы" count={local} icon={<I.file size={42} />} onClick={() => go({ name: "local" })} />
        {playlists.map((p) => (
          <button key={p.id} className="card pl-card" onClick={() => go({ name: "playlist", id: p.id })}>
            <Cover src={p.cover} />
            <div style={{ minWidth: 0 }}>
              <div className="h3 ellipsis">{p.name}</div>
              <div className="t-sub">{p.trackIds.length} треков</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Generic list page: playlist / liked / downloads / local files. */
export function ListView({ kind, id }: { kind: "playlist" | "liked" | "downloads" | "local"; id?: string }) {
  const tracksMap = useLib((s) => s.tracks);
  const playlist = useLib((s) => (kind === "playlist" ? s.playlists.find((p) => p.id === id) : undefined));
  const liked = useLib((s) => s.liked);
  const localIds = useLib((s) => s.localIds);
  const downloads = useLib((s) => s.downloads);
  const [filter, setFilter] = useState("");
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const ctxNow = usePlayer((s) => s.context);

  const tracks: Track[] = useMemo(() => {
    let ids: string[] = [];
    if (kind === "playlist") ids = playlist?.trackIds ?? [];
    else if (kind === "liked") ids = liked;
    else if (kind === "local") ids = localIds;
    else ids = Object.values(tracksMap).filter((t) => t.yt && downloads[t.yt]).map((t) => t.id);
    return ids.map((i) => tracksMap[i]).filter(Boolean);
  }, [kind, playlist, liked, localIds, downloads, tracksMap]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return tracks;
    return tracks.filter((t) => (t.title + " " + t.artist + " " + (t.album ?? "")).toLowerCase().includes(f));
  }, [tracks, filter]);

  if (kind === "playlist" && !playlist) return <div className="page empty"><Cat /> Плейлист не найден</div>;

  const ctx: QueueContext = kind === "playlist" ? { type: "playlist", id: id! } : { type: kind };
  const isCtx = ctxNow?.type === ctx.type && (ctx.type !== "playlist" || (ctxNow as any).id === id);
  const plShuffle = playlist ? playlist.shuffle : isCtx ? shuffle : false;
  const plRepeat = playlist ? playlist.repeat : isCtx ? repeat : "off";
  const title = kind === "playlist" ? playlist!.name : kind === "liked" ? "Любимые" : kind === "local" ? "Мои файлы" : "Скачанные";
  const totalSec = tracks.reduce((a, t) => a + (t.duration ?? 0), 0);

  const playAll = (start = 0) => {
    if (!shown.length) return;
    usePlayer.getState().playList(shown.map((t) => t.id), start, ctx);
  };
  const setShuffle = (v: boolean) => {
    if (playlist) useLib.getState().updatePlaylist(playlist.id, { shuffle: v });
    if (isCtx || !playlist) usePlayer.getState().setShuffle(v);
  };
  const cycleRepeat = () => {
    const r = plRepeat === "off" ? "all" : plRepeat === "all" ? "one" : "off";
    if (playlist) useLib.getState().updatePlaylist(playlist.id, { repeat: r });
    if (isCtx || !playlist) usePlayer.getState().setRepeat(r);
  };
  const changeCover = async () => {
    if (!playlist) return;
    const [f] = await pickFiles("image/*", false);
    if (!f) return;
    const rel = await api.saveCover(f);
    if (playlist.cover?.startsWith("f/")) api.deleteFile(playlist.cover).catch(() => {});
    useLib.getState().updatePlaylist(playlist.id, { cover: rel });
  };

  const icon =
    kind === "liked" ? <I.heartFill size={70} /> : kind === "local" ? <I.file size={70} /> : kind === "downloads" ? <I.download size={70} /> : null;

  return (
    <div className="page">
      <div className="pl-hero">
        {playlist ? (
          <div className="cover" onClick={changeCover} title="Сменить обложку">
            {playlist.cover ? <Cover src={playlist.cover} size={undefined} className="" /> : <I.image size={56} />}
          </div>
        ) : (
          <div className="cover" style={{ background: kind === "liked" ? "var(--accent)" : "var(--ink)", color: kind === "liked" ? "var(--on-accent)" : "var(--bg)", cursor: "default" }}>{icon}</div>
        )}
        <div className="grow" style={{ width: "100%" }}>
          <div className="label">{kind === "playlist" ? "Плейлист" : "Коллекция"}</div>
          {playlist ? (
            <input
              className="h1 name-input"
              value={playlist.name}
              onChange={(e) => useLib.getState().updatePlaylist(playlist.id, { name: e.target.value })}
              onBlur={(e) => !e.target.value.trim() && useLib.getState().updatePlaylist(playlist.id, { name: "Без названия" })}
            />
          ) : (
            <h1 className="h1">{title}</h1>
          )}
          <div className="muted" style={{ margin: "8px 0 16px", fontWeight: 600 }}>
            {tracks.length} треков · {Math.round(totalSec / 60)} мин
          </div>
          <div className="row wrap">
            <button className="play-btn" onClick={() => playAll(0)} title="Слушать"><I.play size={22} style={{ marginLeft: 3 }} /></button>
            <button className={`icon-btn ${plShuffle ? "on" : ""}`} onClick={() => setShuffle(!plShuffle)} title="Перемешивание"><I.shuffle size={21} /></button>
            <button className={`icon-btn ${plRepeat !== "off" ? "on" : ""}`} onClick={cycleRepeat} title="Повтор">{plRepeat === "one" ? <I.repeat1 size={21} /> : <I.repeat size={21} />}</button>
            {kind !== "local" && kind !== "downloads" && (
              <button className="icon-btn" title="Скачать всё" onClick={() => downloadMany(tracks.filter((t) => !t.local && !(t.yt && downloads[t.yt])))}><I.download size={20} /></button>
            )}
            {kind === "local" && <button className="btn sm" onClick={() => addFiles()}><I.plus size={14} /> Файлы</button>}
            {playlist && (
              <>
                <button className="icon-btn" title="Добавить свои файлы" onClick={() => addFiles((ids) => useLib.getState().addToPlaylist(playlist.id, ids))}><I.file size={20} /></button>
                <button className="icon-btn" title="Копировать список" onClick={() => { navigator.clipboard.writeText(playlistAsText(tracks)); toast("Список скопирован"); }}><I.lyrics size={20} /></button>
                <button className="icon-btn" title="Обложка" onClick={changeCover}><I.image size={20} /></button>
                <button className="icon-btn" title="Удалить плейлист" onClick={() => {
                  if (confirm(`Удалить плейлист «${playlist.name}»?`)) {
                    useLib.getState().deletePlaylist(playlist.id);
                    useUi.getState().go({ name: "library" });
                  }
                }}><I.trash size={20} /></button>
              </>
            )}
          </div>
        </div>
      </div>
      {tracks.length > 8 && (
        <input className="input" style={{ marginBottom: 12, maxWidth: 360 }} placeholder="Фильтр…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {shown.length ? (
        <TrackList tracks={shown} ctx={ctx} playlistId={playlist && !filter ? playlist.id : undefined} onPlay={playAll} />
      ) : (
        <div className="empty">
          <Cat size={120} mood="sleep" />
          <div>
            {kind === "playlist" ? "Добавьте треки через поиск (меню трека → «В плейлист»)" : kind === "liked" ? "Отмечайте треки сердечком" : kind === "local" ? "Добавьте свои аудиофайлы" : "Скачанные треки будут доступны офлайн"}
          </div>
        </div>
      )}
    </div>
  );
}

export type { Playlist };
