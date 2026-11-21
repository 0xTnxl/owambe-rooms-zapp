import { audio, env, filter, midi, noiseSrc, osc } from "./audio";

/** Sound effects, all synthesised. Each call is fire-and-forget and silent before the first tap. */
function ready(): AudioContext | null {
  const ctx = audio.ctx;
  return ctx && ctx.state === "running" && !audio.muted ? ctx : null;
}

function panned(ctx: AudioContext, pan: number): AudioNode {
  if (!ctx.createStereoPanner) return audio.sfx;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(audio.sfx);
  return p;
}

/** A flick of notes: a paper rustle that rises with the combo. */
export function spray(combo: number, pan = 0, v = 1): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const out = panned(ctx, pan);
  const g = env(ctx, out, t, 0.5 * v, 0.004, 0.16);
  const bp = filter(ctx, "bandpass", 1800, 1.1, g);
  bp.frequency.setValueAtTime(1800, t);
  bp.frequency.exponentialRampToValueAtTime(6500, t + 0.16);
  noiseSrc(audio, t, 0.2, bp);
  const up = Math.min(combo, 12);
  const o = osc(ctx, "sine", 420 + up * 40, t, 0.12, env(ctx, out, t, 0.12 * v, 0.003, 0.1));
  o.frequency.exponentialRampToValueAtTime(900 + up * 80, t + 0.1);
}

/** Notes landing on someone: a soft paper patter. */
export function patter(pan = 0, v = 1): void {
  const ctx = ready();
  if (!ctx) return;
  const out = panned(ctx, pan);
  for (let i = 0; i < 4; i++) {
    const t = ctx.currentTime + 0.05 + i * 0.045 + Math.random() * 0.02;
    noiseSrc(audio, t, 0.04, filter(ctx, "bandpass", 3000 + Math.random() * 2000, 2, env(ctx, out, t, 0.12 * v, 0.002, 0.03)));
  }
}

export function cash(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  noiseSrc(audio, t, 0.03, filter(ctx, "highpass", 4000, 0.7, env(ctx, audio.sfx, t, 0.25, 0.001, 0.03)));
  osc(ctx, "sine", 1318.5, t + 0.04, 0.6, env(ctx, audio.sfx, t + 0.04, 0.22, 0.002, 0.55));
  osc(ctx, "sine", 2637, t + 0.04, 0.4, env(ctx, audio.sfx, t + 0.04, 0.08, 0.002, 0.35));
  osc(ctx, "sine", 1760, t + 0.12, 0.6, env(ctx, audio.sfx, t + 0.12, 0.18, 0.002, 0.55));
}

/** The DJ's airhorn: baaa, ba-ba, baaaa. */
export function airhorn(): void {
  const ctx = ready();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const hits: [number, number][] = [[0, 0.32], [0.38, 0.1], [0.52, 0.1], [0.66, 0.5]];
  for (const [at, dur] of hits) {
    const t = t0 + at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
    g.gain.setValueAtTime(0.16, t + dur - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bp = filter(ctx, "bandpass", 1300, 0.6, g);
    g.connect(audio.sfx);
    for (const f of [466, 470, 699]) {
      const o = osc(ctx, "sawtooth", f, t, dur, bp);
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.97, t + dur);
    }
  }
}

export function mic(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = osc(ctx, "sine", 90, t, 0.3, env(ctx, audio.sfx, t, 0.45, 0.003, 0.25));
  o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
  noiseSrc(audio, t, 0.1, filter(ctx, "lowpass", 600, 0.7, env(ctx, audio.sfx, t, 0.2, 0.002, 0.08)));
}

/** The crowd goes "ayyy": filtered noise shaped like voices. */
export function cheer(size = 1): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const dur = 1.1 + size * 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22 * size, t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(audio.sfx);
  for (const f of [520, 900, 1400, 2400]) {
    const bp = filter(ctx, "bandpass", f, 5, g);
    const lfo = osc(ctx, "sine", 3 + Math.random() * 4, t, dur, ctx.createGain());
    const depth = ctx.createGain();
    depth.gain.value = f * 0.12;
    lfo.disconnect();
    lfo.connect(depth).connect(bp.frequency);
    noiseSrc(audio, t, dur, bp);
  }
}

