import { AUCTION_LOTS, type Config, type ItemId, itemById, REACTIONS } from "./config";
import { mulberry32, pick, type Rng } from "./rng";

export type Phase = "ready" | "playing" | "voting" | "results" | "done";
export type BotStyle = "eager" | "sneaky" | "chaotic";

export interface SeatInit {
  id: string;
  name: string;
  avatar: string | null;
  bot?: boolean;
  /** Outfit code (see `look.ts`). Cosmetic only; never affects the rules. */
  look?: string | null;
}

export interface Seat {
  id: string;
  name: string;
  avatar: string | null;
  bot: boolean;
  style: BotStyle | null;
  bag: number;
  given: number;
  received: number;
  burned: number;
  /** Order of the last time this seat received play money (0 = never). Breaks ties. */
  recvSeq: number;
  look: string | null;
  /** Who this seat last gifted or sprayed. */
  streakTo: string | null;
  /** Item gifts in a row to `streakTo`. */
  streakN: number;
  /** Play money sprayed in a row on `streakTo`. */
  sprayRun: number;
  present: boolean;
  away: boolean;
  absentSince: number | null;
  left: boolean;
  lastReactAt: number;
  nextBotAt: number;
  /** Play money this seat gave to each other seat, for "you gave them 3B" notes. */
  gave: Record<string, number>;
}

export interface Auction {
  idx: number;
  lot: string;
  opensAt: number;
  closesAt: number;
  state: "pending" | "open" | "closed";
  high: { seat: string; amount: number } | null;
}

export interface Results {
  loserId: string;
  loserBag: number;
  generousId: string | null;
  generousGiven: number;
  funniestIds: string[];
  votes: Record<string, number>;
  standings: { id: string; bag: number; given: number; burned: number }[];
  burned: number;
}

export interface Round {
  id: string;
  cfg: Config;
  seed: number;
  phase: Phase;
  createdAt: number;
  playStart: number;
  playEnd: number;
  voteEnd: number;
  resultsEnd: number;
  seats: Seat[];
  auctions: Auction[];
  /** voter → who they voted funniest. */
  votes: Record<string, string>;
  recvCounter: number;
  loserId: string | null;
  results: Results | null;
}

export type Action =
  | { t: "gift"; to: string; item: ItemId }
  | { t: "spray"; to: string }
  | { t: "bid"; amount: number }
  | { t: "react"; r: string };

export type GameEvent =
  | { k: "phase"; phase: Phase }
  | { k: "gift"; from: string; to: string; item: ItemId; amount: number }
  | { k: "spray"; from: string; to: string; amount: number }
  | { k: "auction"; idx: number; state: "open" | "closed"; lot: string; closesAt: number; winner: string | null; amount: number }
  | { k: "bid"; idx: number; seat: string; amount: number }
  | { k: "react"; seat: string; r: string }
  | { k: "away"; seat: string; away: boolean }
  | { k: "lost"; seat: string; bag: number };

export type ErrorCode =
  | "NO_SEAT" | "NOT_PLAYING" | "NOT_VOTING" | "NO_ITEM" | "NO_SUCH_PERSON" | "SELF" | "AWAY"
  | "CAP_REACHED" | "SPRAY_CAP" | "NOT_ENOUGH" | "NO_AUCTION" | "TOO_LOW" | "ALREADY_TOP" | "BAD_REACTION"
  | "SLOW_DOWN" | "BAD_ACTION";

export type ActResult = { ok: true; events: GameEvent[] } | { ok: false; code: ErrorCode };

const fail = (code: ErrorCode): ActResult => ({ ok: false, code });
const STYLES: BotStyle[] = ["eager", "sneaky", "chaotic"];

