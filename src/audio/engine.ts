import { EQ_FREQS, useSettings } from "../store/settings";

/** Single audio element + Web Audio graph (preamp → 10-band EQ → analyser → out). */
class Engine {
  audio: HTMLAudioElement;
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private preamp: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    const s = useSettings.getState();
    this.audio.volume = s.volume;
    this.audio.playbackRate = s.rate;
    this.audio.preservesPitch = s.preservePitch;
    useSettings.subscribe((s, p) => {
      if (s.volume !== p.volume) this.audio.volume = s.volume;
      if (s.rate !== p.rate) {
        this.audio.playbackRate = s.rate;
        this.audio.defaultPlaybackRate = s.rate;
      }
      if (s.preservePitch !== p.preservePitch) this.audio.preservesPitch = s.preservePitch;
      if (s.eq !== p.eq) this.applyEq();
      if (s.vis.smoothing !== p.vis.smoothing && this.analyser) this.analyser.smoothingTimeConstant = s.vis.smoothing;
    });
  }

  /** Build the graph lazily (needs a user gesture). */
  ensureGraph() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext({ latencyHint: "playback" });
      const src = ctx.createMediaElementSource(this.audio);
      this.preamp = ctx.createGain();
      this.filters = EQ_FREQS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
        b.frequency.value = f;
        b.Q.value = 1.1;
        b.gain.value = 0;
        return b;
      });
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = useSettings.getState().vis.smoothing;
      let node: AudioNode = src;
      node.connect(this.preamp);
      node = this.preamp;
      for (const f of this.filters) {
        node.connect(f);
        node = f;
      }
      node.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.ctx = ctx;
      this.applyEq();
    } catch (e) {
      console.error("audio graph failed", e);
    }
  }

  applyEq() {
    if (!this.ctx || !this.preamp) return;
    const { eq } = useSettings.getState();
    const t = this.ctx.currentTime;
    const on = eq.enabled;
    // preamp in dB → linear; auto-headroom to avoid clipping on boosts
    const maxBoost = on ? Math.max(0, ...eq.gains) : 0;
    const pre = on ? eq.preamp - maxBoost * 0.5 : 0;
    this.preamp.gain.setTargetAtTime(Math.pow(10, pre / 20), t, 0.02);
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(on ? eq.gains[i] ?? 0 : 0, t, 0.02));
  }
}

export const engine = new Engine();
