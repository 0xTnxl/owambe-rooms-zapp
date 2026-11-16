/**
 * PRD success metrics from `data/events.jsonl`: `pnpm metrics [path]`.
 * Chat activity and day-1/day-7 retention need Zend's data and aren't computed here.
 */
import { readFileSync } from "node:fs";

type Ev = Record<string, unknown> & { type: string; at: string };

const file = process.argv[2] ?? `${process.env.DATA_DIR ?? "data"}/events.jsonl`;
const events: Ev[] = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
  try {
    return [JSON.parse(l) as Ev];
  } catch {
    return [];
  }
});
const of = (t: string) => events.filter((e) => e.type === t);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");

// Second-round rate: of the sign-ins that played a round, how many played two or more.
const roundsPerSid = new Map<string, number>();
for (const e of of("round_joined")) roundsPerSid.set(String(e.sid), (roundsPerSid.get(String(e.sid)) ?? 0) + 1);
const played = [...roundsPerSid.values()];
const again = played.filter((n) => n >= 2).length;

// Friend adds per player per round.
const finished = of("round_finished");
const playerRounds = finished.reduce((n, e) => n + ((e.humans as string[] | undefined)?.length ?? 0), 0);
const adds = of("friend_add");
const mutual = adds.filter((e) => e.mutual === true);

// Invite joins per room.
const joins = of("invite_join");
const rooms = new Set(of("round_started").filter((e) => e.kind === "room").map((e) => String(e.code)));

// Real active players: a round, a mutual friend, and reported by at most two people.
const reporters = new Map<string, Set<string>>();
for (const r of of("report")) {
  const s = reporters.get(String(r.target)) ?? new Set<string>();
  s.add(String(r.from));
  reporters.set(String(r.target), s);
}
const roundPlayers = new Set(finished.flatMap((e) => (e.humans as string[] | undefined) ?? []));
const withFriend = new Set(mutual.flatMap((e) => [String(e.from), String(e.to)]));
const realActive = [...roundPlayers].filter((p) => withFriend.has(p) && (reporters.get(p)?.size ?? 0) <= 2);

const rows: [string, string][] = [
  ["Sign-ins that played", String(played.length)],
  ["Second-round rate", pct(again, played.length)],
  ["Rounds finished", String(finished.length)],
  ["Friend adds per player per round", playerRounds ? (adds.length / playerRounds).toFixed(2) : "n/a"],
  ["  of which became friends (mutual)", String(mutual.length)],
  ["Invite-link joins per private room", rooms.size ? (joins.length / rooms.size).toFixed(2) : "n/a"],
  ["Reports", String(of("report").length)],
  ["Real active players (round + friend, ≤2 reporters)", String(realActive.length)],
  ["All players who finished a round", String(roundPlayers.size)],
];
const w = Math.max(...rows.map((r) => r[0].length));
for (const [k, v] of rows) console.log(`${k.padEnd(w)}  ${v}`);
