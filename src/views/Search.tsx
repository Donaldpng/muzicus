import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePlayer } from "../store/player";
import type { Track } from "../lib/types";
import { useUi } from "../store/ui";
import { Spinner } from "../components/Common";
import { Cat, I } from "../components/Icons";
import { TrackList } from "../components/TrackList";

const cache = new Map<string, Track[]>();

export function Search() {
  const initial = useUi((s) => s.searchQuery);
  const [q, setQ] = useState(initial);
  const [kind, setKind] = useState<"tracks" | "open" | "sc">("tracks");
  const [noKeys, setNoKeys] = useState(false);
  const [scBusy, setScBusy] = useState(false);
  const [results, setResults] = useState<Track[] | null>(initial ? cache.get("tracks:" + initial) ?? null : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sugg, setSugg] = useState<string[]>([]);
  const [sel, setSel] = useState(-1);
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const isUrl = /^https?:\/\//i.test(q.trim());
  const isScUrl = /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(q.trim());

  /** Play a SoundCloud link in the official embedded player (no API key needed). */
  const playScLink = async (url = q) => {
    setScBusy(true);
    setErr("");
    try {
      const t = await api.scOembed(url.trim());
      usePlayer.getState().playTrack(t, [t], { type: "single" });
    } catch (e) {
      setErr(String(e));
    } finally {
      setScBusy(false);
    }
  };

  const run = async (query = q, k = kind) => {
    query = query.trim();
    if (!query || /^https?:\/\//i.test(query)) return;
    useUi.getState().set({ searchQuery: query });
    setSugg([]);
    setFocus(false);
    input.current?.blur();
    const key = k + ":" + query;
    if (cache.has(key)) return setResults(cache.get(key)!);
    const my = ++seq.current;
    setBusy(true);
    setErr("");
    setNoKeys(false);
    try {
      const r = k === "open" ? await api.openSearch(query) : k === "sc" ? await api.scSearch(query) : await api.search(query);
      cache.set(key, r);
      if (my === seq.current) setResults(r);
    } catch (e) {
      if (my !== seq.current) return;
      if (String(e) === "NO_KEYS") {
        setNoKeys(true);
        setResults(null);
      } else setErr(String(e));
    } finally {
      if (my === seq.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (initial && !results) run(initial);
    else input.current?.focus();
  }, []);

  useEffect(() => {
    if (!focus || !q.trim() || isUrl) return setSugg([]);
    const t = setTimeout(() => api.suggest(q).then(setSugg).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [q, focus]);

  return (
    <div className="page">
      <div className="label" style={{ marginBottom: 6 }}>Search / Deezer + open sources</div>
      <h1 className="h1" style={{ marginBottom: 18 }}>Поиск</h1>
      <div className="search-box">
        <I.search className="lead" size={22} />
        <input
          ref={input}
          className="input"
          placeholder="Трек, исполнитель, альбом или ссылка на плейлист"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(-1); }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(sugg.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(-1, s - 1)); }
            else if (e.key === "Enter") {
              if (isScUrl) return void playScLink();
              if (isUrl) return useUi.getState().set({ importOpen: true });
              const v = sel >= 0 ? sugg[sel] : q;
              setQ(v);
              run(v);
            }
          }}
        />
        {focus && sugg.length > 0 && (
          <div className="card suggest">
            {sugg.map((s, i) => (
              <button key={s} className={i === sel ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); setQ(s); run(s); }}>{s}</button>
            ))}
          </div>
        )}
      </div>
      {isScUrl ? (
        <div className="card" style={{ padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <I.play size={18} />
          <span className="grow">Ссылка SoundCloud — послушать в официальном плеере SoundCloud?</span>
          <button className="btn accent sm" disabled={scBusy} onClick={() => playScLink()}>{scBusy ? <Spinner size={14} /> : <I.play size={14} />} Слушать</button>
        </div>
      ) : isUrl && (
        <div className="card" style={{ padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <I.link size={18} />
          <span className="grow">Похоже на ссылку. Импортировать как плейлист?</span>
          <button className="btn primary sm" onClick={() => useUi.getState().set({ importOpen: true })}>Импорт</button>
        </div>
      )}
      <div className="row wrap" style={{ margin: "16px 0 10px" }}>
        <button className={`chip ${kind === "tracks" ? "on" : ""}`} onClick={() => { setKind("tracks"); run(q, "tracks"); }}>Каталог</button>
        <button className={`chip ${kind === "open" ? "on" : ""}`} onClick={() => { setKind("open"); run(q, "open"); }}>Открытые источники</button>
        <button className={`chip ${kind === "sc" ? "on" : ""}`} onClick={() => { setKind("sc"); run(q, "sc"); }}>SoundCloud</button>
        <span className="spacer" />
        {busy && <Spinner />}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        {kind === "open"
          ? "Audius, Internet Archive, Jamendo, SoundCloud — бесплатные треки целиком, можно слушать и скачивать"
          : kind === "sc"
            ? "Треки, которые авторы открыли для свободного прослушивания (официальный API SoundCloud)"
            : "Каталог Deezer. Полная версия ищется в открытых источниках при воспроизведении; если её нет — играет 30-секундное превью"}
      </div>
      {err && <div style={{ color: "var(--danger)", fontWeight: 600 }}>{err}</div>}
      {kind === "sc" && noKeys && (
        <div className="card shadow" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, maxWidth: 680 }}>
          <div className="label">SoundCloud</div>
          <div className="h3">Поиск SoundCloud работает только через их официальный API</div>
          <div className="muted" style={{ fontSize: 13 }}>
            SoundCloud выдаёт доступ к поиску только зарегистрированным приложениям. Зарегистрируйте приложение
            на soundcloud.com/you/apps и вставьте Client ID и Secret в настройках — поиск и полноценное
            воспроизведение (с эквалайзером и скачиванием, если автор разрешил) заработают здесь.
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Без ключей можно вставить в строку поиска <b>ссылку на трек или плейлист</b> SoundCloud — он сыграет в их официальном плеере.
          </div>
          <div className="row wrap">
            <button className="btn primary sm" onClick={() => useUi.getState().go({ name: "settings" })}><I.settings size={14} /> Открыть настройки</button>
            <button className="btn sm" onClick={() => openUrl("https://soundcloud.com/you/apps")}><I.link size={14} /> soundcloud.com/you/apps</button>
          </div>
        </div>
      )}
      {results && results.length > 0 && <TrackList tracks={results} ctx={{ type: "search" }} />}
      {results && results.length === 0 && !busy && (
        <div className="empty"><Cat size={120} mood="sleep" /><div>Ничего не найдено. Попробуйте другую вкладку.</div></div>
      )}
      {!results && !busy && !noKeys && (
        <div className="empty"><Cat size={130} /><div className="label">Введите запрос</div></div>
      )}
    </div>
  );
}
