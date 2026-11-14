import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { img } from "../lib/api";
import { I } from "./Icons";

export const Cover = memo(function Cover({
  src,
  size,
  className = "",
  radius,
  outline,
}: {
  src?: string;
  size?: number;
  className?: string;
  radius?: number;
  outline?: boolean;
}) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  const url = img(src);
  return (
    <div
      className={`cover ${outline ? "outline" : ""} ${className}`}
      style={size ? { width: size, height: size, borderRadius: radius } : radius ? { borderRadius: radius } : undefined}
    >
      {url && !err ? (
        <img src={url} loading="lazy" decoding="async" draggable={false} onError={() => setErr(true)} alt="" />
      ) : (
        <I.music size={size ? Math.max(14, size * 0.36) : 22} />
      )}
    </div>
  );
});

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} />;
}

export function Range({
  value,
  min,
  max,
  step,
  onChange,
  style,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  style?: React.CSSProperties;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="range"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--p" as any]: p + "%", ...style }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  );
}

/** Outlined capsule progress bar with drag-to-seek. */
export function Pill({
  value,
  max,
  buffered,
  onSeek,
  className = "",
}: {
  value: number;
  max: number;
  buffered?: number;
  onSeek?: (v: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pct = (v: number) => (max > 0 ? Math.min(100, (v / max) * 100) : 0);
  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * max;
  };
  const shown = drag ?? value;
  return (
    <div
      ref={ref}
      className={`pill ${className}`}
      onPointerDown={(e) => {
        if (!onSeek) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        setDrag(fromEvent(e));
      }}
      onPointerMove={(e) => drag != null && setDrag(fromEvent(e))}
      onPointerUp={(e) => {
        if (drag != null) {
          onSeek?.(fromEvent(e));
          setDrag(null);
        }
      }}
    >
      {buffered != null && <div className="buf" style={{ width: pct(buffered) + "%" }} />}
      <div className="fill" style={{ width: pct(shown) + "%" }} />
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal">
        <div className="card-head">
          <span className="label" style={{ color: "var(--ink)" }}>{title}</span>
          <button className="icon-btn sm" onClick={onClose}>
            <I.close size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Keep a floating element inside the viewport. */
export function useFit(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);
  return { ref, pos };
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <I.loader size={size} className="spin" />;
}
