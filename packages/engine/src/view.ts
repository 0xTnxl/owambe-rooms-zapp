import { biggestBag, openAuction, type Phase, type Results, type Round } from "./round";

export interface PublicSeat {
  id: string;
  name: string;
  avatar: string | null;
  /** Shown as a "bot" tag when bots are labelled, and always once results are in. */
  bot: boolean;
  bag: number;
  given: number;
  away: boolean;
  streakTo: string | null;
  streakN: number;
  sprayRun: number;
  look: string | null;
  gave: Record<string, number>;
}

export interface PublicAuction {
  idx: number;
  lot: string;
  closesAt: number;
  high: { seat: string; amount: number } | null;
}

/** Everything a player's page may see. Votes stay private until results. */
export interface PublicRound {
  id: string;
  phase: Phase;
  now: number;
  playStart: number;
  playEnd: number;
  voteEnd: number;
  resultsEnd: number;
  cap: number;
  sprayAmount: number;
  sprayCap: number;
  minBid: number;
  bidStep: number;
  seats: PublicSeat[];
  auction: PublicAuction | null;
  auctionsLeft: number;
  lead: string | null;
  /** Set when play ends. */
  loserId: string | null;
  voted: string[];
  results: Results | null;
}

export function publicView(r: Round, now: number, opts: { labelBots: boolean } = { labelBots: true }): PublicRound {
  const reveal = opts.labelBots || r.phase === "results" || r.phase === "done";
  const a = openAuction(r);
  return {
    id: r.id, phase: r.phase, now,
    playStart: r.playStart, playEnd: r.playEnd, voteEnd: r.voteEnd, resultsEnd: r.resultsEnd,
    cap: r.cfg.cap, sprayAmount: r.cfg.sprayAmount, sprayCap: r.cfg.sprayCap, minBid: r.cfg.minBid, bidStep: r.cfg.bidStep,
    seats: r.seats.map((s) => ({
      id: s.id, name: s.name, avatar: s.avatar, bot: reveal && s.bot, bag: s.bag, given: s.given,
      away: s.away, streakTo: s.streakTo, streakN: s.streakN, sprayRun: s.sprayRun, look: s.look, gave: s.gave,
    })),
    auction: a ? { idx: a.idx, lot: a.lot, closesAt: a.closesAt, high: a.high } : null,
    auctionsLeft: r.auctions.filter((x) => x.state !== "closed").length,
    lead: biggestBag(r)?.id ?? null,
    loserId: r.loserId,
    voted: Object.keys(r.votes).filter((id) => !r.seats.find((s) => s.id === id)?.bot),
    results: r.results,
  };
}
