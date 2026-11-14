import { useEffect, useRef } from "react";
import { engine } from "../audio/engine";
import { useSettings, type VisSettings } from "../store/settings";

function readColors(vis: VisSettings) {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue("--accent").trim() || "#ff8f6b";
  const ink = cs.getPropertyValue("--ink").trim() || "#f1ebe0";
  const soft = cs.getPropertyValue("--soft").trim();
  const main = vis.color === "ink" ? ink : vis.color === "custom" ? vis.customColor : accent;
  return { main, accent, ink, soft, gradient: vis.color === "gradient" };
}

/** Log-spaced band magnitudes 0..1 */
function bands(freq: Uint8Array, n: number, sampleRate: number, sens: number, out: Float32Array) {
  const nyq = sampleRate / 2;
  const bins = freq.length;
  const fMin = 35, fMax = Math.min(16000, nyq);
  for (let i = 0; i < n; i++) {
    const f0 = fMin * Math.pow(fMax / fMin, i / n);
    const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / n);
    let b0 = Math.floor((f0 / nyq) * bins);
    let b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * bins));
    let sum = 0, peak = 0;
    for (let b = b0; b < b1 && b < bins; b++) {
      sum += freq[b];
      if (freq[b] > peak) peak = freq[b];
    }
    const avg = sum / (b1 - b0);
    let v = ((avg + peak) / 2 / 255) * sens;
    v *= 0.75 + (i / n) * 0.55; // tilt: highs are naturally quieter
    out[i] = Math.min(1, Math.pow(v, 1.6));
  }
}

