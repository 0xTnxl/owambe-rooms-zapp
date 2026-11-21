import { audio, type AudioOut, env, filter, midi, noiseSrc, osc } from "./audio";

/**
 * The soundtrack, played live by a tiny band made of oscillators: kick, rim, shekere, agogo bell,
 * talking drum, bass, highlife guitar and an organ. Nothing to download, nothing to license.
 *
 * Cues follow the game: `lobby` (laid-back highlife), `party` (afrobeats groove), `countdown`
 * (the last 10 seconds, faster and fuller), `vote` (soft), `results` (fanfare, then highlife).
 */
export type Cue = "off" | "lobby" | "party" | "countdown" | "vote" | "results";

interface Song {
  bpm: number;
  /** One chord per bar: [root midi, minor?]. */
  chords: [number, boolean][];
  swing: number;
  level: number;
  play(b: Band, s: number, bar: number, t: number, chord: number[], root: number): void;
}

/** One hit per instrument, scheduled at audio time `t`. */
class Band {
  constructor(private a: AudioOut, private out: AudioNode) {}
  private get ctx() {
    return this.a.ctx!;
  }

  kick(t: number, v = 1) {
    const o = osc(this.ctx, "sine", 150, t, 0.4, env(this.ctx, this.out, t, 0.9 * v, 0.002, 0.32));
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  }

  rim(t: number, v = 1) {
    const g = env(this.ctx, this.out, t, 0.32 * v, 0.001, 0.09);
    noiseSrc(this.a, t, 0.12, filter(this.ctx, "bandpass", 1800, 1.4, g));
    osc(this.ctx, "triangle", 820, t, 0.05, env(this.ctx, this.out, t, 0.12 * v, 0.001, 0.04));
  }

  shaker(t: number, v = 1) {
    const g = env(this.ctx, this.out, t, 0.16 * v, 0.004, 0.045);
    noiseSrc(this.a, t, 0.08, filter(this.ctx, "highpass", 5200, 0.7, g));
  }

  /** Agogo: two FM bells, high and low. */
  bell(t: number, high: boolean, v = 1) {
    const f = high ? 1108 : 831;
    const car = osc(this.ctx, "sine", f, t, 0.3, env(this.ctx, this.out, t, 0.11 * v, 0.001, 0.22));
    const mod = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    mod.frequency.value = f * 2.76;
    depth.gain.setValueAtTime(f * 1.6, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 0.2);
    mod.connect(depth).connect(car.frequency);
    mod.start(t);
    mod.stop(t + 0.3);
  }

  /** Talking drum: a pitch that bends, the way the player squeezes the strings. */
  talk(t: number, p: number, bend: number, v = 1) {
    const g = env(this.ctx, this.out, t, 0.42 * v, 0.004, 0.26);
    const o = osc(this.ctx, "triangle", p, t, 0.32, g);
    o.frequency.exponentialRampToValueAtTime(p * bend, t + 0.14);
    const sub = osc(this.ctx, "sine", p / 2, t, 0.3, env(this.ctx, this.out, t, 0.2 * v, 0.004, 0.22));
    sub.frequency.exponentialRampToValueAtTime((p * bend) / 2, t + 0.14);
  }

  bass(t: number, note: number, dur: number, v = 1) {
    const g = env(this.ctx, this.out, t, 0.36 * v, 0.006, dur);
    const lp = filter(this.ctx, "lowpass", 900, 3, g);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + dur);
    osc(this.ctx, "sawtooth", midi(note), t, dur, lp);
    osc(this.ctx, "sine", midi(note), t, dur, env(this.ctx, this.out, t, 0.32 * v, 0.006, dur));
  }

  /** Highlife guitar: a bright, quick pluck. */
  pluck(t: number, note: number, v = 1) {
    const g = env(this.ctx, this.out, t, 0.12 * v, 0.002, 0.3);
    const lp = filter(this.ctx, "lowpass", 2800, 0.8, g);
    osc(this.ctx, "triangle", midi(note), t, 0.35, lp);
    osc(this.ctx, "triangle", midi(note) * 1.004, t, 0.35, lp);
    osc(this.ctx, "square", midi(note) * 2, t, 0.08, env(this.ctx, this.out, t, 0.018 * v, 0.001, 0.06));
  }

  /** Short organ chord on the offbeat. */
  stab(t: number, notes: number[], v = 1) {
    const g = env(this.ctx, this.out, t, 0.05 * v, 0.004, 0.14);
    const lp = filter(this.ctx, "lowpass", 1900, 0.7, g);
    for (const n of notes) osc(this.ctx, "square", midi(n), t, 0.18, lp);
  }

  pad(t: number, notes: number[], dur: number, v = 1) {
    for (const n of notes) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045 * v, t + dur * 0.35);
      g.gain.linearRampToValueAtTime(0, t + dur);
      g.connect(this.out);
      osc(this.ctx, "sine", midi(n), t, dur, g);
      osc(this.ctx, "triangle", midi(n + 12), t, dur, g).detune.value = 6;
    }
  }

  brass(t: number, notes: number[], dur: number, v = 1) {
    const g = env(this.ctx, this.out, t, 0.11 * v, 0.03, dur);
    const lp = filter(this.ctx, "lowpass", 500, 1.2, g);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(1100, t + dur);
    for (const n of notes) {
      osc(this.ctx, "sawtooth", midi(n), t, dur, lp).detune.value = -5;
      osc(this.ctx, "sawtooth", midi(n), t, dur, lp).detune.value = 5;
    }
  }
}

