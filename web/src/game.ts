import {
  act, botNames, createRound, DEFAULT_CONFIG, formatPlay, type GameEvent, ITEMS, type ItemId, mulberry32,
  publicView, type PublicRound, type Round, setPresent, stepBots, tick, vote,
} from "@owambe/engine";
import { api, type Me, type RoundInfo } from "./api";
import { first } from "./h";
import { joinRoom, type RoomLink } from "./room";

export interface FeedLine {
  at: number;
  text: string;
}

export interface GameState {
  round: PublicRound | null;
  /** Server clock minus ours. */
  offset: number;
  feed: FeedLine[];
  /** Reactions floating over seats: seat → [reaction, when]. */
  floats: Map<string, [string, number]>;
  error: string | null;
  added: [string, string][];
  humans: string[];
  code: string | null;
  connection: "connected" | "reconnecting" | "disconnected";
}

export interface Game {
  readonly me: Me;
  readonly practice: boolean;
  readonly roundId: string;
  readonly state: GameState;
  subscribe(fn: () => void): () => void;
  now(): number;
  gift(to: string, item: ItemId): void;
  bid(amount: number): void;
  react(r: string): void;
  vote(forId: string): Promise<boolean>;
  /** A friend add went through: tell the room so the other person sees "added you". */
  added(to: string): void;
  /** Stops listening (leaving the screen). The player stays in the round. */
  close(): void;
  /** The player taps Leave: out of the round (they can still lose). */
  leave(): void;
}

const ERRORS: Record<string, string> = {
  CAP_REACHED: "That's 5 in a row to them. Gift someone else first.",
  NOT_ENOUGH: "Your bag can't cover that.",
  AWAY: "They stepped out.",
  TOO_LOW: "Someone bid more. Go higher.",
  ALREADY_TOP: "You're already the top bid.",
  NO_AUCTION: "That auction just closed.",
  SLOW_DOWN: "Easy! One reaction a second.",
  NOT_PLAYING: "Not now.",
};
export const errorCopy = (code: string) => ERRORS[code] ?? "That didn't go through. Try again.";

function describe(e: GameEvent, name: (id: string) => string, me: string): string | null {
  const who = (id: string) => (id === me ? "You" : first(name(id)));
  switch (e.k) {
    case "gift": {
      const item = ITEMS.find((i) => i.id === e.item)!;
      return `${who(e.from)} → ${who(e.to)} ${item.emoji} ${formatPlay(e.amount)}`;
    }
    case "auction":
      return e.state === "open"
        ? `🔨 Auction: ${e.lot}`
        : e.winner ? `🔨 ${who(e.winner)} won it for ${formatPlay(e.amount)}. Gone from the game!` : "🔨 Nobody bid.";
    case "bid":
      return `🔨 ${who(e.seat)} bid ${formatPlay(e.amount)}`;
    case "away":
      return e.away ? `${who(e.seat)} stepped out` : `${who(e.seat)} is back`;
    default:
      return null;
  }
}

class Base {
  readonly state: GameState = {
    round: null, offset: 0, feed: [], floats: new Map(), error: null, added: [], humans: [], code: null, connection: "connected",
  };
  private subs = new Set<() => void>();
  private errTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly me: Me) {}

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  protected emit(): void {
    for (const fn of this.subs) fn();
  }

  now(): number {
    return Date.now() + this.state.offset;
  }

  protected showError(code: string): void {
    this.state.error = errorCopy(code);
    clearTimeout(this.errTimer);
    this.errTimer = setTimeout(() => {
      this.state.error = null;
      this.emit();
    }, 2200);
  }

  protected events(ev: GameEvent[]): void {
    const r = this.state.round;
    const name = (id: string) => r?.seats.find((s) => s.id === id)?.name ?? "Someone";
    const now = this.now();
    for (const e of ev) {
      if (e.k === "react") this.state.floats.set(e.seat, [e.r, now]);
      const text = describe(e, name, this.me.id);
      if (text) this.state.feed.unshift({ at: now, text });
    }
    this.state.feed.length = Math.min(this.state.feed.length, 4);
  }
}

/** A real round: state from the game server through the Zend room; votes over HTTP. */
export class OnlineGame extends Base implements Game {
  readonly practice = false;
  private room: RoomLink | null = null;
  private v = -1;
  private sent: number[] = [];
  private poll: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(me: Me, readonly roundId: string) {
    super(me);
  }

  async start(): Promise<void> {
    await this.refresh();
    try {
      this.room = await joinRoom(this.roundId, {
        message: (from, data) => this.onMessage(from, data),
        closed: () => this.onClosed(),
        status: (s) => {
          this.state.connection = s;
          this.emit();
        },
      });
    } catch {
      // The room is gone (round over) or Zend is too old for rooms: follow along by polling.
      this.onClosed();
    }
  }

  private async refresh(): Promise<void> {
    try {
      const info = await api<RoundInfo>("GET", `/api/round/${encodeURIComponent(this.roundId)}`);
      this.state.humans = info.humans;
      this.state.code = info.code;
      this.state.added = info.added;
      // While the room is up, it is the source of state; otherwise (closed, or no room) this is.
      if (!this.room || !this.state.round) this.applyRound(info.round);
      this.emit();
    } catch {
      // Keep what we have.
    }
  }

