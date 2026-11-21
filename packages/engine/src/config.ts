export type ItemId = "jollof" | "chain" | "danfo" | "duplex" | "jet";

export interface Item {
  id: ItemId;
  name: string;
  emoji: string;
  /** Play money. */
  price: number;
}

/** Gift items, cheapest first (PRD prices). */
export const ITEMS: readonly Item[] = [
  { id: "jollof", name: "Plate of jollof", emoji: "🍛", price: 2_000_000 },
  { id: "chain", name: "Gold chain", emoji: "📿", price: 500_000_000 },
  { id: "danfo", name: "Danfo bus", emoji: "🚌", price: 1_000_000_000 },
  { id: "duplex", name: "Lekki duplex", emoji: "🏠", price: 8_000_000_000 },
  { id: "jet", name: "Private jet", emoji: "🛩️", price: 20_000_000_000 },
];

/** Face value of one note in a spray (a spray is `sprayAmount / NOTE_VALUE` notes). */
export const NOTE_VALUE = 1_000_000;

export function itemById(id: unknown): Item | undefined {
  return ITEMS.find((i) => i.id === id);
}

/** Fixed reactions: no free text in rooms (v1 safety). */
export const REACTIONS = ["😂", "🔥", "💸", "👀", "🙌", "Na wa o", "Who send you?", "Abeg collect", "Oya!"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** What the auctions are "for". Flavour only: the money still just leaves the game. */
export const AUCTION_LOTS = [
  "The DJ for a whole night",
  "Front row at the owambe",
  "Aso-ebi for the whole street",
  "A billboard on Third Mainland",
  "Lunch with a Nollywood star",
  "A yacht party in Lekki",
];

export interface Config {
  startBag: number;
  readyMs: number;
  playMs: number;
  voteMs: number;
  resultsMs: number;
  /** Most gifts in a row to the same person. */
  cap: number;
  /** Play money in one spray: a wad of ₦1M notes, thrown with one flick. */
  sprayAmount: number;
  /** Most play money sprayed in a row on the same person before you have to spray someone else. */
  sprayCap: number;
  /** When each auction opens, as a share of play time. */
  auctionAt: number[];
  auctionMs: number;
  minBid: number;
  bidStep: number;
  /** A human out of the room this long is "away": frozen and can't be gifted. */
  awayMs: number;
  reactGapMs: number;
}

export const DEFAULT_CONFIG: Config = {
  startBag: 50_000_000_000,
  readyMs: 5_000,
  playMs: 120_000,
  voteMs: 20_000,
  resultsMs: 45_000,
  cap: 5,
  sprayAmount: 500_000_000,
  sprayCap: 10_000_000_000,
  auctionAt: [0.35, 0.7],
  auctionMs: 10_000,
  minBid: 1_000_000_000,
  bidStep: 500_000_000,
  awayMs: 10_000,
  reactGapMs: 1_000,
};