export function createRound(id: string, cfg: Config, seats: SeatInit[], now: number, seed: number): Round {
  const rng = mulberry32(seed);
  const playStart = now + cfg.readyMs;
  const playEnd = playStart + cfg.playMs;
  const voteEnd = playEnd + cfg.voteMs;
  const styleOffset = Math.floor(rng() * STYLES.length);
  let botN = 0;
  const lots = [...AUCTION_LOTS].sort(() => rng() - 0.5);
  return {
    id, cfg, seed, phase: "ready", createdAt: now, playStart, playEnd, voteEnd,
    resultsEnd: voteEnd + cfg.resultsMs,
    seats: seats.map((s) => {
      const bot = Boolean(s.bot);
      return {
        id: s.id, name: s.name, avatar: s.avatar, bot,
        style: bot ? STYLES[(styleOffset + botN++) % STYLES.length]! : null,
        bag: cfg.startBag, given: 0, received: 0, burned: 0, recvSeq: 0,
        look: s.look ?? null,
        streakTo: null, streakN: 0, sprayRun: 0,
        present: bot, away: false, absentSince: bot ? null : now, left: false,
        lastReactAt: 0,
        nextBotAt: playStart + 300 + Math.floor(rng() * 1200),
        gave: {},
      };
    }),
    auctions: cfg.auctionAt.map((frac, idx) => {
      const opensAt = playStart + Math.round(frac * cfg.playMs);
      return {
        idx, lot: lots[idx % lots.length]!, opensAt,
        closesAt: Math.min(opensAt + cfg.auctionMs, playEnd), state: "pending" as const, high: null,
      };
    }),
    votes: {},
    recvCounter: 0,
    loserId: null,
    results: null,
  };
}

export function seatOf(r: Round, id: string): Seat | undefined {
  return r.seats.find((s) => s.id === id);
}

export function openAuction(r: Round): Auction | undefined {
  return r.auctions.find((a) => a.state === "open");
}

/** Play money a seat can spend: its bag minus what it has bid in the open auction. */
export function available(r: Round, s: Seat): number {
  const a = openAuction(r);
  return s.bag - (a?.high?.seat === s.id ? a.high.amount : 0);
}

/** Turns an untrusted message into an action, or null. */
export function parseAction(data: unknown): Action | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.t === "gift" && typeof d.to === "string" && d.to.length <= 64 && itemById(d.item)) {
    return { t: "gift", to: d.to, item: d.item as ItemId };
  }
  if (d.t === "spray" && typeof d.to === "string" && d.to.length <= 64) {
    return { t: "spray", to: d.to };
  }
  if (d.t === "bid" && typeof d.amount === "number" && Number.isSafeInteger(d.amount) && d.amount > 0) {
    return { t: "bid", amount: d.amount };
  }
  if (d.t === "react" && typeof d.r === "string" && (REACTIONS as readonly string[]).includes(d.r)) {
    return { t: "react", r: d.r };
  }
  return null;
}

