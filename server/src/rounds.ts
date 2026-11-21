import { randomInt } from "node:crypto";
import {
  act, botNames, createRound, encodeLook, type GameEvent, leave, mulberry32, parseAction, publicView, randomLook, type Rng,
  type Round, type SeatInit, setPresent, stepBots, tick, vote,
} from "@owambe/engine";
import type { ServerConfig } from "./config";
import type { Log } from "./store";
import type { Player } from "./token";
import type { RoomIO, ZendPort } from "./zend";

export interface Seated extends Player {
  sid: string;
}

interface Deps {
  cfg: ServerConfig;
  zend: ZendPort;
  log: Log;
  now: () => number;
}

/** Zend allows 20 frames a second per connection; stay under it. */
const SEND_PER_SEC = 18;
const ERRORS_PER_SEC = 10;
/** Player actions over this are dropped (R6.4). */
const ACTIONS_PER_SEC = 8;
const FLUSH_MS = 200;
const SNAP_MS = 5_000;
/** Zend's frame limit is 8 KB; keep a margin. */
const MAX_FRAME = 7_600;

/** What a page asks for over the room, besides game actions. */
type PageNote = { t: "added"; to: string };

/** One live round: the engine, its bots, and its Zend room. The only source of truth. */
export class RoundRunner {
  readonly humans: Map<string, Seated>;
  doneAt: number | null = null;
  private io: RoomIO | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: GameEvent[] = [];
  private added: [string, string][] = [];
  private newAdds: [string, string][] = [];
  private dirty = false;
  private v = 0;
  private lastFlush = 0;
  private lastSnap = 0;
  private snapDue = true;
  private sent: number[] = [];
  private errs: number[] = [];
  private acts = new Map<string, number[]>();
  private zendQueue: Promise<void> = Promise.resolve();
  private botRng: Rng;

  constructor(private d: Deps, readonly round: Round, humans: Seated[], readonly meta: { kind: string; code: string | null }) {
    this.humans = new Map(humans.map((h) => [h.id, h]));
    this.botRng = mulberry32(round.seed + 1);
  }

  get id() {
    return this.round.id;
  }

  begin(): void {
    this.io = this.d.zend.openRoom(this.id, {
      message: (from, data) => this.onMessage(from, data),
      presence: (ids) => this.onPresence(ids),
      closed: (reason) => {
        this.io = null;
        if (this.round.phase !== "done") this.d.log("room_closed", { round: this.id, reason, phase: this.round.phase });
      },
    });
    this.timer = setInterval(() => this.step(), 100);
    // The HTTP server keeps the process alive; a round's timer alone shouldn't.
    this.timer.unref?.();
  }

  /** One tick: time, bots, frames. Public for tests. */
  step(): void {
    const now = this.d.now();
    const ev = [...stepBots(this.round, this.botRng, now), ...tick(this.round, now, this.botRng)];
    const phaseChanged = this.take(ev);
    if ((this.pending.length || this.newAdds.length || this.dirty) && (phaseChanged || now - this.lastFlush >= FLUSH_MS)) {
      this.flush(now);
    }
    if (phaseChanged || now - this.lastSnap >= SNAP_MS || (this.snapDue && now - this.lastSnap >= 500)) this.snapshot(now);
    if (this.round.phase === "done" && this.doneAt === null) this.finish(now);
  }

  view(now = this.d.now()) {
    return publicView(this.round, now, { labelBots: this.d.cfg.labelBots });
  }

  addsFor() {
    return this.added;
  }

  vote(player: string, forId: string) {
    const r = vote(this.round, player, forId);
    if (r.ok) this.dirty = true;
    return r;
  }

  leave(player: string): void {
    this.take(leave(this.round, player, this.d.now()));
  }

  /** A friend add between two people in this round (page hint or Zend webhook). */
  recordAdd(from: string, to: string): void {
    if (!this.humans.has(from) || !this.humans.has(to) || from === to) return;
    if (this.added.some(([a, b]) => a === from && b === to)) return;
    this.added.push([from, to]);
    this.newAdds.push([from, to]);
  }

  private take(ev: GameEvent[]): boolean {
    let phaseChanged = false;
    for (const e of ev) {
      this.pending.push(e);
      if (e.k === "phase") {
        phaseChanged = true;
        this.onPhase(e.phase);
      }
    }
    return phaseChanged;
  }

  private onPhase(phase: string): void {
    // Zend's interaction mirrors the round; "ready" and "playing" are both Zend's "playing".
    if (phase === "voting" || phase === "results") this.zendState(phase);
  }

  private zendState(state: string): void {
    this.zendQueue = this.zendQueue
      .then(() => this.d.zend.setState(this.id, state))
      .catch((e) => this.d.log("zend_state_failed", { round: this.id, state, error: String((e as Error).message ?? e) }));
  }