export function gavel(): void {
  const ctx = ready();
  if (!ctx) return;
  for (const at of [0, 0.16]) {
    const t = ctx.currentTime + at;
    osc(ctx, "sine", 940, t, 0.1, env(ctx, audio.sfx, t, 0.35, 0.001, 0.07));
    osc(ctx, "sine", 1420, t, 0.06, env(ctx, audio.sfx, t, 0.15, 0.001, 0.04));
  }
}

/** A wooden tick for the last ten seconds. */
export function tick(urgent: boolean): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, "sine", urgent ? 1320 : 990, t, 0.06, env(ctx, audio.sfx, t, 0.18, 0.001, 0.05));
}

/** Danfo horn: pa-pam. */
export function honk(pan = 0): void {
  const ctx = ready();
  if (!ctx) return;
  const out = panned(ctx, pan);
  for (const at of [0, 0.22]) {
    const t = ctx.currentTime + at;
    const lp = filter(ctx, "lowpass", 1400, 1, env(ctx, out, t, 0.14, 0.01, 0.16));
    osc(ctx, "square", 392, t, 0.18, lp);
    osc(ctx, "square", 494, t, 0.18, lp);
  }
}

/** A long whoosh that crosses the stereo field (the jet). */
export function flyby(secs: number): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + secs * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  let out: AudioNode = audio.sfx;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(-1, t);
    p.pan.linearRampToValueAtTime(1, t + secs);
    p.connect(audio.sfx);
    out = p;
  }
  g.connect(out);
  const lp = filter(ctx, "lowpass", 300, 1.5, g);
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(2200, t + secs * 0.45);
  lp.frequency.exponentialRampToValueAtTime(400, t + secs);
  noiseSrc(audio, t, secs, lp);
}

export function thud(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = osc(ctx, "sine", 110, t, 0.5, env(ctx, audio.sfx, t, 0.7, 0.002, 0.45));
  o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
  noiseSrc(audio, t, 0.3, filter(ctx, "lowpass", 500, 0.7, env(ctx, audio.sfx, t, 0.35, 0.002, 0.25)));
}

export function pop(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = osc(ctx, "sine", 600, t, 0.12, env(ctx, audio.sfx, t, 0.25, 0.001, 0.09));
  o.frequency.exponentialRampToValueAtTime(1400, t + 0.06);
}

export function sparkle(): void {
  const ctx = ready();
  if (!ctx) return;
  [88, 92, 95, 100].forEach((n, i) => {
    const t = ctx.currentTime + i * 0.05;
    osc(ctx, "sine", midi(n), t, 0.3, env(ctx, audio.sfx, t, 0.07, 0.002, 0.25));
  });
}

/** Sad trombone for the loser: wah, wah, wah, waaah. */
export function trombone(): void {
  const ctx = ready();
  if (!ctx) return;
  const notes: [number, number][] = [[62, 0.4], [61, 0.4], [60, 0.4], [59, 1.2]];
  let at = ctx.currentTime + 0.05;
  for (const [n, dur] of notes) {
    const g = env(ctx, audio.sfx, at, 0.16, 0.04, dur);
    const lp = filter(ctx, "lowpass", 700, 4, g);
    const wah = osc(ctx, "sine", dur > 1 ? 6 : 0, at, dur, ctx.createGain());
    wah.disconnect();
    const d = ctx.createGain();
    d.gain.value = 350;
    wah.connect(d).connect(lp.frequency);
    const o = osc(ctx, "sawtooth", midi(n - 12), at, dur, lp);
    if (dur > 1) o.frequency.linearRampToValueAtTime(midi(n - 12) * 0.94, at + dur);
    at += dur + 0.05;
  }
}

export function tap(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, "sine", 720, t, 0.05, env(ctx, audio.sfx, t, 0.08, 0.001, 0.04));
}

/** Rises over `secs`: the countdown building. */
export function riser(secs: number): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + secs);
  g.gain.exponentialRampToValueAtTime(0.0001, t + secs + 0.2);
  g.connect(audio.sfx);
  const bp = filter(ctx, "bandpass", 400, 2, g);
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(7000, t + secs);
  noiseSrc(audio, t, secs + 0.2, bp);
}