  private applyRound(round: PublicRound): void {
    this.state.round = round;
    this.state.offset = round.now - Date.now();
  }

  private onMessage(from: string, data: unknown): void {
    // Only the game server speaks for the game (Zend sets `from`; pages can't fake "app").
    if (from !== "app" || !data || typeof data !== "object") return;
    const f = data as Record<string, unknown>;
    if (typeof f.v === "number" && f.v < this.v) return;
    if (typeof f.v === "number") this.v = f.v;
    if (f.t === "snap") {
      this.applyRound(f.round as PublicRound);
      this.state.added = (f.added as [string, string][]) ?? this.state.added;
    } else if (f.t === "ev" && this.state.round) {
      const r = this.state.round;
      r.phase = f.phase as PublicRound["phase"];
      r.lead = f.lead as string | null;
      r.loserId = (f.loserId as string | null) ?? r.loserId;
      r.auction = f.auction as PublicRound["auction"];
      r.auctionsLeft = f.auctionsLeft as number;
      r.voted = f.voted as string[];
      for (const s of (f.seats as { id: string }[]) ?? []) {
        const seat = r.seats.find((x) => x.id === s.id);
        if (seat) Object.assign(seat, s);
      }
      this.state.offset = (f.now as number) - Date.now();
      this.events((f.ev as GameEvent[]) ?? []);
      for (const a of (f.added as [string, string][]) ?? []) {
        if (!this.state.added.some(([x, y]) => x === a[0] && y === a[1])) this.state.added.push(a);
      }
    } else if (f.t === "err" && f.to === this.me.id && typeof f.code === "string") {
      this.showError(f.code);
    } else {
      return;
    }
    this.emit();
  }

  private onClosed(): void {
    this.room = null;
    if (this.stopped || this.poll) return;
    // Results and friend adds keep coming in for a while after the room closes.
    let n = 0;
    this.poll = setInterval(() => {
      if (this.stopped || ++n > 40) return clearInterval(this.poll);
      void this.refresh();
    }, 4000);
    void this.refresh();
  }

  private send(data: unknown): void {
    const now = Date.now();
    this.sent = this.sent.filter((t) => now - t < 1000);
    // The server drops more than 8 a second; don't waste them.
    if (this.sent.length >= 8) return this.showError("SLOW_DOWN");
    this.sent.push(now);
    this.room?.send(data);
  }

  gift(to: string, item: ItemId) {
    this.send({ t: "gift", to, item });
  }
  bid(amount: number) {
    this.send({ t: "bid", amount });
  }
  react(r: string) {
    this.send({ t: "react", r });
  }
  added(to: string) {
    if (!this.state.added.some(([a, b]) => a === this.me.id && b === to)) this.state.added.push([this.me.id, to]);
    this.room?.send({ t: "added", to });
    this.emit();
  }

  async vote(forId: string): Promise<boolean> {
    try {
      await api("POST", "/api/vote", { round: this.roundId, for: forId });
      return true;
    } catch {
      this.showError("VOTE");
      return false;
    }
  }

  close() {
    this.stopped = true;
    clearInterval(this.poll);
    this.room?.leave();
    this.room = null;
  }

  leave() {
    this.close();
    void api("POST", "/api/leave").catch(() => {});
  }
}

/** Practice with bots: the same engine, run in the page. Nothing leaves the phone. */
export class PracticeGame extends Base implements Game {
  readonly practice = true;
  readonly roundId = "practice";
  private round: Round;
  private timer: ReturnType<typeof setInterval>;
  private rng = mulberry32((Math.random() * 2 ** 31) | 0);

  constructor(me: Me) {
    super(me);
    const seed = (Math.random() * 2 ** 31) | 0;
    const names = botNames(this.rng, 5, [me.name]);
    const seats = [{ id: me.id, name: me.name, avatar: me.avatar }, ...names.map((n, i) => ({ id: `bot_${i}`, name: n, avatar: null, bot: true }))];
    seats.sort(() => this.rng() - 0.5);
    this.round = createRound("practice", { ...DEFAULT_CONFIG, readyMs: 3_000, playMs: 90_000, voteMs: 15_000, resultsMs: 600_000 }, seats, Date.now(), seed);
    setPresent(this.round, me.id, true, Date.now());
    this.state.humans = [me.id];
    this.sync();
    this.timer = setInterval(() => {
      const now = Date.now();
      this.take([...stepBots(this.round, this.rng, now), ...tick(this.round, now, this.rng)]);
    }, 100);
  }

  private sync(): void {
    this.state.round = publicView(this.round, Date.now());
  }

  private take(ev: GameEvent[]): void {
    this.sync();
    this.events(ev);
    this.emit();
  }

  private run(a: Parameters<typeof act>[2]): void {
    const r = act(this.round, this.me.id, a, Date.now());
    if (r.ok) this.take(r.events);
    else {
      this.showError(r.code);
      this.emit();
    }
  }

  gift(to: string, item: ItemId) {
    this.run({ t: "gift", to, item });
  }
  bid(amount: number) {
    this.run({ t: "bid", amount });
  }
  react(r: string) {
    this.run({ t: "react", r });
  }
  added() {}

  async vote(forId: string) {
    const ok = vote(this.round, this.me.id, forId).ok;
    this.take([]);
    return ok;
  }

  close() {
    clearInterval(this.timer);
  }

  leave() {
    this.close();
  }
}
