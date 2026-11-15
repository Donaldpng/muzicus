import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, isMobile } from "../lib/api";
import { REPO } from "../lib/config";
import { checkForUpdate } from "../lib/updater";
import { ACCENTS, useSettings, type VisMode } from "../store/settings";
import { toast, useUi } from "../store/ui";
import { Range, Spinner, Switch } from "../components/Common";
import { I } from "../components/Icons";
import { EqPanel } from "../components/Panels";
import { Visualizer } from "../components/Visualizer";

const MODES: { id: VisMode; name: string }[] = [
  { id: "bars", name: "Полосы" },
  { id: "mirror", name: "Зеркало" },
  { id: "wave", name: "Осциллограф" },
  { id: "radial", name: "Круг" },
  { id: "grid", name: "HUD-сетка" },
  { id: "blocks", name: "LED-блоки" },
];

function SourcesCard() {
  const src = useSettings((s) => s.sources);
  const set = useSettings((s) => s.set);
  const up = (p: Partial<typeof src>) => set({ sources: { ...src, ...p } });
  const Row = ({ k, name, desc }: { k: "audius" | "archive"; name: string; desc: string }) => (
    <div className="set-row">
      <div>
        <div style={{ fontWeight: 600 }}>{name}</div>
        <div className="muted" style={{ fontSize: 12 }}>{desc}</div>
      </div>
      <Switch on={src[k]} onChange={(v) => up({ [k]: v })} />
    </div>
  );
  return (
    <div className="card shadow">
      <div className="card-head"><span className="label" style={{ color: "var(--ink)" }}>Источники музыки</span><div className="dots"><i /><i /><i /></div></div>
      <div style={{ padding: "6px 18px 14px" }}>
        <div className="muted" style={{ fontSize: 12, padding: "10px 0 4px" }}>
          Каталог и поиск — YouTube Music. Дополнительные полные версии ищутся на открытых площадках ниже.
        </div>
        <Row k="audius" name="Audius" desc="Открытая платформа артистов, ключ не нужен" />
        <Row k="archive" name="Internet Archive" desc="Общественное достояние, архивы, концерты" />
      </div>
    </div>
  );
}

