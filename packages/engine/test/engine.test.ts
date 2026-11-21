import { describe, expect, it } from "vitest";
import {
  act, botNames, createRound, decodeLook, DEFAULT_CONFIG, DEFAULT_LOOK, encodeLook, formatPlay, formatPlayNaira, leave, lookFor,
  mulberry32, parseAction, publicView, randomLook, results, type Round, seatOf, setPresent, stepBots, tick, vote,
} from "../src";

const T0 = 1_000_000;
const cfg = { ...DEFAULT_CONFIG };

function room(n = 4, bots = 0): Round {
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, avatar: null, bot: i >= n - bots }));
  const r = createRound("r1", cfg, seats, T0, 42);
  for (const s of r.seats) setPresent(r, s.id, true, T0);
  tick(r, r.playStart);
  return r;
}

const total = (r: Round) => r.seats.reduce((n, s) => n + s.bag, 0);
const burned = (r: Round) => r.seats.reduce((n, s) => n + s.burned, 0);

describe("gifts", () => {
  it("moves play money exactly", () => {
    const r = room();
    const res = act(r, "p0", { t: "gift", to: "p1", item: "danfo" }, r.playStart + 1);
    expect(res.ok).toBe(true);
    expect(seatOf(r, "p0")!.bag).toBe(cfg.startBag - 1e9);
    expect(seatOf(r, "p1")!.bag).toBe(cfg.startBag + 1e9);
    expect(seatOf(r, "p0")!.gave.p1).toBe(1e9);
    expect(total(r)).toBe(4 * cfg.startBag);
  });

  it("refuses gifts before play, to yourself, unknown items and more than the bag", () => {
    const seats = [{ id: "a", name: "A", avatar: null }, { id: "b", name: "B", avatar: null }];
    const r = createRound("r", cfg, seats, T0, 1);
    expect(act(r, "a", { t: "gift", to: "b", item: "jet" }, T0)).toEqual({ ok: false, code: "NOT_PLAYING" });
    tick(r, r.playStart);
    setPresent(r, "a", true, r.playStart);
    setPresent(r, "b", true, r.playStart);
    expect(act(r, "a", { t: "gift", to: "a", item: "jet" }, r.playStart)).toEqual({ ok: false, code: "SELF" });
    expect(act(r, "a", { t: "gift", to: "zz", item: "jet" }, r.playStart)).toEqual({ ok: false, code: "NO_SUCH_PERSON" });
    seatOf(r, "a")!.bag = 1e9;
    expect(act(r, "a", { t: "gift", to: "b", item: "jet" }, r.playStart)).toEqual({ ok: false, code: "NOT_ENOUGH" });
  });

  it("caps gifts in a row to one person at 5, and resets on someone else", () => {
    const r = room();
    const g = (to: string) => act(r, "p0", { t: "gift", to, item: "jollof" }, r.playStart + 1);
    for (let i = 0; i < 5; i++) expect(g("p1").ok).toBe(true);
    expect(g("p1")).toEqual({ ok: false, code: "CAP_REACHED" });
    expect(g("p2").ok).toBe(true);
    expect(g("p1").ok).toBe(true);
  });

  it("can't gift to someone away", () => {
    const r = room();
    leave(r, "p1", r.playStart);
    expect(act(r, "p0", { t: "gift", to: "p1", item: "jollof" }, r.playStart)).toEqual({ ok: false, code: "AWAY" });
    setPresent(r, "p1", true, r.playStart + 5);
    expect(act(r, "p0", { t: "gift", to: "p1", item: "jollof" }, r.playStart + 5).ok).toBe(true);
  });

  it("marks people away after 10 s out of the room", () => {
    const r = room();
    setPresent(r, "p2", false, r.playStart);
    expect(tick(r, r.playStart + 9_999)).toEqual([]);
    expect(tick(r, r.playStart + 10_000)).toContainEqual({ k: "away", seat: "p2", away: true });
  });
});

