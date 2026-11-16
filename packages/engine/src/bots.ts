import { ITEMS, REACTIONS } from "./config";
import { type Action, act, available, type GameEvent, openAuction, type Round, type Seat } from "./round";
import { pick, type Rng } from "./rng";

/**
 * Bots play by the same rules (and the same cap) as people; they only decide faster.
 * - eager: dumps the biggest item it can on whoever holds the most.
 * - sneaky: spreads mid-size gifts around and bids late.
 * - chaotic: anything, anyone.
 */
export function botAction(r: Round, bot: Seat, rng: Rng, now: number): Action | null {
  if (rng() < 0.1) return { t: "react", r: pick(rng, REACTIONS)! };

  const auction = openAuction(r);
  if (auction) {
    const rank = [...r.seats].sort((a, b) => b.bag - a.bag).findIndex((s) => s.id === bot.id);
    const left = auction.closesAt - now;
    const wants =
      bot.style === "eager" ? rank <= 1 && rng() < 0.6
      : bot.style === "sneaky" ? rank <= 2 && left < 3_000
      : rng() < 0.25;
    if (wants && auction.high?.seat !== bot.id) {
      const min = auction.high ? auction.high.amount + r.cfg.bidStep : r.cfg.minBid;
      const extra = bot.style === "eager" ? 2 + Math.floor(rng() * 8) : Math.floor(rng() * 3);
      const amount = Math.min(bot.bag, min + extra * r.cfg.bidStep);
      if (amount >= min) return { t: "bid", amount };
    }
  }

  if (bot.style === "sneaky" && rng() < 0.35) return null;
  const targets = r.seats.filter(
    (s) => s.id !== bot.id && !s.away && !(bot.streakTo === s.id && bot.streakN >= r.cfg.cap),
  );
  if (!targets.length) return null;
  const spend = available(r, bot);
  const affordable = ITEMS.filter((i) => i.price <= spend);
  if (!affordable.length) return null;

  if (bot.style === "eager") {
    const leader = [...targets].sort((a, b) => b.bag - a.bag)[0]!;
    return { t: "gift", to: leader.id, item: affordable[affordable.length - 1]!.id };
  }
  if (bot.style === "sneaky") {
    const mid = affordable.filter((i) => i.id === "danfo" || i.id === "duplex");
    return { t: "gift", to: pick(rng, targets)!.id, item: (pick(rng, mid) ?? affordable[affordable.length - 1]!).id };
  }
  return { t: "gift", to: pick(rng, targets)!.id, item: pick(rng, affordable)!.id };
}

/** Lets every bot whose turn it is act once. Bots think every 600-1400 ms. */
export function stepBots(r: Round, rng: Rng, now: number): GameEvent[] {
  if (r.phase !== "playing") return [];
  const out: GameEvent[] = [];
  for (const bot of r.seats) {
    if (!bot.bot || now < bot.nextBotAt) continue;
    bot.nextBotAt = now + 600 + Math.floor(rng() * 800);
    const a = botAction(r, bot, rng, now);
    if (!a) continue;
    const res = act(r, bot.id, a, now);
    if (res.ok) out.push(...res.events);
  }
  return out;
}

const BOT_NAMES = [
  "Chioma", "Tunde", "Bisi", "Emeka", "Halima", "Kunle", "Ngozi", "Femi", "Amaka", "Sade",
  "Ifeanyi", "Zainab", "Seyi", "Uche", "Funmi", "Musa", "Adaeze", "Dayo",
];

/** Names for bots, avoiding names already in the room. */
export function botNames(rng: Rng, n: number, taken: string[]): string[] {
  const free = BOT_NAMES.filter((b) => !taken.some((t) => t.split(" ")[0] === b)).sort(() => rng() - 0.5);
  return free.slice(0, n);
}