export function SettingsView() {
  const s = useSettings();
  const vis = s.vis;
  const setVis = (p: Partial<typeof vis>) => s.set({ vis: { ...vis, ...p } });
  const [ver, setVer] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    getVersion().then(setVer);
  }, []);

  return (
    <div className="page">
      <div className="label" style={{ marginBottom: 6 }}>Settings</div>
      <h1 className="h1" style={{ marginBottom: 22 }}>Настройки</h1>
      <div className="settings-grid">
        <div className="card shadow">
          <div className="card-head"><span className="label" style={{ color: "var(--ink)" }}>Оформление</span><div className="dots"><i /><i /><i /></div></div>
          <div style={{ padding: "6px 18px 14px" }}>
            <div className="set-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <button className={`radio ${s.theme === "dark" ? "on" : ""}`} onClick={() => s.set({ theme: "dark" })}><i /> <I.moon size={16} /> Тёмная</button>
              <button className={`radio ${s.theme === "light" ? "on" : ""}`} onClick={() => s.set({ theme: "light" })}><i /> <I.sun size={16} /> Светлая</button>
            </div>
            <div className="set-row">
              <span style={{ fontWeight: 600 }}>Акцент</span>
              <div className="row" style={{ gap: 8 }}>
                {ACCENTS.map((c) => (
                  <button key={c} className={`swatch ${s.accent === c ? "on" : ""}`} style={{ background: c }} onClick={() => s.set({ accent: c })} />
                ))}
              </div>
            </div>
            <div className="set-row">
              <div>
                <div style={{ fontWeight: 600 }}>Автовоспроизведение</div>
                <div className="muted" style={{ fontSize: 12 }}>Похожие треки после конца очереди</div>
              </div>
              <Switch on={s.autoplay} onChange={(v) => s.set({ autoplay: v })} />
            </div>
          </div>
        </div>

        <SourcesCard />

        <div className="card shadow">
          <div className="card-head"><span className="label" style={{ color: "var(--ink)" }}>Визуализатор</span><div className="dots"><i /><i /><i /></div></div>
          <div style={{ height: 120, borderBottom: "var(--bw) solid var(--line)", padding: "12px 16px", position: "relative" }}>
            <Visualizer />
          </div>
          <div style={{ padding: "6px 18px 14px" }}>
            <div className="row wrap" style={{ gap: 6, padding: "12px 0" }}>
              {MODES.map((m) => (
                <button key={m.id} className={`chip ${vis.mode === m.id ? "on" : ""}`} onClick={() => setVis({ mode: m.id })}>{m.name}</button>
              ))}
            </div>
            <div className="set-row"><span style={{ fontWeight: 600 }}>Полос: {vis.bars}</span><div style={{ width: 160 }}><Range min={8} max={160} step={1} value={vis.bars} onChange={(v) => setVis({ bars: v })} /></div></div>
            <div className="set-row"><span style={{ fontWeight: 600 }}>Чувствительность</span><div style={{ width: 160 }}><Range min={0.4} max={2.5} step={0.05} value={vis.sensitivity} onChange={(v) => setVis({ sensitivity: v })} /></div></div>
            <div className="set-row"><span style={{ fontWeight: 600 }}>Плавность</span><div style={{ width: 160 }}><Range min={0} max={0.95} step={0.01} value={vis.smoothing} onChange={(v) => setVis({ smoothing: v })} /></div></div>
            <div className="set-row"><span style={{ fontWeight: 600 }}>Толщина линий</span><div style={{ width: 160 }}><Range min={1} max={6} step={0.5} value={vis.lineWidth} onChange={(v) => setVis({ lineWidth: v })} /></div></div>
            <div className="set-row">
              <span style={{ fontWeight: 600 }}>Цвет</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {(["accent", "ink", "gradient", "custom"] as const).map((c) => (
                  <button key={c} className={`chip ${vis.color === c ? "on" : ""}`} style={{ height: 26, fontSize: 11 }} onClick={() => setVis({ color: c })}>
                    {{ accent: "Акцент", ink: "Моно", gradient: "Градиент", custom: "Свой" }[c]}
                  </button>
                ))}
                {vis.color === "custom" && <input type="color" value={vis.customColor} onChange={(e) => setVis({ customColor: e.target.value })} style={{ width: 30, height: 26, border: 0, background: "none" }} />}
              </div>
            </div>
            <div className="set-row"><span style={{ fontWeight: 600 }}>Пики</span><Switch on={vis.peaks} onChange={(v) => setVis({ peaks: v })} /></div>
            <div className="set-row"><span style={{ fontWeight: 600 }}>Свечение</span><Switch on={vis.glow} onChange={(v) => setVis({ glow: v })} /></div>
          </div>
        </div>

        <div className="card shadow" style={{ minHeight: 520 }}>
          <div className="card-head"><span className="label" style={{ color: "var(--ink)" }}>Звук</span><div className="dots"><i /><i /><i /></div></div>
          <EqPanel />
        </div>

        <div className="card shadow">
          <div className="card-head"><span className="label" style={{ color: "var(--ink)" }}>Система</span><div className="dots"><i /><i /><i /></div></div>
          <div style={{ padding: "6px 18px 14px" }}>
            <div className="set-row">
              <div>
                <div style={{ fontWeight: 600 }}>Версия</div>
                <div className="seg" style={{ fontSize: 14, marginTop: 4 }}>{ver}</div>
              </div>
              <button className="btn sm" disabled={checking} onClick={async () => {
                setChecking(true);
                try {
                  const u = await checkForUpdate();
                  if (u) window.dispatchEvent(new CustomEvent("muz-update", { detail: u }));
                  else toast("Установлена последняя версия");
                } catch (e) {
                  toast("Не удалось проверить: " + e, "err");
                } finally {
                  setChecking(false);
                }
              }}>{checking ? <Spinner size={14} /> : <I.refresh size={14} />} Проверить обновления</button>
            </div>
            {!isMobile() && (
              <div className="set-row">
                <div style={{ fontWeight: 600 }}>Папка загрузок</div>
                <button className="btn sm" onClick={async () => revealItemInDir(await api.downloadsDir())}><I.folder size={14} /> Открыть</button>
              </div>
            )}
            <div className="set-row">
              <div style={{ fontWeight: 600 }}>Перенос плейлистов</div>
              <button className="btn sm" onClick={() => useUi.getState().set({ importOpen: true })}><I.link size={14} /> Импорт</button>
            </div>
            <div className="set-row">
              <div>
                <div style={{ fontWeight: 600 }}>Горячие клавиши</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.9 }}>
                  <span className="kbd">Space</span> пауза · <span className="kbd">←</span><span className="kbd">→</span> перемотка · <span className="kbd">Ctrl</span>+<span className="kbd">→</span> след. трек · <span className="kbd">L</span> лайк
                </div>
              </div>
            </div>
            {!REPO.startsWith("OWNER/") && (
              <div className="set-row">
                <div style={{ fontWeight: 600 }}>Исходный код</div>
                <button className="btn sm ghost" onClick={() => openUrl(`https://github.com/${REPO}`)}>GitHub</button>
              </div>
            )}
            <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
              MUZICUS — свободный плеер (GPL-3.0). Аудио берётся из открытого каталога YouTube Music, тексты — из LRCLIB.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
