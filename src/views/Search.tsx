import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Track } from "../lib/types";
import { useUi } from "../store/ui";
import { Spinner } from "../components/Common";
import { Cat, I } from "../components/Icons";
import { TrackList } from "../components/TrackList";

const cache = new Map<string, Track[]>();

export function Search() {
  const initial = useUi((s) => s.searchQuery);
  const [q, setQ] = useState(initial);
  const [kind, setKind] = useState<"tracks" | "open">("tracks");
  const [results, setResults] = useState<Track[] | null>(initial ? cache.get("tracks:" + initial) ?? null : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sugg, setSugg] = useState<string[]>([]);
  const [sel, setSel] = useState(-1);
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const isUrl = /^https?:\/\//i.test(q.trim());

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
    try {
      const r = k === "open" ? await api.openSearch(query) : await api.search(query);
      cache.set(key, r);
      if (my === seq.current) setResults(r);
    } catch (e) {
      if (my === seq.current) setErr(String(e));
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
      {isUrl && (
        <div className="card" style={{ padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <I.link size={18} />
          <span className="grow">Похоже на ссылку. Импортировать как плейлист?</span>
          <button className="btn primary sm" onClick={() => useUi.getState().set({ importOpen: true })}>Импорт</button>
        </div>
      )}
      <div className="row" style={{ margin: "16px 0 10px" }}>
        <button className={`chip ${kind === "tracks" ? "on" : ""}`} onClick={() => { setKind("tracks"); run(q, "tracks"); }}>Каталог</button>
        <button className={`chip ${kind === "open" ? "on" : ""}`} onClick={() => { setKind("open"); run(q, "open"); }}>Открытые источники</button>
        <span className="spacer" />
        {busy && <Spinner />}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        {kind === "open" ? "Audius, Internet Archive, Jamendo, SoundCloud — бесплатные треки целиком, можно слушать и скачивать" : "Каталог Deezer. Полная версия ищется в открытых источниках при воспроизведении; если её нет — играет 30-секундное превью"}
      </div>
      {err && <div style={{ color: "var(--danger)", fontWeight: 600 }}>{err}</div>}
      {results && results.length > 0 && <TrackList tracks={results} ctx={{ type: "search" }} />}
      {results && results.length === 0 && !busy && (
        <div className="empty"><Cat size={120} mood="sleep" /><div>Ничего не найдено. Попробуйте другую вкладку.</div></div>
      )}
      {!results && !busy && (
        <div className="empty"><Cat size={130} /><div className="label">Введите запрос</div></div>
      )}
    </div>
  );
}