describe("spraying", () => {
  const spray = (r: Round, from: string, to: string, t = r.playStart + 1) => act(r, from, { t: "spray", to }, t);

  it("moves one wad of play money and counts as giving", () => {
    const r = room();
    const res = spray(r, "p0", "p1");
    expect(res).toEqual({ ok: true, events: [{ k: "spray", from: "p0", to: "p1", amount: cfg.sprayAmount }] });
    expect(seatOf(r, "p0")!.bag).toBe(cfg.startBag - cfg.sprayAmount);
    expect(seatOf(r, "p1")!.bag).toBe(cfg.startBag + cfg.sprayAmount);
    expect(seatOf(r, "p0")!.given).toBe(cfg.sprayAmount);
    expect(seatOf(r, "p0")!.gave.p1).toBe(cfg.sprayAmount);
    expect(total(r)).toBe(4 * cfg.startBag);
  });

  it("caps play money sprayed in a row on one person, and resets on someone else", () => {
    const r = room();
    const max = cfg.sprayCap / cfg.sprayAmount;
    for (let i = 0; i < max; i++) expect(spray(r, "p0", "p1").ok).toBe(true);
    expect(spray(r, "p0", "p1")).toEqual({ ok: false, code: "SPRAY_CAP" });
    expect(spray(r, "p0", "p2").ok).toBe(true);
    expect(spray(r, "p0", "p1").ok).toBe(true);
  });

  it("keeps the gift cap and the spray cap apart, and either one to someone else resets both", () => {
    const r = room();
    for (let i = 0; i < 5; i++) act(r, "p0", { t: "gift", to: "p1", item: "jollof" }, r.playStart + 1);
    expect(act(r, "p0", { t: "gift", to: "p1", item: "jollof" }, r.playStart + 1)).toEqual({ ok: false, code: "CAP_REACHED" });
    expect(spray(r, "p0", "p1").ok).toBe(true);
    expect(spray(r, "p0", "p2").ok).toBe(true);
    expect(act(r, "p0", { t: "gift", to: "p1", item: "jollof" }, r.playStart + 1).ok).toBe(true);
  });

  it("refuses sprays on yourself, on someone away, outside play, and beyond the bag less the top bid", () => {
    const r = room();
    expect(spray(r, "p0", "p0")).toEqual({ ok: false, code: "SELF" });
    leave(r, "p3", r.playStart);
    expect(spray(r, "p0", "p3")).toEqual({ ok: false, code: "AWAY" });
    const a = r.auctions[0]!;
    tick(r, a.opensAt);
    seatOf(r, "p0")!.bag = 2e9;
    act(r, "p0", { t: "bid", amount: 1.6e9 }, a.opensAt + 1);
    expect(spray(r, "p0", "p1", a.opensAt + 2)).toEqual({ ok: false, code: "NOT_ENOUGH" });
    tick(r, r.playEnd);
    expect(spray(r, "p1", "p2", r.playEnd + 1)).toEqual({ ok: false, code: "NOT_PLAYING" });
  });

  it("parses sprays", () => {
    expect(parseAction({ t: "spray", to: "p1" })).toEqual({ t: "spray", to: "p1" });
    expect(parseAction({ t: "spray", to: 3 })).toBeNull();
    expect(parseAction({ t: "spray", to: "x".repeat(65) })).toBeNull();
  });
});

describe("outfits", () => {
  it("round-trip through their code and reject bad ones", () => {
    for (let s = 1; s < 50; s++) {
      const l = randomLook(mulberry32(s));
      expect(decodeLook(encodeLook(l))).toEqual(l);
    }
    expect(decodeLook(encodeLook(DEFAULT_LOOK))).toEqual(DEFAULT_LOOK);
    expect(decodeLook("1zzzzzzzzz")).toBeNull();
    expect(decodeLook("2000000000")).toBeNull();
    expect(decodeLook("3000000000")).toBeNull();
    // Codes saved before prints existed still work, as plain fabric.
    expect(decodeLook("1412000300")).toEqual({ skin: 4, body: 1, hair: 2, head: 0, outfit: 0, color: 0, accent: 3, extra: 0, dance: 0, print: 0 });
    expect(decodeLook("100")).toBeNull();
    expect(decodeLook(42)).toBeNull();
  });

  it("give the same outfit for the same id", () => {
    expect(lookFor("zu_abc")).toEqual(lookFor("zu_abc"));
  });

  it("ride along in the public view", () => {
    const code = encodeLook(DEFAULT_LOOK);
    const r = createRound("r", cfg, [{ id: "a", name: "A", avatar: null, look: code }, { id: "b", name: "B", avatar: null }], T0, 1);
    const v = publicView(r, T0);
    expect(v.seats[0]!.look).toBe(code);
    expect(v.seats[1]!.look).toBeNull();
  });
});

