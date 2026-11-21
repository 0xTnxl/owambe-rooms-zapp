/**
 * Sound for the party: one AudioContext, a music bus and an effects bus into a soft limiter.
 * Browsers only allow sound after a tap, so nothing plays until `unlock()` runs inside one.
 */
const MUTE_KEY = "owambe.muted";

export class AudioOut {
  ctx: AudioContext | null = null;
  music!: GainNode;
  sfx!: GainNode;
  private master!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  muted = localStorage.getItem(MUTE_KEY) === "1";
  private listeners = new Set<() => void>();

  /** Call from a tap. Safe to call again; resumes a suspended context. */
  unlock(): void {
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      const ctx = new C({ latencyHint: "interactive" });
      this.ctx = ctx;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 8;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      limiter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(limiter);
      this.music = ctx.createGain();
      this.music.gain.value = 0.55;
      this.music.connect(this.master);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.8;
      this.sfx.connect(this.master);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) void ctx.suspend();
        else void ctx.resume();
      });
      for (const fn of this.listeners) fn();
    }
    if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
  }

  /** Runs `fn` once there is a context (now, or after the first tap). */
  onReady(fn: () => void): () => void {
    if (this.ctx) fn();
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** One second of white noise, shared by shakers, claps and rustles. */
  noise(): AudioBuffer {
    if (!this.noiseBuf) {
      const ctx = this.ctx!;
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  }

  /** Lowers the music for a moment (the MC talking), then brings it back. */
  duck(level: number, secs: number): void {
    if (!this.ctx) return;
    const g = this.music.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.55 * level, t, 0.08);
    g.setTargetAtTime(0.55, t + secs, 0.4);
  }
}

export const audio = new AudioOut();

export const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** A gain node with a quick attack and an exponential fall, already connected to `out`. */
export function env(ctx: AudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

export function osc(ctx: AudioContext, type: OscillatorType, freq: number, t: number, dur: number, out: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

export function noiseSrc(a: AudioOut, t: number, dur: number, out: AudioNode): AudioBufferSourceNode {
  const ctx = a.ctx!;
  const s = ctx.createBufferSource();
  s.buffer = a.noise();
  s.loop = true;
  s.connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
  return s;
}

export function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number, out: AudioNode): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(out);
  return f;
}
