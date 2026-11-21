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
  // Bots pace themselves: they keep back a share of the start bag in step with the time left, so
  // the room stays a contest to the end instead of dumping everything in the first half minute.
  const left = Math.max(0, Math.min(1, (r.playEnd - now) / r.cfg.playMs));
  const reserve = r.cfg.startBag * left * (bot.style === "chaotic" ? 0.35 : 0.5);
  const spend = Math.max(0, Math.min(available(r, bot), bot.bag - reserve));
  // Holding far more than the start? Panic: big gifts, not little sprays.
  const panic = bot.bag > r.cfg.startBag * 1.3;

  // Spraying: small wads, often, mostly on whoever holds the most. Keeps the floor busy.
  const sprayP = panic ? 0.15 : bot.style === "eager" ? 0.45 : bot.style === "sneaky" ? 0.3 : 0.4;
  if (spend >= r.cfg.sprayAmount && rng() < sprayP) {
    const canSpray = r.seats.filter(
      (s) => s.id !== bot.id && !s.away && !(bot.streakTo === s.id && bot.sprayRun + r.cfg.sprayAmount > r.cfg.sprayCap),
    );
    const sorted = [...canSpray].sort((a, b) => b.bag - a.bag);
    // Mostly the biggest bag, but not always: a room where everyone sprays one person goes quiet fast.
    const to = bot.style === "chaotic" ? pick(rng, canSpray) : rng() < 0.45 ? sorted[0] : pick(rng, canSpray);
    if (to) return { t: "spray", to: to.id };
  }

  const targets = r.seats.filter(
    (s) => s.id !== bot.id && !s.away && !(bot.streakTo === s.id && bot.streakN >= r.cfg.cap),
  );
  if (!targets.length) return null;
  const affordable = ITEMS.filter((i) => i.price <= spend);
  if (!affordable.length) {
    // Nothing big fits the budget: a spray, when one fits the real bag.
    const to = pick(rng, targets.filter((s) => !(bot.streakTo === s.id && bot.sprayRun + r.cfg.sprayAmount > r.cfg.sprayCap)));
    return to && available(r, bot) >= r.cfg.sprayAmount && rng() < 0.12 ? { t: "spray", to: to.id } : null;
  }

  if (panic) {
    // The biggest thing it can afford, on whoever has least (they're the least likely to send it back).
    const poorest = [...targets].sort((a, b) => a.bag - b.bag);
    return { t: "gift", to: (rng() < 0.6 ? poorest[0] : pick(rng, targets))!.id, item: affordable[affordable.length - 1]!.id };
  }

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
    // A bot sitting on a big bag thinks faster.
    bot.nextBotAt = now + (bot.bag > r.cfg.startBag * 1.3 ? 300 + Math.floor(rng() * 400) : 600 + Math.floor(rng() * 800));
    const a = botAction(r, bot, rng, now);
    if (!a) continue;
    const res = act(r, bot.id, a, now);
    if (res.ok) out.push(...res.events);
    // A spray is a flick, not a decision: the next one comes quickly.
    if (res.ok && a.t === "spray") bot.nextBotAt = now + 350 + Math.floor(rng() * 450);
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
