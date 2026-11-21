import { formatPlayNaira as naira, ITEMS, type PublicRound, type PublicSeat, REACTIONS } from "@owambe/engine";
import { audio } from "../audio/audio";
import { type Cue, music } from "../audio/music";
import * as sfx from "../audio/sfx";
import type { Ctx } from "../ctx";
import type { Game } from "../game";
import { first, h, paint, toast } from "../h";
import { appLink, share } from "../zend";
import { Party } from "./party";
import { getStage, type View } from "./stage";

const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
const clock = (ms: number) => {
  const s = secs(ms);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const notReal = () => h("p", { class: "p-notreal" }, "₦ here is play money. It's not real.");

/**
 * The round as a party. The scene is drawn by `Party`; this screen owns the controls on top of it:
 * the clock, who has the biggest bag, your bag, spraying, gifts, the MC's auctions, voting and
 * the results.
 */
export function partyScreen(ctx: Ctx, game: Game): () => void {
  const me = game.me;
  const party = new Party(() => music.beat());
  const stage = getStage();

  const root = h("section", { class: "party" });
  const tagLayer = h("div", { class: "p-tags", "aria-hidden": "true" });
  const popLayer = h("div", { class: "p-pops", "aria-hidden": "true" });
  const hud = h("div", { class: "p-hud" });
  root.append(tagLayer, popLayer, hud);
  ctx.root.replaceChildren(root);
  document.body.classList.add("in-party");

  const tags = new Map<string, { el: HTMLElement; name: HTMLElement; bag: HTMLElement; text: string }>();
  const floats = new Map<string, { el: HTMLElement; at: number }>();
  let combo = { n: 0, at: 0 };
  let myVote: string | null = null;
  let lastSecond = -1;
  let resultsShownAt = 0;
  let destroyed = false;
  let lastPhase = "";

  const round = () => game.state.round;
  const seat = (id: string | null) => (id ? round()?.seats.find((s) => s.id === id) : undefined);
  const name = (id: string) => (id === me.id ? "You" : first(seat(id)?.name ?? "Someone"));

  // ── Music follows the game ─────────────────────────────────────────────

  function cueFor(r: PublicRound | null): Cue {
    if (!r) return "lobby";
    if (r.phase === "ready") return "party";
    if (r.phase === "playing") return r.playEnd - game.now() <= 10_000 ? "countdown" : "party";
    if (r.phase === "voting") return "vote";
    return "results";
  }

  // ── Tags over heads ────────────────────────────────────────────────────

  function ensureTag(s: PublicSeat) {
    let t = tags.get(s.id);
    if (!t) {
      const nameEl = h("b", null);
      const bagEl = h("span", null);
      const el = h("div", { class: "p-tag" }, nameEl, bagEl);
      tagLayer.append(el);
      t = { el, name: nameEl, bag: bagEl, text: "" };
      tags.set(s.id, t);
    }
    const r = round()!;
    const label = s.id === me.id ? "You" : first(s.name);
    const text = `${label}|${s.bag}|${s.bot}|${r.lead === s.id}|${s.away}|${r.phase}`;
    if (text !== t.text) {
      t.text = text;
      t.name.textContent = `${r.lead === s.id && (r.phase === "playing" || r.phase === "ready") ? "👑 " : ""}${label}${s.bot ? " · bot" : ""}`;
      t.bag.textContent = s.away ? "stepped out" : naira(s.bag);
      t.el.classList.toggle("lead", r.lead === s.id && r.phase === "playing");
      t.el.classList.toggle("me", s.id === me.id);
      t.el.classList.toggle("away", s.away);
    }
  }

  function float(id: string, text: string, cls = "") {
    floats.get(id)?.el.remove();
    const el = h("div", { class: `p-float ${cls}` }, text);
    popLayer.append(el);
    floats.set(id, { el, at: performance.now() });
  }

  function pop(text: string, cls: string) {
    const el = h("div", { class: `p-pop ${cls}` }, text);
    popLayer.append(el);
    setTimeout(() => el.remove(), 1100);
  }

  // A view that draws the party, then moves the tags to follow the guests.
  const view: View = {
    scene: party.scene,
    camera: party.camera,
    resize: (w, hh) => party.resize(w, hh),
    update(dt, t) {
      party.update(dt, t);
      const w = root.clientWidth;
      const hh = root.clientHeight;
      const anchors = party.anchors(w, hh);
      // Tags that would overlap are nudged apart, nearer guests (lower on screen) keeping their place.
      const placed: { x: number; y: number }[] = [];
      for (const a of [...anchors.values()].sort((p, q) => q.y - p.y)) {
        for (let tries = 0; tries < 4; tries++) {
          const hit = placed.find((p) => Math.abs(p.x - a.x) < 84 && Math.abs(p.y - a.y) < 38);
          if (!hit) break;
          a.y = hit.y - 40;
        }
        placed.push(a);
      }
      for (const [id, a] of anchors) {
        const tag = tags.get(id);
        if (tag) tag.el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) translate(-50%, -100%)`;
        const f = floats.get(id);
        if (f) {
          const age = (performance.now() - f.at) / 1000;
          if (age > 1.9) {
            f.el.remove();
            floats.delete(id);
          } else f.el.style.transform = `translate(${a.x.toFixed(1)}px, ${(a.y - 34 - age * 26).toFixed(1)}px) translate(-50%, -100%)`;
        }
      }
    },
  };

  // ── Actions ────────────────────────────────────────────────────────────

  function canSpray(): string | null {
    const r = round();
    const mine = seat(me.id);
    if (!r || !mine || r.phase !== "playing") return null;
    const t = seat(party.target);
    if (!t || t.away) return null;
    return t.id;
  }

  function doSpray() {
    const to = canSpray();
    if (!to) {
      if (holdTimer) {
        clearInterval(holdTimer);
        holdTimer = undefined;
      } else if (round()?.phase === "playing") pop("Tap someone first", "hint");
      return;
    }
    const mine = seat(me.id)!;
    const r = round()!;
    if (mine.streakTo === to && mine.sprayRun + r.sprayAmount > r.sprayCap) {
      holdEnd();
      pop(`${name(to)} has had plenty. Pick someone else`, "hint");
      return;
    }
    game.spray(to);
    navigator.vibrate?.(8);
    const now = performance.now();
    combo = now - combo.at < 900 ? { n: combo.n + 1, at: now } : { n: 1, at: now };
    pop(`−${naira(r.sprayAmount)}`, "minus");
    schedule();
  }

  function setTarget(id: string | null) {
    const s = seat(id);
    if (s && (s.away || s.id === me.id)) return;
    party.target = id;
    sfx.tap();
    schedule();
  }

  // ── Touch: tap someone, flick up to spray ─────────────────────────────

  let anchorY = 0;
  let downX = 0;
  let downY = 0;
  let flicked = false;
  let downOn: string | null = null;
  const canvas = stage.canvas;
  const local = (e: PointerEvent) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top, w: b.width, h: b.height };
  };
  const onDown = (e: PointerEvent) => {
    audio.unlock();
    const p = local(e);
    anchorY = downY = e.clientY;
    downX = e.clientX;
    flicked = false;
    const r = round();
    downOn = party.pick(p.x, p.y, p.w, p.h, me.id);
    if (r?.phase === "playing" && downOn) setTarget(downOn);
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!e.buttons && e.pointerType === "mouse") return;
    if (round()?.phase !== "playing") return;
    if (anchorY - e.clientY > 34) {
      doSpray();
      anchorY = e.clientY;
      flicked = true;
    } else if (e.clientY - anchorY > 14) anchorY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 12;
    if (flicked || moved) return;
    const r = round();
    const p = local(e);
    if (r?.phase === "voting") {
      const id = party.pick(p.x, p.y, p.w, p.h, me.id);
      if (id) void castVote(id);
      return;
    }
    if (r?.phase === "playing" && !downOn && game.practice) {
      const at = party.floorAt(p.x, p.y, p.w, p.h);
      if (at) party.myHome = at;
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space" || e.key === "ArrowUp") {
      e.preventDefault();
      doSpray();
    }
    const n = Number(e.key);
    const t = canSpray();
    if (t && n >= 1 && n <= ITEMS.length) game.gift(t, ITEMS[n - 1]!.id);
  };
  addEventListener("keydown", onKey);

  // Holding the Spray button keeps spraying, about four a second.
  let holdTimer: ReturnType<typeof setInterval> | undefined;
  const holdStart = (e: Event) => {
    e.preventDefault();
    audio.unlock();
    doSpray();
    clearInterval(holdTimer);
    holdTimer = setInterval(doSpray, 230);
  };
  function holdEnd() {
    clearInterval(holdTimer);
    holdTimer = undefined;
  }
  addEventListener("pointerup", holdEnd);

  async function castVote(id: string) {
    const prev = myVote;
    myVote = id;
    party.voteFor = id;
    sfx.tap();
    schedule();
    if (!(await game.vote(id))) {
      myVote = prev;
      party.voteFor = prev;
    }
    schedule();
  }

  // ── HUD ────────────────────────────────────────────────────────────────

  function topBar(r: PublicRound) {
    const now = game.now();
    const ready = r.phase === "ready";
    const left = ready ? r.playStart - now : r.playEnd - now;
    const urgent = r.phase === "playing" && left <= 10_000;
    const leader = seat(r.lead);
    return h(
      "header",
      { class: "p-top" },
      r.phase === "playing" || ready
        ? h("div", { class: `p-clock${urgent ? " urgent" : ""}` }, ready ? "Get ready" : clock(left))
        : null,
      r.phase === "playing" && leader
        ? h("p", { class: `p-lead${leader.id === me.id ? " mine" : ""}` }, h("i", null),
            leader.id === me.id ? h("span", null, h("b", null, "You"), " have the biggest bag") : h("span", null, h("b", null, first(leader.name)), " has the biggest bag"))
        : null,
      r.phase === "playing" || ready ? notReal() : null,
    );
  }

  function readyCount(r: PublicRound) {
    if (r.phase !== "ready") return null;
    const n = secs(r.playStart - game.now());
    return h("div", { class: "p-center" }, h("p", { class: "p-big" }, n > 0 ? String(n) : "Oya!"), h("p", { class: "p-sub" }, "Biggest bag when the music stops loses."));
  }

  function auctionBar(r: PublicRound, mine: PublicSeat) {
    const a = r.auction;
    if (!a) return null;
    const base = a.high ? a.high.amount + r.bidStep : r.minBid;
    const top = a.high?.seat === me.id;
    const big = base + 9 * r.bidStep;
    const can = (amount: number) => !top && amount <= mine.bag && amount >= base;
    return h(
      "div",
      { class: "p-auction" },
      h("div", { class: "p-auction-lot" },
        h("small", null, `🎤 The MC is selling · ${secs(a.closesAt - game.now())}s`),
        h("b", null, a.lot),
        h("small", null, a.high ? `Top bid ${naira(a.high.amount)} · ${name(a.high.seat)}. The winner's play money leaves the game.` : "The winner's play money leaves the game.")),
      h("div", { class: "p-bids" },
        h("button", { class: "p-bid", disabled: !can(base), onclick: () => game.bid(base) }, `Bid ${naira(base)}`),
        h("button", { class: "p-bid", disabled: !can(big), onclick: () => game.bid(big) }, naira(big)),
        h("button", { class: "p-bid all", disabled: !can(mine.bag), onclick: () => game.bid(mine.bag) }, "All in")),
    );
  }

  function tray(r: PublicRound, mine: PublicSeat) {
    const t = seat(party.target);
    const target = t && !t.away ? t : undefined;
    const held = r.auction?.high?.seat === me.id ? r.auction.high.amount : 0;
    const playing = r.phase === "playing";
    const sprayCapped = target && mine.streakTo === target.id && mine.sprayRun + r.sprayAmount > r.sprayCap;
    const giftCapped = target && mine.streakTo === target.id && mine.streakN >= r.cap;
    const hint = game.state.error
      ?? (!playing ? "Get ready…"
        : !target ? "Tap someone, then flick up to spray them"
        : sprayCapped ? `You've sprayed ${first(target.name)} plenty. Pick someone else.`
        : `Flick up to spray ${first(target.name)}, or send something big`);
    const showCombo = combo.n >= 3 && performance.now() - combo.at < 900;
    return h(
      "footer",
      { class: "p-tray" },
      h("div", { class: "p-mine" },
        h("div", null, h("b", { class: "p-bag" }, naira(mine.bag)), h("small", null, "your bag · play money, not real")),
        showCombo ? h("span", { class: "p-combo" }, `×${combo.n} 🔥`) : null),
      h("p", { class: `p-hint${game.state.error ? " err" : ""}` }, hint),
      h(
        "div",
        { class: "p-actions" },
        h("button", {
          class: "p-spray", disabled: !playing || !target || Boolean(sprayCapped) || mine.bag - held < r.sprayAmount,
          onpointerdown: holdStart, onpointerup: holdEnd, onpointerleave: holdEnd, onpointercancel: holdEnd,
          "aria-label": target ? `Spray ${target.name} ${naira(r.sprayAmount)}` : "Spray",
        }, h("span", null, "💵"), h("small", null, `Spray ${naira(r.sprayAmount)}`)),
        ITEMS.map((i) =>
          h("button", {
            class: "p-item", disabled: !playing || !target || Boolean(giftCapped) || i.price > mine.bag - held,
            onclick: () => target && (audio.unlock(), game.gift(target.id, i.id)), "aria-label": `${i.name}, ${naira(i.price)}`,
          }, h("span", null, i.emoji), h("small", null, naira(i.price))),
        ),
      ),
      h("div", { class: "p-reacts" },
        REACTIONS.map((x) => h("button", { class: "p-react", onclick: () => game.react(x) }, x)),
        h("button", { class: "p-leave", onclick: leaveRound }, "Leave")),
    );
  }

  function voteView(r: PublicRound) {
    const others = r.seats.filter((s) => s.id !== me.id);
    const loser = seat(r.loserId);
    return [
      h("header", { class: "p-top center" },
        loser ? h("p", { class: "p-kicker" }, h("i", null), `${name(loser.id)} lost, left holding ${naira(loser.bag)}`) : null,
        h("h2", { class: "p-title" }, "Who was the funniest?"),
        h("p", { class: "p-sub" }, `Tap them · ${secs(r.voteEnd - game.now())}s`),
        notReal()),
      h("footer", { class: "p-tray" },
        h("div", { class: "p-chips" },
          others.map((s) => h("button", { class: `p-chip${myVote === s.id ? " on" : ""}`, onclick: () => castVote(s.id) }, first(s.name)))),
        myVote ? h("p", { class: "p-hint" }, `You voted for ${name(myVote)}. You can change it until the time's up.`) : null),
    ];
  }

  function resultsView(r: PublicRound) {
    const res = r.results;
    if (!res) return h("div", { class: "p-center" }, h("p", { class: "p-sub" }, "Counting…"));
    resultsShownAt ||= performance.now();
    if (performance.now() - resultsShownAt < 1800) return null;
    const loser = seat(res.loserId)!;
    const shareResult = async () => {
      const out = await share(`${loser.id === me.id ? "I" : first(loser.name)} lost Owambe Rooms, left holding ${naira(loser.bag)} in play money (not real) 😂 Come and play.`, appLink());
      if (out === "copied") toast("Link copied");
    };
    return h(
      "div",
      { class: "p-results" },
      h("p", { class: "p-kicker" }, h("i", null), "Results"),
      h("h2", { class: "p-title" }, loser.id === me.id ? "You lost!" : `${first(loser.name)} lost!`),
      h("p", { class: "p-sub" }, `Left holding ${naira(loser.bag)} in play money`),
      h("ul", { class: "p-awards" },
        res.generousId ? h("li", null, h("span", null, "💸"), h("div", null, h("b", null, name(res.generousId)), h("small", null, `Chief Spender · gave ${naira(res.generousGiven)}`))) : null,
        res.funniestIds.length ? h("li", null, h("span", null, "🤣"), h("div", null, h("b", null, res.funniestIds.map(name).join(" & ")), h("small", null, "Funniest"))) : null,
        res.burned ? h("li", null, h("span", null, "🔨"), h("div", null, h("b", null, naira(res.burned)), h("small", null, "Gone in the MC's auctions"))) : null),
      h("ol", { class: "p-standings" },
        res.standings.map((st) => h("li", { class: st.id === me.id ? "you" : "" }, h("span", null, name(st.id), seat(st.id)?.bot ? h("small", null, " · bot") : null), h("b", null, naira(st.bag))))),
      notReal(),
      h("button", { class: "pill ink", onclick: playAgain }, "Play again"),
      h("div", { class: "p-row" },
        h("button", { class: "pill ghost", onclick: () => ctx.go({ kind: "dressup", then: { kind: "practice", me } }) }, "Dress up"),
        h("button", { class: "pill ghost", onclick: shareResult }, "Share"),
        h("button", { class: "pill ghost", onclick: () => ctx.go({ kind: "home" }) }, ctx.me ? "Home" : "Done")),
    );
  }

  function playAgain() {
    audio.unlock();
    ctx.go({ kind: "practice", me });
  }

  function leaveRound() {
    game.leave();
    if (!game.practice) toast("You left. If you have the biggest bag at the end, you still lose!");
    ctx.go(ctx.me ? { kind: "home" } : { kind: "landing", room: null });
  }

  function render() {
    if (destroyed) return;
    const r = round();
    if (!r) {
      paint(hud, h("div", { class: "p-hudwrap" }, h("div", { class: "p-center" }, h("p", { class: "p-sub" }, "Joining the party…"))));
      return;
    }
    party.sync(r, me.id);
    for (const s of r.seats) ensureTag(s);
    tagLayer.classList.toggle("hide", r.phase === "results" || r.phase === "done");

    // Phase changes: music, energy, the clock ticking down.
    const cue = cueFor(r);
    music.play(cue);
    if (r.phase !== lastPhase) {
      lastPhase = r.phase;
      if (r.phase === "playing") sfx.airhorn();
    }
    const left = r.playEnd - game.now();
    party.energy = r.phase === "playing" ? (left <= 10_000 ? 1.25 : 0.75 + 0.3 * (1 - left / (r.playEnd - r.playStart))) : 0.7;
    if (r.phase === "playing" && left <= 10_000) {
      const s = secs(left);
      if (s !== lastSecond) {
        if (s === 10) sfx.riser(10);
        lastSecond = s;
        if (s > 0) sfx.tick(s <= 3);
      }
    }
    if (r.phase !== "playing") party.target = r.phase === "ready" ? party.target : null;

    const mine = seat(me.id);
    let body: (HTMLElement | null)[];
    if (r.phase === "ready" || r.phase === "playing") {
      // The MC's auction sits up top, over the canopy, so it never covers your own guest.
      body = [topBar(r), mine && r.auction ? auctionBar(r, mine) : null, readyCount(r), mine ? tray(r, mine) : null];
    } else if (r.phase === "voting") body = voteView(r);
    else body = [resultsView(r)];
    paint(hud, h("div", { class: `p-hudwrap ${r.phase}` },
      h("button", { class: "p-mute", "aria-label": audio.muted ? "Sound on" : "Sound off", onclick: () => (audio.unlock(), audio.setMuted(!audio.muted), schedule()) }, audio.muted ? "🔇" : "🔊"),
      ...body));
  }

  let raf = 0;
  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  // Reactions show over the sender as they arrive.
  const offEvents = game.onEvents((ev) => {
    party.play(ev);
    for (const e of ev) {
      if (e.k === "react") float(e.seat, e.r);
      if (e.k === "spray" && e.to === me.id) pop(`+${naira(e.amount)}`, "plus");
      if (e.k === "gift" && e.to === me.id) pop(`+${naira(e.amount)} ${ITEMS.find((i) => i.id === e.item)?.emoji ?? ""}`, "plus");
    }
  });
  const unsub = game.subscribe(schedule);
  const timer = setInterval(schedule, 250);
  stage.mount(root, view);
  render();
  audio.unlock();

  return () => {
    destroyed = true;
    offEvents();
    unsub();
    clearInterval(timer);
    clearInterval(holdTimer);
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    removeEventListener("keydown", onKey);
    removeEventListener("pointerup", holdEnd);
    stage.unmount(view);
    document.body.classList.remove("in-party");
    music.play("lobby");
    game.close();
  };
}