export function act(r: Round, seatId: string, a: Action, now: number): ActResult {
  const s = seatOf(r, seatId);
  if (!s) return fail("NO_SEAT");
  const events: GameEvent[] = [];
  if (s.away) return fail("AWAY");

  if (a.t === "react") {
    if (r.phase === "done") return fail("NOT_PLAYING");
    if (!(REACTIONS as readonly string[]).includes(a.r)) return fail("BAD_REACTION");
    if (now - s.lastReactAt < r.cfg.reactGapMs) return fail("SLOW_DOWN");
    s.lastReactAt = now;
    events.push({ k: "react", seat: s.id, r: a.r });
    return { ok: true, events };
  }
  if (r.phase !== "playing") return fail("NOT_PLAYING");

  if (a.t === "gift" || a.t === "spray") {
    const item = a.t === "gift" ? itemById(a.item) : undefined;
    if (a.t === "gift" && !item) return fail("NO_ITEM");
    const amount = item ? item.price : r.cfg.sprayAmount;
    const to = seatOf(r, a.to);
    if (!to) return fail("NO_SUCH_PERSON");
    if (to.id === s.id) return fail("SELF");
    if (to.away) return fail("AWAY");
    const same = s.streakTo === to.id;
    if (item && same && s.streakN >= r.cfg.cap) return fail("CAP_REACHED");
    if (!item && same && s.sprayRun + amount > r.cfg.sprayCap) return fail("SPRAY_CAP");
    if (available(r, s) < amount) return fail("NOT_ENOUGH");
    s.bag -= amount;
    s.given += amount;
    s.gave[to.id] = (s.gave[to.id] ?? 0) + amount;
    to.bag += amount;
    to.received += amount;
    to.recvSeq = ++r.recvCounter;
    if (!same) {
      s.streakTo = to.id;
      s.streakN = 0;
      s.sprayRun = 0;
    }
    if (item) {
      s.streakN += 1;
      events.push({ k: "gift", from: s.id, to: to.id, item: item.id, amount });
    } else {
      s.sprayRun += amount;
      events.push({ k: "spray", from: s.id, to: to.id, amount });
    }
    return { ok: true, events };
  }

  if (a.t === "bid") {
    const auction = openAuction(r);
    if (!auction) return fail("NO_AUCTION");
    if (auction.high?.seat === s.id) return fail("ALREADY_TOP");
    const min = auction.high ? auction.high.amount + r.cfg.bidStep : r.cfg.minBid;
    if (!Number.isSafeInteger(a.amount) || a.amount < min) return fail("TOO_LOW");
    if (a.amount > s.bag) return fail("NOT_ENOUGH");
    auction.high = { seat: s.id, amount: a.amount };
    events.push({ k: "bid", idx: auction.idx, seat: s.id, amount: a.amount });
    return { ok: true, events };
  }
  return fail("BAD_ACTION");
}

/** Who holds the biggest bag. Ties: whoever received play money most recently; then a seeded pick. */
export function biggestBag(r: Round): Seat | undefined {
  const top = Math.max(...r.seats.map((s) => s.bag));
  const tied = r.seats.filter((s) => s.bag === top);
  const latest = Math.max(...tied.map((s) => s.recvSeq));
  const byRecency = tied.filter((s) => s.recvSeq === latest);
  if (byRecency.length === 1 || latest > 0) return byRecency[0];
  return pick(mulberry32(r.seed ^ 0x5bd1e995), byRecency);
}

export function setPresent(r: Round, id: string, present: boolean, now: number): GameEvent[] {
  const s = seatOf(r, id);
  if (!s || s.bot || s.present === present) return [];
  s.present = present;
  if (present) {
    s.absentSince = null;
    s.left = false;
    if (s.away) {
      s.away = false;
      return [{ k: "away", seat: s.id, away: false }];
    }
    return [];
  }
  s.absentSince = now;
  return [];
}

/** The player tapped Leave: away at once, still able to lose. They can come back. */
export function leave(r: Round, id: string, now: number): GameEvent[] {
  const s = seatOf(r, id);
  if (!s || s.bot) return [];
  s.present = false;
  s.left = true;
  s.absentSince = now;
  if (s.away) return [];
  s.away = true;
  return [{ k: "away", seat: s.id, away: true }];
}

function closeAuction(r: Round, a: Auction): GameEvent {
  a.state = "closed";
  const winner = a.high ? seatOf(r, a.high.seat) : undefined;
  if (winner && a.high) {
    // Bids are held back from gifts (see `available`), so this always fits.
    const paid = Math.min(a.high.amount, winner.bag);
    winner.bag -= paid;
    winner.burned += paid;
  }
  return { k: "auction", idx: a.idx, state: "closed", lot: a.lot, closesAt: a.closesAt, winner: winner?.id ?? null, amount: a.high?.amount ?? 0 };
}

