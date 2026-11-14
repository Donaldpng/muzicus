import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../audio/engine";
import { api } from "../lib/api";
import type { LyricsResult, Track } from "../lib/types";
import { useLib } from "../store/library";
import { usePlayer } from "../store/player";
import { EQ_FREQS, EQ_PRESETS, useSettings } from "../store/settings";
import { Cover, Range, Spinner, Switch } from "./Common";
import { Cat, I } from "./Icons";

// ---------------------------------------------------------------- lyrics
const cache = new Map<string, LyricsResult | null>();

function parseLrc(s: string) {
  const out: { t: number; text: string }[] = [];
  for (const line of s.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of tags) out.push({ t: parseInt(m[1]) * 60 + parseFloat(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function Lyrics({ track }: { track?: Track }) {
  const [data, setData] = useState<LyricsResult | null | undefined>(undefined);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!track) return;
    const key = track.id;
    if (cache.has(key)) return setData(cache.get(key));
    setData(undefined);
    let alive = true;
    api
      .lyrics(track)
      .catch(() => null)
      .then((r) => {
        cache.set(key, r ?? null);
        if (alive) setData(r ?? null);
      });
    return () => {
      alive = false;
    };
  }, [track?.id, track?.yt]);

  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : null), [data]);

  useEffect(() => {
    if (!lines) return;
    let raf = 0;
    let last = -2;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = engine.audio.currentTime + 0.25;
      let i = -1;
      let lo = 0, hi = lines.length - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (lines[m].t <= t) { i = m; lo = m + 1; } else hi = m - 1;
      }
      if (i !== last) {
        last = i;
        setActive(i);
        const el = box.current?.children[Math.max(0, i)] as HTMLElement | undefined;
        if (el && box.current) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight * 0.38, behavior: "smooth" });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines]);

  if (!track) return null;
  if (data === undefined)
    return (
      <div className="empty" style={{ height: "100%" }}>
        <Spinner size={26} />
        <span className="label">Ищем текст…</span>
      </div>
    );
  if (!data)
    return (
      <div className="empty" style={{ height: "100%" }}>
        <Cat size={110} mood="sleep" />
        <span className="h3">Текст не найден</span>
        <span className="label">Возможно, это инструментал</span>
      </div>
    );
  if (lines)
    return (
      <div className="lyrics" ref={box}>
        {lines.map((l, i) => (
          <p key={i} className={i === active ? "on" : i < active ? "past" : ""} onClick={() => usePlayer.getState().seek(l.t)}>
            {l.text || "♪"}
          </p>
        ))}
      </div>
    );
  return (
    <div className="lyrics plain" style={{ paddingTop: 30 }}>
      {(data.plain ?? "").split(/\r?\n/).map((l, i) => (
        <p key={i}>{l || " "}</p>
      ))}
      <div className="label" style={{ marginTop: 20 }}>Источник: {data.source}</div>
    </div>
  );
}

// ---------------------------------------------------------------- equalizer + speed
export function EqPanel() {
  const eq = useSettings((s) => s.eq);
  const rate = useSettings((s) => s.rate);
  const pitch = useSettings((s) => s.preservePitch);
  const set = useSettings((s) => s.set);
  const setGain = (i: number, v: number) => {
    const gains = eq.gains.slice();
    gains[i] = v;
    set({ eq: { ...eq, gains, preset: "Свой", enabled: true } });
  };
  return (
    <div className="eq">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="label">Эквалайзер</div>
          <div className="h3" style={{ marginTop: 4 }}>{eq.enabled ? eq.preset : "Выключен"}</div>
        </div>
        <Switch on={eq.enabled} onChange={(v) => set({ eq: { ...eq, enabled: v } })} />
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {Object.keys(EQ_PRESETS).map((p) => (
          <button
            key={p}
            className={`chip ${eq.enabled && eq.preset === p ? "on" : ""}`}
            onClick={() => set({ eq: { ...eq, enabled: true, preset: p, gains: EQ_PRESETS[p].slice() } })}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="eq-bands" style={{ opacity: eq.enabled ? 1 : 0.45 }}>
        {EQ_FREQS.map((f, i) => (
          <div className="eq-band" key={f}>
            <b>{eq.gains[i] > 0 ? "+" : ""}{eq.gains[i]}</b>
            <input type="range" min={-12} max={12} step={1} value={eq.gains[i]} onChange={(e) => setGain(i, parseInt(e.target.value))} />
            <span>{f >= 1000 ? f / 1000 + "k" : f}</span>
          </div>
        ))}
      </div>
      <div className="col" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="label">Предусилитель</span>
          <span className="seg" style={{ fontSize: 12 }}>{eq.preamp > 0 ? "+" : ""}{eq.preamp}</span>
        </div>
        <Range min={-12} max={12} step={1} value={eq.preamp} onChange={(v) => set({ eq: { ...eq, preamp: v } })} />
      </div>
      <SpeedControl rate={rate} pitch={pitch} />
    </div>
  );
}

export function SpeedControl({ rate, pitch }: { rate: number; pitch: boolean }) {
  const set = useSettings((s) => s.set);
  return (
    <div className="card" style={{ padding: 16, borderRadius: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span className="label">Скорость</span>
        <span className="seg" style={{ fontSize: 16 }}>{rate.toFixed(2)}x</span>
      </div>
      <Range min={0.5} max={2} step={0.05} value={rate} onChange={(v) => set({ rate: Math.round(v * 100) / 100 })} />
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {[0.75, 0.85, 1, 1.15, 1.25, 1.5].map((r) => (
          <button key={r} className={`chip ${rate === r ? "on" : ""}`} style={{ height: 26, padding: "0 10px" }} onClick={() => set({ rate: r })}>
            {r}x
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Сохранять тональность</span>
        <Switch on={pitch} onChange={(v) => set({ preservePitch: v })} />
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Выключите для эффекта nightcore / slowed</div>
    </div>
  );
}

// ---------------------------------------------------------------- queue
export function QueuePanel() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const tracks = useLib((s) => s.tracks);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center" });
  }, []);
  const visible = queue.slice(0, 500);
  return (
    <div className="queue" ref={ref}>
      {visible.map((id, i) => {
        const t = tracks[id];
        if (!t) return <div key={i} />;
        return (
          <div key={id + i} className={`trow ${i === index ? "current" : ""}`} style={{ gridTemplateColumns: "34px 42px minmax(0,1fr) 40px" }} onDoubleClick={() => usePlayer.getState().jump(i)} onClick={() => window.matchMedia("(max-width: 860px)").matches && usePlayer.getState().jump(i)}>
            <div className="num" style={{ display: "block" }}>{i + 1}</div>
            <Cover src={t.cover} size={42} radius={9} />
            <div style={{ minWidth: 0 }}>
              <div className="t-title ellipsis">{t.title}</div>
              <div className="t-sub ellipsis">{t.artist}</div>
            </div>
            {i !== index ? (
              <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); usePlayer.getState().removeAt(i); }}>
                <I.close size={15} />
              </button>
            ) : <span />}
          </div>
        );
      })}
      {queue.length > 500 && <div className="label" style={{ padding: 14 }}>…ещё {queue.length - 500}</div>}
    </div>
  );
}