describe("auctions", () => {
  function atAuction() {
    const r = room();
    const a = r.auctions[0]!;
    tick(r, a.opensAt);
    expect(a.state).toBe("open");
    return { r, a };
  }

  it("needs the minimum bid and a step above the top bid", () => {
    const { r, a } = atAuction();
    const t = a.opensAt + 1;
    expect(act(r, "p0", { t: "bid", amount: 5e8 }, t)).toEqual({ ok: false, code: "TOO_LOW" });
    expect(act(r, "p0", { t: "bid", amount: 1e9 }, t).ok).toBe(true);
    expect(act(r, "p0", { t: "bid", amount: 3e9 }, t)).toEqual({ ok: false, code: "ALREADY_TOP" });
    expect(act(r, "p1", { t: "bid", amount: 1.2e9 }, t)).toEqual({ ok: false, code: "TOO_LOW" });
    expect(act(r, "p1", { t: "bid", amount: 1.5e9 }, t).ok).toBe(true);
    expect(act(r, "p2", { t: "bid", amount: 60e9 }, t)).toEqual({ ok: false, code: "NOT_ENOUGH" });
  });

  it("burns the winning bid when it closes", () => {
    const { r, a } = atAuction();
    act(r, "p1", { t: "bid", amount: 7e9 }, a.opensAt + 1);
    const ev = tick(r, a.closesAt);
    expect(ev).toContainEqual(expect.objectContaining({ k: "auction", state: "closed", winner: "p1", amount: 7e9 }));
    expect(seatOf(r, "p1")!.bag).toBe(cfg.startBag - 7e9);
    expect(total(r) + burned(r)).toBe(4 * cfg.startBag);
  });

  it("holds the top bid back from gifts", () => {
    const { r, a } = atAuction();
    act(r, "p0", { t: "bid", amount: 45e9 }, a.opensAt + 1);
    expect(act(r, "p0", { t: "gift", to: "p1", item: "jet" }, a.opensAt + 2)).toEqual({ ok: false, code: "NOT_ENOUGH" });
    expect(act(r, "p0", { t: "gift", to: "p1", item: "chain" }, a.opensAt + 2).ok).toBe(true);
  });
});

describe("end of round", () => {
  it("the biggest bag loses", () => {
    const r = room();
    act(r, "p0", { t: "gift", to: "p2", item: "jet" }, r.playStart + 1);
    const ev = tick(r, r.playEnd);
    expect(r.phase).toBe("voting");
    expect(ev).toContainEqual({ k: "lost", seat: "p2", bag: cfg.startBag + 20e9 });
  });

  it("on a tie, whoever received play money last loses", () => {
    const r = room(3);
    act(r, "p0", { t: "gift", to: "p1", item: "danfo" }, r.playStart + 1); // p1 +1B
    act(r, "p2", { t: "gift", to: "p0", item: "danfo" }, r.playStart + 2); // p0 back to start
    act(r, "p1", { t: "gift", to: "p2", item: "danfo" }, r.playStart + 3); // all equal, p2 last
    tick(r, r.playEnd);
    expect(r.loserId).toBe("p2");
  });

  it("with nobody having received, the tie is a seeded pick", () => {
    const a = room(3);
    const b = room(3);
    tick(a, a.playEnd);
    tick(b, b.playEnd);
    expect(a.loserId).toBe(b.loserId);
  });

  it("counts votes, finds the most generous, and ends early when everyone voted", () => {
    const r = room(3);
    act(r, "p1", { t: "gift", to: "p0", item: "duplex" }, r.playStart + 1);
    tick(r, r.playEnd);
    expect(vote(r, "p0", "p0")).toEqual({ ok: false, code: "SELF" });
    vote(r, "p0", "p1");
    vote(r, "p1", "p2");
    expect(r.phase).toBe("voting");
    vote(r, "p2", "p1");
    tick(r, r.playEnd + 1);
    expect(r.phase).toBe("results");
    expect(r.results!.funniestIds).toEqual(["p1"]);
    expect(r.results!.generousId).toBe("p1");
    expect(r.results!.loserId).toBe("p0");
    tick(r, r.resultsEnd);
    expect(r.phase).toBe("done");
  });

  it("shares funniest on a tie", () => {
    const r = room(2);
    tick(r, r.playEnd);
    vote(r, "p0", "p1");
    vote(r, "p1", "p0");
    expect(results(r).funniestIds.sort()).toEqual(["p0", "p1"]);
  });
});