/** Advances time: phases, auctions, away players, bot votes. Returns what happened. */
export function tick(r: Round, now: number, rng?: Rng): GameEvent[] {
  const ev: GameEvent[] = [];
  if (r.phase === "ready" && now >= r.playStart) {
    r.phase = "playing";
    ev.push({ k: "phase", phase: "playing" });
  }
  if (r.phase === "playing") {
    for (const s of r.seats) {
      if (!s.bot && !s.present && !s.away && s.absentSince !== null && now - s.absentSince >= r.cfg.awayMs) {
        s.away = true;
        ev.push({ k: "away", seat: s.id, away: true });
      }
    }
    for (const a of r.auctions) {
      if (a.state === "pending" && now >= a.opensAt && now < r.playEnd) {
        a.state = "open";
        ev.push({ k: "auction", idx: a.idx, state: "open", lot: a.lot, closesAt: a.closesAt, winner: null, amount: 0 });
      }
      if (a.state === "open" && now >= a.closesAt) ev.push(closeAuction(r, a));
    }
    if (now >= r.playEnd) {
      for (const a of r.auctions) if (a.state === "open") ev.push(closeAuction(r, a));
      for (const a of r.auctions) if (a.state === "pending") a.state = "closed";
      const loser = biggestBag(r)!;
      r.loserId = loser.id;
      r.phase = "voting";
      ev.push({ k: "lost", seat: loser.id, bag: loser.bag }, { k: "phase", phase: "voting" });
      const vr = rng ?? mulberry32(r.seed ^ 0x27d4eb2d);
      for (const b of r.seats.filter((s) => s.bot)) {
        const target = pick(vr, r.seats.filter((s) => s.id !== b.id));
        if (target) r.votes[b.id] = target.id;
      }
    }
  }
  if (r.phase === "voting") {
    const voters = r.seats.filter((s) => !s.bot && s.present);
    const allIn = voters.length > 0 && voters.every((s) => r.votes[s.id]);
    if (now >= r.voteEnd || allIn) {
      r.results = results(r);
      r.phase = "results";
      // Results start now if everyone voted early.
      r.resultsEnd = Math.min(r.resultsEnd, now + r.cfg.resultsMs);
      ev.push({ k: "phase", phase: "results" });
    }
  }
  if (r.phase === "results" && now >= r.resultsEnd) {
    r.phase = "done";
    ev.push({ k: "phase", phase: "done" });
  }
  return ev;
}

export function vote(r: Round, voterId: string, forId: string): { ok: true } | { ok: false; code: ErrorCode } {
  if (r.phase !== "voting") return { ok: false, code: "NOT_VOTING" };
  const voter = seatOf(r, voterId);
  if (!voter || voter.bot) return { ok: false, code: "NO_SEAT" };
  const target = seatOf(r, forId);
  if (!target) return { ok: false, code: "NO_SUCH_PERSON" };
  if (target.id === voter.id) return { ok: false, code: "SELF" };
  r.votes[voter.id] = target.id;
  return { ok: true };
}

export function results(r: Round): Results {
  const loser = r.seats.find((s) => s.id === r.loserId) ?? biggestBag(r)!;
  const tally: Record<string, number> = {};
  for (const t of Object.values(r.votes)) tally[t] = (tally[t] ?? 0) + 1;
  const topVotes = Math.max(0, ...Object.values(tally));
  const maxGiven = Math.max(0, ...r.seats.map((s) => s.given));
  const generous = maxGiven > 0 ? r.seats.find((s) => s.given === maxGiven) ?? null : null;
  return {
    loserId: loser.id,
    loserBag: loser.bag,
    generousId: generous?.id ?? null,
    generousGiven: maxGiven,
    funniestIds: topVotes > 0 ? r.seats.filter((s) => tally[s.id] === topVotes).map((s) => s.id) : [],
    votes: tally,
    standings: [...r.seats]
      .sort((a, b) => b.bag - a.bag)
      .map((s) => ({ id: s.id, bag: s.bag, given: s.given, burned: s.burned })),
    burned: r.seats.reduce((n, s) => n + s.burned, 0),
  };
}