/** A triad on `root`, voiced between G3 and G4 so chord changes stay smooth. */
function triad(root: number, minor: boolean): number[] {
  return [0, minor ? 3 : 4, 7].map((i) => {
    let n = root + i;
    while (n < 55) n += 12;
    while (n > 67) n -= 12;
    return n;
  }).sort((a, b) => a - b);
}

const hit = (pattern: string, s: number) => pattern[s] === "x";

const PARTY: Song = {
  bpm: 108,
  swing: 0.1,
  level: 1,
  chords: [[52, true], [48, false], [55, false], [50, false]],
  play(b, s, bar, t, chord, root) {
    if (hit("x..x..x...x.....", s)) b.kick(t, s === 0 ? 1 : 0.8);
    if (hit("....x.......x...", s)) b.rim(t);
    b.shaker(t, s % 4 === 2 ? 1 : s % 2 ? 0.7 : 0.4);
    if (hit("x.x.xx.x.x.x.xx.", s)) b.bell(t, [0, 4, 7, 11, 14].includes(s), 0.9);
    if (hit("x..x..x...x.x...", s)) b.bass(t, root - 12 + (s === 10 ? 7 : s === 3 ? 12 : 0), 0.22);
    if (hit("..x...x...x...x.", s)) b.pluck(t, chord[(s >> 2) % 3]! + 12, 0.9);
    if (bar % 2 === 1 && hit("x..x..x.x..x..x.", s)) b.pluck(t, chord[(s * 5) % 3]! + 24, 0.55);
    if (bar % 4 === 3) {
      if (s === 8) b.talk(t, 210, 1.45);
      if (s === 10) b.talk(t, 260, 0.7);
      if (s === 11) b.talk(t, 200, 1.1, 0.8);
      if (s === 13) b.talk(t, 170, 1.6);
      if (s === 14) b.talk(t, 280, 0.6);
    } else if (s === 14 && bar % 2 === 0) b.talk(t, 190, 1.35, 0.7);
  },
};

const COUNTDOWN: Song = {
  ...PARTY,
  bpm: 124,
  swing: 0.04,
  play(b, s, bar, t, chord, root) {
    if (hit("x...x...x.x.x...", s)) b.kick(t);
    if (hit("....x.......x...", s)) b.rim(t, 1.2);
    b.shaker(t, s % 2 ? 1 : 0.6);
    if (hit("x.x.x.x.x.x.x.x.", s)) b.bell(t, s % 4 === 0, 1);
    if (s % 2 === 0) b.bass(t, root - 12 + (s % 8 === 6 ? 12 : 0), 0.14);
    if (s % 4 === 2) b.stab(t, chord, 1.2);
    if (s % 8 === 4) b.talk(t, 220 + bar * 10, 1.3, 0.9);
  },
};

const LOBBY: Song = {
  bpm: 100,
  swing: 0.12,
  level: 0.8,
  chords: [[55, false], [48, false], [55, false], [50, false]],
  play(b, s, _bar, t, chord, root) {
    if (hit("x.......x.......", s)) b.kick(t, 0.75);
    if (hit("....x.......x...", s)) b.rim(t, 0.6);
    if (s % 2 === 0) b.shaker(t, s % 4 ? 0.8 : 0.45);
    if (hit("x..x..x...x.x...", s)) b.bell(t, s < 8, 0.6);
    if (hit("x.....x.x...x...", s)) b.bass(t, root - 12 + (s === 6 ? 7 : s === 12 ? 4 : 0), 0.3);
    if (s % 2 === 0) b.pluck(t, chord[[0, 1, 2, 1][(s >> 1) % 4]!]! + 12, s % 4 ? 0.7 : 1);
  },
};