describe("bots", () => {
  it("play a whole round without breaking a rule", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const seats = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, avatar: null, bot: true }));
      const r = createRound("bots", cfg, seats, T0, seed);
      const rng = mulberry32(seed);
      let streaks = 0;
      let sprayRun = 0;
      let sprays = 0;
      for (let t = T0; r.phase !== "done"; t += 100) {
        const ev = [...stepBots(r, rng, t), ...tick(r, t)];
        sprays += ev.filter((e) => e.k === "spray").length;
        streaks = Math.max(streaks, ...r.seats.map((s) => s.streakN));
        sprayRun = Math.max(sprayRun, ...r.seats.map((s) => s.sprayRun));
        for (const s of r.seats) expect(s.bag).toBeGreaterThanOrEqual(0);
        expect(total(r) + burned(r)).toBe(6 * cfg.startBag);
        void ev;
      }
      expect(streaks).toBeLessThanOrEqual(cfg.cap);
      expect(sprayRun).toBeLessThanOrEqual(cfg.sprayCap);
      expect(sprays).toBeGreaterThan(0);
      expect(r.seats.some((s) => s.given > 0)).toBe(true);
      expect(r.results).not.toBeNull();
    }
  }, 30_000);

  it("get names nobody in the room has", () => {
    expect(botNames(mulberry32(1), 3, ["Tunde Bakare"])).not.toContain("Tunde");
  });
});

describe("helpers", () => {
  it("shows ₦ inside the game only", () => {
    expect(formatPlayNaira(50e9)).toBe("₦50B");
    expect(formatPlayNaira(-2e6)).toBe("-₦2M");
  });

  it("formats play money without ₦ for Zend surfaces", () => {
    expect(formatPlay(50e9)).toBe("50B");
    expect(formatPlay(1.5e9)).toBe("1.5B");
    expect(formatPlay(2e6)).toBe("2M");
    expect(formatPlay(500e6)).toBe("500M");
    expect(formatPlay(999_999_999)).toBe("1B");
    expect(formatPlay(0)).toBe("0");
  });

  it("parses only well-formed actions", () => {
    expect(parseAction({ t: "gift", to: "p1", item: "jet" })).toEqual({ t: "gift", to: "p1", item: "jet" });
    expect(parseAction({ t: "gift", to: "p1", item: "house" })).toBeNull();
    expect(parseAction({ t: "bid", amount: 1.5 })).toBeNull();
    expect(parseAction({ t: "bid", amount: -1 })).toBeNull();
    expect(parseAction({ t: "react", r: "hello" })).toBeNull();
    expect(parseAction("gift")).toBeNull();
  });

  it("keeps votes private until results", () => {
    const r = room(3);
    tick(r, r.playEnd);
    vote(r, "p0", "p1");
    const v = publicView(r, r.playEnd);
    expect(v.voted).toEqual(["p0"]);
    expect(JSON.stringify(v)).not.toContain('"votes"');
  });
});