  private finish(now: number): void {
    this.doneAt = now;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.snapshot(now);
    // Zend closes the room when the interaction reaches "done".
    this.zendState("done");
    const r = this.round.results;
    this.d.log("round_finished", {
      round: this.id, kind: this.meta.kind, humans: [...this.humans.keys()],
      loser: r?.loserId ?? null, funniest: r?.funniestIds ?? [], generous: r?.generousId ?? null,
      burned: r?.burned ?? 0, adds: this.added.length,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.io?.close();
  }

  private onMessage(from: string, data: unknown): void {
    if (from === "app" || !this.humans.has(from)) return;
    const now = this.d.now();
    const recent = (this.acts.get(from) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= ACTIONS_PER_SEC) return;
    recent.push(now);
    this.acts.set(from, recent);
    // A message means they're here, whatever presence said last.
    this.take(setPresent(this.round, from, true, now));

    const note = data as Partial<PageNote> | null;
    if (note && note.t === "added" && typeof note.to === "string") {
      this.recordAdd(from, note.to);
      return;
    }
    const a = parseAction(data);
    if (!a) return;
    const res = act(this.round, from, a, now);
    if (res.ok) this.take(res.events);
    else this.error(from, res.code, now);
  }

  private onPresence(ids: string[]): void {
    const now = this.d.now();
    const here = new Set(ids);
    for (const id of this.humans.keys()) this.take(setPresent(this.round, id, here.has(id), now));
    this.snapDue = true;
  }

  private canSend(now: number): boolean {
    this.sent = this.sent.filter((t) => now - t < 1000);
    return this.sent.length < SEND_PER_SEC;
  }

  private send(data: unknown, now: number): void {
    if (!this.io || !this.canSend(now)) return;
    if (this.io.send(data)) this.sent.push(now);
  }

  private error(to: string, code: string, now: number): void {
    this.errs = this.errs.filter((t) => now - t < 1000);
    if (this.errs.length >= ERRORS_PER_SEC) return;
    this.errs.push(now);
    this.send({ t: "err", to, code }, now);
  }

  private flush(now: number): void {
    const v = this.view(now);
    this.send({
      t: "ev", v: ++this.v, now, ev: this.pending, added: this.newAdds,
      phase: v.phase, lead: v.lead, loserId: v.loserId, auction: v.auction, auctionsLeft: v.auctionsLeft, voted: v.voted,
      seats: v.seats.map((s) => ({ id: s.id, bag: s.bag, given: s.given, away: s.away, streakTo: s.streakTo, streakN: s.streakN, sprayRun: s.sprayRun })),
    }, now);
    this.pending = [];
    this.newAdds = [];
    this.dirty = false;
    this.lastFlush = now;
  }

  /** The full state, for joins, reconnects and phase changes. Fits Zend's 8 KB frame. */
  snapshotFrame(now: number) {
    const round = this.view(now);
    let frame = { t: "snap", v: this.v + 1, now, round, added: this.added };
    if (JSON.stringify(frame).length > MAX_FRAME) {
      frame = { ...frame, round: { ...round, seats: round.seats.map((s) => ({ ...s, avatar: null, gave: {} })) } };
    }
    return frame;
  }

  private snapshot(now: number): void {
    const frame = this.snapshotFrame(now);
    this.v = frame.v;
    this.send(frame, now);
    this.lastSnap = now;
    this.snapDue = false;
  }
}

/** Every live and recently finished round on this server. */
export class Rounds {
  private runners = new Map<string, RoundRunner>();
  private live = new Map<string, string>();

  constructor(private d: Deps) {}

  get(id: string): RoundRunner | undefined {
    return this.runners.get(id);
  }

  liveFor(player: string): RoundRunner | undefined {
    const id = this.live.get(player);
    const r = id ? this.runners.get(id) : undefined;
    return r && r.doneAt === null ? r : undefined;
  }

  /** Creates the Zend interaction, seats bots, and starts the round. */
  async start(p: { kind: string; code: string | null; humans: Seated[] }): Promise<string> {
    const { cfg, zend, log } = this.d;
    const [first, ...others] = p.humans;
    if (!first) throw new Error("no humans");
    const id = await zend.createRound({
      createdBy: first.id, participants: others.map((h) => h.id), data: { kind: p.kind, code: p.code },
      expiresInSecs: 1800,
    });
    const seed = randomInt(2 ** 31);
    const rng = mulberry32(seed);
    const botCount = Math.max(0, cfg.roomSize - p.humans.length);
    const names = botNames(rng, botCount, p.humans.map((h) => h.name));
    const seats: SeatInit[] = [
      ...p.humans.map((h) => ({ id: h.id, name: h.name, avatar: h.avatar })),
      ...names.map((name, i) => ({ id: `bot_${i}`, name, avatar: null, bot: true, look: encodeLook(randomLook(rng)) })),
    ];
    // Mix bots in so seat order doesn't give them away.
    seats.sort(() => rng() - 0.5);
    const round: Round = createRound(id, cfg.game, seats, this.d.now(), seed);
    const runner = new RoundRunner(this.d, round, p.humans, { kind: p.kind, code: p.code });
    for (const h of p.humans) {
      this.liveFor(h.id)?.leave(h.id);
      this.live.set(h.id, id);
    }
    this.runners.set(id, runner);
    runner.begin();
    log("round_started", { round: id, kind: p.kind, code: p.code, humans: p.humans.map((h) => h.id), bots: botCount });
    for (const h of p.humans) log("round_joined", { round: id, player: h.id, sid: h.sid });
    return id;
  }

  leave(player: string): void {
    this.liveFor(player)?.leave(player);
  }

  /** Forgets rounds finished more than 30 minutes ago. */
  sweep(now: number): void {
    for (const [id, r] of this.runners) {
      if (r.doneAt !== null && now - r.doneAt > 30 * 60_000) {
        r.stop();
        this.runners.delete(id);
        for (const [p, rid] of this.live) if (rid === id) this.live.delete(p);
      }
    }
  }

  stopAll(): void {
    for (const r of this.runners.values()) r.stop();
  }
}
