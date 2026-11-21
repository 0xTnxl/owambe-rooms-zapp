// Not a test: prints how bot bags move through a round (`npx tsx test/pace.sim.ts`).
import { act, createRound, DEFAULT_CONFIG, mulberry32, setPresent, stepBots, tick } from "../src";

for (const seed of [1, 2, 3]) {
  const seats = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, avatar: null, bot: i > 0 }));
  const r = createRound("sim", DEFAULT_CONFIG, seats, 0, seed);
  setPresent(r, "s0", true, 0);
  const rng = mulberry32(seed);
  const marks = [0.25, 0.5, 0.75, 0.99];
  const active = process.argv.includes("--active");
  let streakTo = 1;
  for (let t = 0; r.phase !== "voting"; t += 100) {
    // --active: s0 plays like a busy human, a spray every 300 ms and a big gift every 2 s.
    if (active && r.phase === "playing") {
      const others = r.seats.filter((s) => s.id !== "s0");
      if (t % 300 === 0 && act(r, "s0", { t: "spray", to: `s${streakTo}` }, t).ok === false) streakTo = (streakTo % 5) + 1;
      if (t % 2000 === 0) {
        const low = [...others].sort((a, b) => a.bag - b.bag)[0]!;
        for (const item of ["jet", "duplex", "danfo"] as const) if (act(r, "s0", { t: "gift", to: low.id, item }, t).ok) break;
      }
    }
    stepBots(r, rng, t);
    tick(r, t, rng);
    const k = (t - r.playStart) / DEFAULT_CONFIG.playMs;
    if (marks.length && k >= marks[0]!) {
      marks.shift();
      console.log(seed, `${Math.round(k * 100)}%`, r.seats.map((s) => `${s.id}:${(s.bag / 1e9).toFixed(1)}B`).join(" "));
    }
  }
  console.log(seed, "loser", r.loserId);
}
