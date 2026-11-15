import { useEffect, useState } from "react";
import { api, pickFiles } from "../lib/api";
import type { Track } from "../lib/types";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { toast, useUi } from "../store/ui";
import { Cover, Pill } from "../components/Common";
import { Cat, I } from "../components/Icons";

const DAYS = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return (
    <div className="clock-wrap">
      <span className="seg clock">{hh}:{mm}<span style={{ opacity: 0.4 }}>:{ss}</span></span>
      <span className="label" style={{ color: "var(--ink)" }}>Time</span>
    </div>
  );
}

let chartCache: Track[] | null = null;

const MOODS = ["Lo-fi для работы", "Synthwave", "Русский рэп новинки", "Джаз вечер", "Phonk", "Классика для концентрации", "Инди рок", "K-pop"];

export function Home() {
  const history = useLib((s) => s.history);
  const tracks = useLib((s) => s.tracks);
  const playlists = useLib((s) => s.playlists);
  const liked = useLib((s) => s.liked);
  const downloads = useLib((s) => s.downloads);
  const go = useUi((s) => s.go);
  const recent = history.map((id) => tracks[id]).filter(Boolean) as Track[];
  const now = new Date();
  const dayOfYear = Math.floor((+now - +new Date(now.getFullYear(), 0, 0)) / 864e5);
  const yearLen = (now.getFullYear() % 4 === 0 ? 366 : 365);
  const [mix, setMix] = useState<Track[] | null>(null);
  const [chart, setChart] = useState<Track[] | null>(chartCache);

  useEffect(() => {
    const seed = recent.find((t) => t.source === "ytmusic" && t.yt);
    if (!seed) {
      setMix(null);
      return;
    }
    api.radio(seed).then((l) => setMix(l.slice(0, 20))).catch(() => {});
  }, [history[0]]);

  useEffect(() => {
    if (chartCache) return;
    api.chart().then((c) => { chartCache = c; setChart(c); }).catch(() => {});
  }, []);

  return (
    <div className="page">
      <div className="hero">
        <div className="card shadow">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <div className="row" style={{ gap: 4 }}>
              {DAYS.map((d, i) => (
                <span key={d} className="label" style={{ padding: "3px 7px", borderRadius: 6, ...(i === now.getDay() ? { background: "var(--ink)", color: "var(--bg)" } : {}) }}>{d}</span>
              ))}
            </div>
            <div className="dots"><i /><i /><i /></div>
          </div>
          <Clock />
          <div className="rule" />
          <div className="label" style={{ marginBottom: 8 }}>До конца года {yearLen - dayOfYear} дн.</div>
          <Pill value={dayOfYear} max={yearLen} className="thin" />
          <div className="stat-grid">
            <div className="stat"><span className="label">Любимые</span><b>{liked.length}</b></div>
            <div className="stat"><span className="label">Плейлисты</span><b>{playlists.length}</b></div>
            <div className="stat"><span className="label">Офлайн</span><b>{Object.keys(downloads).length}</b></div>
          </div>
        </div>
        <div className="card inv" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="label">Концепт</span>
          <div className="h2" style={{ color: "var(--bg)" }}>Твоя музыка.<br />Бесплатно. Без рекламы.</div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>• свои файлы, плейлисты и офлайн<br />• перенос плейлистов с других площадок<br />• эквалайзер, скорость, визуализатор</div>
          <div className="spacer" />
          <div className="row wrap">
            <button className="btn accent sm" onClick={() => go({ name: "search" })}><I.search size={15} /> Найти</button>
            <button className="btn sm" style={{ background: "var(--bg)", color: "var(--ink)" }} onClick={() => useUi.getState().set({ importOpen: true })}><I.link size={15} /> Перенести</button>
            <button className="btn sm" style={{ background: "var(--bg)", color: "var(--ink)" }} onClick={async () => {
              const files = await pickFiles("audio/*,.mp3,.flac,.m4a,.ogg,.opus,.wav,.aac");
              for (const f of files) {
                try { useLib.getState().addLocal(await api.saveUserFile(f)); } catch (e) { toast(String(e), "err"); }
              }
              if (files.length) { toast(`Добавлено файлов: ${files.length}`, "ok"); go({ name: "local" }); }
            }}><I.file size={15} /> Файлы</button>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="section">
          <div className="section-head"><span className="h2">Недавно</span><span className="label">History</span></div>
          <div className="hscroll">
            {recent.slice(0, 20).map((t) => (
              <button key={t.id} className="mini-card" onClick={() => usePlayer.getState().playTrack(t, recent, { type: "history" })}>
                <Cover src={t.cover} />
                <div style={{ minWidth: 0, width: "100%" }}>
                  <div className="t-title ellipsis">{t.title}</div>
                  <div className="t-sub ellipsis">{t.artist}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {mix && mix.length > 0 && (
        <div className="section">
          <div className="section-head"><span className="h2">Миx для вас</span><button className="btn sm" onClick={() => usePlayer.getState().playTrack(mix[0], mix, { type: "radio" })}><I.play size={14} /> Слушать</button></div>
          <div className="hscroll">
            {mix.map((t) => (
              <button key={t.id} className="mini-card" onClick={() => usePlayer.getState().playTrack(t, mix, { type: "radio" })}>
                <Cover src={t.cover} />
                <div style={{ minWidth: 0, width: "100%" }}>
                  <div className="t-title ellipsis">{t.title}</div>
                  <div className="t-sub ellipsis">{t.artist}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {chart && chart.length > 0 && (
        <div className="section">
          <div className="section-head"><span className="h2">Чарт</span><button className="btn sm" onClick={() => usePlayer.getState().playTrack(chart[0], chart, { type: "search" })}><I.play size={14} /> Слушать</button></div>
          <div className="hscroll">
            {chart.slice(0, 24).map((t, i) => (
              <button key={t.id} className="mini-card" onClick={() => usePlayer.getState().playTrack(t, chart, { type: "search" })}>
                <Cover src={t.cover} />
                <div style={{ minWidth: 0, width: "100%" }}>
                  <div className="t-title ellipsis"><span className="seg" style={{ fontSize: 11, marginRight: 6, color: "var(--accent)" }}>{String(i + 1).padStart(2, "0")}</span>{t.title}</div>
                  <div className="t-sub ellipsis">{t.artist}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {playlists.length > 0 && (
        <div className="section">
          <div className="section-head"><span className="h2">Плейлисты</span><button className="btn ghost sm" onClick={() => go({ name: "library" })}>Все</button></div>
          <div className="hscroll">
            {playlists.slice(0, 12).map((p) => (
              <button key={p.id} className="mini-card" onClick={() => go({ name: "playlist", id: p.id })}>
                <Cover src={p.cover} />
                <div className="t-title ellipsis" style={{ width: "100%" }}>{p.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-head"><span className="h2">Настроение</span><span className="label">Moods</span></div>
        <div className="row wrap">
          {MOODS.map((m) => (
            <button key={m} className="chip" onClick={() => { useUi.getState().set({ searchQuery: m }); go({ name: "search" }); }}>{m}</button>
          ))}
        </div>
      </div>

      {recent.length === 0 && playlists.length === 0 && (
        <div className="empty">
          <Cat size={150} />
          <div className="h3" style={{ color: "var(--ink)" }}>Тут пока тихо</div>
          <div>Найдите трек или перенесите плейлист со Spotify, Яндекса, YouTube…</div>
        </div>
      )}
    </div>
  );
}
