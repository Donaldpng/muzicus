import { EQ_FREQS, useSettings } from "../store/settings";

/**
 * Single audio element + Web Audio graph:
 *
 *   element (volume fixed at 1) → preamp → 10-band EQ → limiter → analyser → master volume → out
 *
 * Volume is the very last stage, so it only makes the finished sound quieter: the EQ curve,
 * the limiter and the visualizer behave exactly the same at any volume. The EQ gets full
 * headroom (preamp lowered by the largest boost) and the limiter catches the remaining peaks
 * where neighbouring boosted bands add up — so a heavy bass boost never clips and sounds
 * the same loud or quiet.
 */
class Engine {
  audio: HTMLAudioElement;
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private preamp: GainNode | null = null;
  private master: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    const s = useSettings.getState();
    // until the Web Audio graph exists the element volume is the only control we have
    this.audio.volume = s.volume;
    this.audio.playbackRate = s.rate;
    this.audio.preservesPitch = s.preservePitch;
    useSettings.subscribe((s, p) => {
      if (s.volume !== p.volume) this.applyVolume();
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
      // transparent safety limiter: only acts on peaks above -1 dBFS
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = useSettings.getState().vis.smoothing;
      this.master = ctx.createGain();

      let node: AudioNode = src;
      node.connect(this.preamp);
      node = this.preamp;
      for (const f of this.filters) {
        node.connect(f);
        node = f;
      }
      node.connect(limiter);
      limiter.connect(this.analyser);
      this.analyser.connect(this.master);
      this.master.connect(ctx.destination);
      this.ctx = ctx;
      this.applyEq();
      this.applyVolume();
    } catch (e) {
      console.error("audio graph failed", e);
    }
  }

  applyVolume() {
    const v = useSettings.getState().volume;
    if (!this.ctx || !this.master) {
      this.audio.volume = v;
      return;
    }
    this.audio.volume = 1;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  applyEq() {
    if (!this.ctx || !this.preamp) return;
    const { eq } = useSettings.getState();
    const t = this.ctx.currentTime;
    const on = eq.enabled;
    // full headroom: lower the input by the largest boost so the curve never clips
    const maxBoost = on ? Math.max(0, ...eq.gains) : 0;
    const pre = on ? eq.preamp - maxBoost : 0;
    this.preamp.gain.setTargetAtTime(Math.pow(10, pre / 20), t, 0.02);
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(on ? eq.gains[i] ?? 0 : 0, t, 0.02));
  }
}

export const engine = new Engine();