export function Visualizer({ compact = false, mode: forced }: { compact?: boolean; mode?: VisSettings["mode"] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d", { alpha: true })!;
    let raf = 0;
    let vis = useSettings.getState().vis;
    let colors = readColors(vis);
    let peaks = new Float32Array(256);
    let vals = new Float32Array(256);
    let freq = new Uint8Array(2048);
    let wave = new Uint8Array(2048);
    let t = 0;
    let gridPhase = 0;

    const unsub = useSettings.subscribe((s) => {
      vis = s.vis;
      colors = readColors(vis);
    });
    const mo = new MutationObserver(() => (colors = readColors(vis)));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const fillFor = (x0: number, x1: number, h: number) => {
      if (!colors.gradient) return colors.main;
      const gr = g.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, colors.accent);
      gr.addColorStop(1, colors.ink);
      void x0; void x1;
      return gr;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const W = cv.width, H = cv.height;
      const an = engine.analyser;
      const mode = forced ?? vis.mode;
      const n = compact ? Math.min(96, Math.max(24, Math.round(W / 14))) : Math.max(8, Math.min(160, vis.bars));
      const playing = !engine.audio.paused;
      if (an) {
        if (freq.length !== an.frequencyBinCount) {
          freq = new Uint8Array(an.frequencyBinCount);
          wave = new Uint8Array(an.fftSize);
        }
        an.getByteFrequencyData(freq);
        an.getByteTimeDomainData(wave);
        bands(freq, n, engine.ctx!.sampleRate, vis.sensitivity, vals);
      } else {
        for (let i = 0; i < n; i++) vals[i] *= 0.9;
        wave.fill(128);
      }
      if (!playing) for (let i = 0; i < n; i++) vals[i] *= 0.92;
      t += 1;
      g.clearRect(0, 0, W, H);
      const dpr = W / cv.clientWidth || 1;
      g.shadowBlur = vis.glow && !compact ? 14 * dpr : 0;
      g.shadowColor = colors.main;
      g.lineCap = "round";
      g.lineJoin = "round";

      if (mode === "bars" || mode === "mirror" || compact) {
        const mirror = mode === "mirror" && !compact;
        const gap = Math.max(1, (W / n) * 0.28);
        const bw = W / n - gap;
        g.fillStyle = fillFor(0, W, H);
        for (let i = 0; i < n; i++) {
          const v = vals[i];
          const h = Math.max(2 * dpr, v * H * (mirror ? 0.48 : compact ? 1 : 0.86));
          const x = i * (bw + gap) + gap / 2;
          const r = Math.min(bw / 2, 6 * dpr);
          if (mirror) {
            roundRect(g, x, H / 2 - h, bw, h * 2, r);
          } else {
            roundRect(g, x, H - h, bw, h, r);
          }
          if (vis.peaks && !compact) {
            peaks[i] = Math.max(peaks[i] - 0.008, v);
            const ph = peaks[i] * H * (mirror ? 0.48 : 0.86);
            g.fillRect(x, mirror ? H / 2 - ph - 5 * dpr : H - ph - 6 * dpr, bw, 2.5 * dpr);
            if (mirror) g.fillRect(x, H / 2 + ph + 3 * dpr, bw, 2.5 * dpr);
          }
        }
      } else if (mode === "wave") {
        g.strokeStyle = colors.main;
        g.lineWidth = vis.lineWidth * dpr;
        g.beginPath();
        const step = Math.max(1, Math.floor(wave.length / W));
        for (let x = 0, k = 0; k < wave.length; k += step, x++) {
          const y = ((wave[k] - 128) / 128) * (H / 2) * Math.min(2.4, vis.sensitivity * 1.3) + H / 2;
          const px = (k / wave.length) * W;
          if (k === 0) g.moveTo(px, y);
          else g.lineTo(px, y);
          void x;
        }
        g.stroke();
        // ghost line for depth
        g.globalAlpha = 0.25;
        g.lineWidth = 1 * dpr;
        g.beginPath();
        g.moveTo(0, H / 2);
        g.lineTo(W, H / 2);
        g.stroke();
        g.globalAlpha = 1;
      } else if (mode === "radial") {
        const cx = W / 2, cy = H / 2;
        const R = Math.min(W, H) * 0.22;
        let bass = 0;
        for (let i = 0; i < Math.min(6, n); i++) bass += vals[i];
        bass /= 6;
        const rr = R * (1 + bass * 0.18);
        g.strokeStyle = colors.main;
        g.lineWidth = Math.max(1.5, vis.lineWidth) * dpr;
        g.beginPath();
        g.arc(cx, cy, rr, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = Math.max(2, (Math.PI * 2 * rr) / n * 0.5);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2 + t * 0.002;
          const len = 4 * dpr + vals[i] * Math.min(W, H) * 0.26;
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * (rr + 6 * dpr), cy + Math.sin(a) * (rr + 6 * dpr));
          g.lineTo(cx + Math.cos(a) * (rr + 6 * dpr + len), cy + Math.sin(a) * (rr + 6 * dpr + len));
          g.stroke();
        }
        g.globalAlpha = 0.35;
        g.lineWidth = 1 * dpr;
        g.beginPath();
        g.arc(cx, cy, rr * 0.62, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else if (mode === "grid") {
        // retro HUD landscape: perspective grid + reactive horizon + sun
        g.shadowBlur = 0;
        const hy = H * 0.48;
        let bass = 0;
        for (let i = 0; i < Math.min(8, n); i++) bass += vals[i];
        bass /= 8;
        gridPhase = (gridPhase + 0.004 + bass * 0.02) % 1;
        g.strokeStyle = colors.ink;
        g.globalAlpha = 0.55;
        g.lineWidth = 1 * dpr;
        const cols = 22;
        for (let i = -cols; i <= cols; i++) {
          g.beginPath();
          g.moveTo(W / 2 + i * (W / cols) * 0.06, hy);
          g.lineTo(W / 2 + i * (W / cols) * 1.6, H);
          g.stroke();
        }
        for (let j = 0; j < 14; j++) {
          const z = (j + gridPhase) / 14;
          const y = hy + (H - hy) * z * z;
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(W, y);
          g.stroke();
        }
        g.globalAlpha = 1;
        // sun
        const sr = Math.min(W, H) * (0.07 + bass * 0.05);
        g.strokeStyle = colors.main;
        g.lineWidth = 2 * dpr;
        g.beginPath();
        g.arc(W / 2, hy - sr - 10 * dpr, sr, 0, Math.PI * 2);
        g.stroke();
        // mountains from spectrum
        g.strokeStyle = colors.main;
        g.lineWidth = vis.lineWidth * dpr;
        g.shadowBlur = vis.glow ? 12 * dpr : 0;
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const k = i <= n / 2 ? n / 2 - i : i - n / 2; // symmetric: bass in the middle
          const v = vals[Math.min(n - 1, Math.floor(k * 2))] ?? 0;
          const x = (i / n) * W;
          const y = hy - v * H * 0.4;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      } else if (mode === "blocks") {
        g.shadowBlur = 0;
        const rows = 16;
        const gap = 3 * dpr;
        const bw = W / n - gap;
        const bh = H / rows - gap;
        for (let i = 0; i < n; i++) {
          const lit = Math.round(vals[i] * rows);
          for (let r = 0; r < rows; r++) {
            const on = r < lit;
            g.fillStyle = on ? (r > rows * 0.8 ? colors.ink : colors.main) : colors.soft;
            if (!on && r > 0) continue;
            g.fillRect(i * (bw + gap) + gap / 2, H - (r + 1) * (bh + gap), bw, bh);
          }
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      unsub();
    };
  }, [compact, forced]);

  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}