const VOTE: Song = {
  bpm: 92,
  swing: 0.1,
  level: 0.65,
  chords: [[52, true], [48, false]],
  play(b, s, _bar, t, chord, root) {
    if (s === 0) {
      b.pad(t, chord, (60 / 92) * 4);
      b.kick(t, 0.5);
      b.bass(t, root - 12, 0.6, 0.7);
    }
    if (s % 2 === 0) b.shaker(t, 0.35);
    if (hit("x.....x.....x...", s)) b.bell(t, s === 0, 0.45);
  },
};

const RESULTS: Song = {
  ...LOBBY,
  bpm: 104,
  level: 0.9,
  play(b, s, bar, t, chord, root) {
    if (bar === 0) {
      // Fanfare: G, then C, then a long G.
      if (s === 0) b.brass(t, [55, 59, 62, 67], 0.25);
      if (s === 3) b.brass(t, [55, 59, 62, 67], 0.2);
      if (s === 6) b.brass(t, [60, 64, 67], 0.3);
      if (s === 10) b.brass(t, [62, 66, 69], 0.2);
      if (s === 12) b.brass(t, [55, 59, 62, 67, 71], 0.7);
      if (s === 0 || s === 12) b.kick(t);
      return;
    }
    LOBBY.play(b, s, bar, t, chord, root);
  },
};

const SONGS: Record<Exclude<Cue, "off">, Song> = { lobby: LOBBY, party: PARTY, countdown: COUNTDOWN, vote: VOTE, results: RESULTS };

export class Music {
  private cue: Cue = "off";
  private song: Song | null = null;
  private bus: GainNode | null = null;
  private band: Band | null = null;
  private bpm = 108;
  /** Next 16th to schedule and when (audio time). */
  private step = 0;
  private next = 0;
  private bar = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Beat clock: beats = anchorBeat + (time - anchorTime) * bpm / 60. */
  private anchorBeat = 0;
  private anchorTime = performance.now() / 1000;
  private usingAudioClock = false;

  constructor(private a: AudioOut) {
    a.onReady(() => {
      // Switch the beat clock to audio time without a jump.
      const b = this.beat();
      this.usingAudioClock = true;
      this.anchorBeat = b;
      this.anchorTime = a.now;
      this.start();
    });
  }

  private time(): number {
    return this.usingAudioClock && this.a.ctx ? this.a.ctx.currentTime : performance.now() / 1000;
  }

  /** Beats since the party started; guests dance on it, with or without sound. */
  beat(): number {
    return this.anchorBeat + ((this.time() - this.anchorTime) * this.bpm) / 60;
  }

  play(cue: Cue): void {
    if (cue === this.cue) return;
    this.cue = cue;
    const song = cue === "off" ? null : SONGS[cue];
    this.song = song;
    if (song && song.bpm !== this.bpm) {
      this.anchorBeat = this.beat();
      this.anchorTime = this.time();
      this.bpm = song.bpm;
    }
    this.bar = 0;
    // Start the new cue on the next bar line, so it lands on the beat.
    this.step = 0;
    if (this.a.ctx) {
      const b = this.beat();
      const toBar = (Math.ceil(b / 4 + 1e-6) * 4 - b) * (60 / this.bpm);
      this.next = this.a.ctx.currentTime + Math.min(toBar, 0.6);
    }
    if (this.bus && this.a.ctx) this.bus.gain.setTargetAtTime(song ? song.level : 0, this.a.ctx.currentTime, 0.1);
    this.start();
  }

  private start(): void {
    const ctx = this.a.ctx;
    if (!ctx || !this.song || this.timer) return;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.connect(this.a.music);
      this.band = new Band(this.a, this.bus);
    }
    this.bus.gain.value = this.song.level;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    const ctx = this.a.ctx;
    const song = this.song;
    if (!ctx || !song) {
      clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    const sixteenth = 60 / this.bpm / 4;
    while (this.next < ctx.currentTime + 0.12) {
      const s = this.step % 16;
      const [root, minor] = song.chords[this.bar % song.chords.length]!;
      const t = this.next + (s % 2 ? song.swing * sixteenth : 0);
      if (!document.hidden) song.play(this.band!, s, this.bar, t, triad(root, minor), root);
      this.next += sixteenth;
      this.step += 1;
      if (this.step % 16 === 0) this.bar += 1;
    }
  }

  stop(): void {
    this.play("off");
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export const music = new Music(audio);
