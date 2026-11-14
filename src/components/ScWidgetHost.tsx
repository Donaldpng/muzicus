import { useState } from "react";
import { useScw } from "../audio/scwidget";
import { I } from "./Icons";

/** Visible container for SoundCloud's official embedded player. */
export function ScWidgetHost() {
  const active = useScw((s) => s.active);
  const [min, setMin] = useState(false);
  return (
    <div className={`card scw-card ${active ? "on" : ""} ${min ? "min" : ""}`} aria-hidden={!active}>
      <div className="scw-head">
        <span className="label" style={{ color: "var(--ink)" }}>SoundCloud · официальный плеер</span>
        <button className="icon-btn sm" onClick={() => setMin(!min)} title={min ? "Развернуть" : "Свернуть"}>
          {min ? <I.up size={15} /> : <I.down size={15} />}
        </button>
      </div>
      <div id="scw-host" className="scw-frame" />
      {!min && <div className="scw-note">Эквалайзер, скорость и визуализатор для этого трека недоступны</div>}
    </div>
  );
}
