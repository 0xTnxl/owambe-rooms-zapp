import { formatPlay, formatPlayNaira as naira, ITEMS, type PublicRound, type PublicSeat, REACTIONS } from "@owambe/engine";
import { api, errorText, type LobbyView } from "../api";
import type { Ctx } from "../ctx";
import { type Game, PracticeGame } from "../game";
import { avatar, first, h, paint, sheet, toast } from "../h";
import { appLink, code, inZend, share, zend } from "../zend";

const REPORT_REASONS = [
  { label: "Rude or mean", value: "rude" },
  { label: "Harassing me", value: "harassment" },
  { label: "Cheating", value: "cheating" },
  { label: "Spam", value: "spam" },
  { label: "Looks under age", value: "underage" },
  { label: "Something else", value: "other" },
];

/** Always on screen wherever ₦ amounts are. */
export const notReal = () => h("p", { class: "notreal" }, "₦ here is play money. Not real, can't be cashed out.");

const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
const clock = (ms: number) => {
  const s = secs(ms);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function play(ctx: Ctx, game: Game): () => void {
  const me = game.me;
  let target: string | null = null;
  let myVote: string | null = null;
  const muted = new Set<string>();
  const friend: Record<string, "adding" | "done"> = {};
  let friendsOff = false;
  let posted = false;
  let raf = 0;

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  };

  const seatName = (r: PublicRound, id: string) => (id === me.id ? "You" : first(r.seats.find((s) => s.id === id)?.name ?? "Someone"));
  const isHuman = (id: string) => game.state.humans.includes(id);

  // ── Safety: mute, report, don't match ─────────────────────────────────

  async function personMenu(s: PublicSeat, afterRound: boolean) {
    const choice = await sheet(first(s.name), [
      ...(!afterRound ? [{ label: muted.has(s.id) ? "Unmute" : "Mute their reactions", value: "mute" }] : []),
      { label: "Report", value: "report", danger: true },
      { label: "Don't match me with them", value: "avoid" },
    ]);
    if (choice === "mute") {
      if (muted.has(s.id)) muted.delete(s.id);
      else muted.add(s.id);
      schedule();
    } else if (choice === "report") {
      const reason = await sheet(`Report ${first(s.name)}`, REPORT_REASONS);
      if (!reason) return;
      try {
        await api("POST", "/api/report", { round: game.roundId, target: s.id, reason });
        muted.add(s.id);
        toast("Thanks. We'll look into it, and you won't be matched again.");
      } catch (e) {
        toast(errorText(e));
      }
    } else if (choice === "avoid") {
      try {
        await api("POST", "/api/avoid", { round: game.roundId, target: s.id });
        toast(`You won't be matched with ${first(s.name)} again.`);
      } catch (e) {
        toast(errorText(e));
      }
    }
  }

  // ── Playing ───────────────────────────────────────────────────────────

  function seat(r: PublicRound, s: PublicSeat, mine: PublicSeat | undefined) {
    const now = game.now();
    const float = game.state.floats.get(s.id);
    const showFloat = float && now - float[1] < 1800 && !muted.has(s.id);
    const streak = mine && mine.streakTo === s.id ? mine.streakN : 0;
    const playing = r.phase === "playing";
    const cls = ["seat", s.id === me.id && "me", r.lead === s.id && "lead", s.away && "away", target === s.id && "picked", streak >= r.cap && "capped"]
      .filter(Boolean).join(" ");
    return h(
      "div",
      {
        class: cls, role: "button", tabindex: 0,
        "aria-label": `${s.id === me.id ? "You" : s.name}, ${naira(s.bag)} play money`,
        onclick: () => {
          if (!playing || s.id === me.id || s.away) return;
          target = target === s.id ? null : s.id;
          schedule();
        },
      },
      r.lead === s.id ? h("span", { class: "crown" }, "👑") : null,
      avatar(s, 48),
      h("span", { class: "name" }, s.id === me.id ? "You" : first(s.name), s.bot ? h("small", { class: "bot" }, "bot") : null),
      h("span", { class: "bag" }, naira(s.bag)),
      streak ? h("span", { class: "streak", title: "Gifts in a row" }, `${streak}/${r.cap}`) : null,
      s.away ? h("span", { class: "awaytag" }, "stepped out") : null,
      showFloat ? h("span", { class: "float" }, float[0]) : null,
      !game.practice && s.id !== me.id && isHuman(s.id)
        ? h("button", { class: "more", "aria-label": `More for ${s.name}`, onclick: (e: Event) => (e.stopPropagation(), personMenu(s, false)) }, "⋯")
        : null,
    );
  }

  function auctionBar(r: PublicRound, mine: PublicSeat) {
    const a = r.auction;
    if (!a) return null;
    const left = secs(a.closesAt - game.now());
    const base = a.high ? a.high.amount + r.bidStep : r.minBid;
    const top = a.high?.seat === me.id;
    const bid = (amount: number) => () => game.bid(amount);
    const can = (amount: number) => !top && amount <= mine.bag && amount >= base;
    const big = base + 9 * r.bidStep;
    return h(
      "div",
      { class: "auction" },
      h("div", { class: "row" }, h("b", null, "🔨 Auction"), h("span", { class: "timer small" }, `${left}s`)),
      h("p", { class: "lot" }, a.lot),
      h("p", { class: "fine" }, a.high ? `Top bid ${naira(a.high.amount)} by ${seatName(r, a.high.seat)}. The winner's play money leaves the game.` : `No bids yet. Start at ${naira(base)}. The winner's play money leaves the game.`),
      h(
        "div",
        { class: "row bids" },
        h("button", { class: "btn small", disabled: !can(base), onclick: bid(base) }, `Bid ${naira(base)}`),
        h("button", { class: "btn small", disabled: !can(big), onclick: bid(big) }, `Bid ${naira(big)}`),
        h("button", { class: "btn small hot", disabled: !can(mine.bag), onclick: bid(mine.bag) }, "All in"),
      ),
    );
  }

  function tray(r: PublicRound, mine: PublicSeat) {
    const t = target ? r.seats.find((s) => s.id === target && !s.away) : undefined;
    if (!t) return h("p", { class: "hint" }, r.phase === "ready" ? "Get ready…" : "Tap someone to gift them");
    const held = r.auction?.high?.seat === me.id ? r.auction.high.amount : 0;
    const capped = mine.streakTo === t.id && mine.streakN >= r.cap;
    return h(
      "div",
      { class: "tray" },
      h("p", { class: "hint" }, capped ? `That's ${r.cap} in a row to ${first(t.name)}. Gift someone else first.` : `Gift ${first(t.name)}:`),
      h(
        "div",
        { class: "items" },
        ITEMS.map((i) =>
          h("button", { class: "item", disabled: capped || i.price > mine.bag - held, onclick: () => game.gift(t.id, i.id), "aria-label": `${i.name}, ${naira(i.price)}` },
            h("span", { class: "emoji" }, i.emoji), h("span", null, i.name), h("b", null, naira(i.price))),
        ),
      ),
    );
  }

  function playingView(r: PublicRound) {
    const now = game.now();
    const mine = r.seats.find((s) => s.id === me.id);
    const ready = r.phase === "ready";
    const left = ready ? r.playStart - now : r.playEnd - now;
    const leader = r.seats.find((s) => s.id === r.lead);
    return h(
      "section",
      { class: "screen round" },
      h(
        "header",
        { class: "hud" },
        h("span", { class: `timer${!ready && left < 10_000 ? " urgent" : ""}` }, ready ? `${secs(left)}` : clock(left)),
        leader
          ? h("span", { class: `leadpill${leader.id === me.id ? " mine" : ""}` }, leader.id === me.id ? "👑 Biggest bag: YOU. Give it away!" : `👑 Biggest bag: ${first(leader.name)}`)
          : null,
      ),
      notReal(),
      game.state.connection === "reconnecting" ? h("p", { class: "banner" }, "Reconnecting…") : null,
      h("ul", { class: "feed" }, game.state.feed.map((f) => h("li", null, f.text))),
      h("div", { class: "seats" }, r.seats.map((s) => seat(r, s, mine))),
      mine && r.auction ? auctionBar(r, mine) : null,
      mine ? tray(r, mine) : null,
      h(
        "footer",
        { class: "mine" },
        h("div", null, h("small", null, "Your bag"), h("b", { class: "big-bag" }, naira(mine?.bag ?? 0)), h("small", { class: "pm" }, "play money · not real")),
        game.state.error ? h("p", { class: "err" }, game.state.error) : h("p", { class: "fine" }, "Biggest bag at the end loses."),
        h("div", { class: "reactions" }, REACTIONS.map((x) => h("button", { class: "react", onclick: () => game.react(x) }, x))),
        h("button", { class: "link", onclick: leaveRound }, "Leave round"),
      ),
    );
  }

  function leaveRound() {
    game.leave();
    toast("You left. If you have the biggest bag at the end, you still lose!");
    ctx.go({ kind: "home" });
  }

  // ── Voting ────────────────────────────────────────────────────────────

  function voteView(r: PublicRound) {
    const others = r.seats.filter((s) => s.id !== me.id);
    const humans = r.seats.filter((s) => isHuman(s.id)).length;
    const loser = r.seats.find((s) => s.id === r.loserId);
    return h(
      "section",
      { class: "screen vote" },
      loser ? h("p", { class: "lost-line" }, `😂 ${loser.id === me.id ? "You" : first(loser.name)} lost, left holding ${naira(loser.bag)}`) : null,
      notReal(),
      h("h2", null, "Who was the funniest?"),
      h("p", { class: "status" }, `${secs(r.voteEnd - game.now())}s · ${r.voted.length} of ${humans} voted`),
      h(
        "div",
        { class: "seats" },
        others.map((s) =>
          h("button", {
            class: `seat${myVote === s.id ? " picked" : ""}`,
            onclick: async () => {
              const prev = myVote;
              myVote = s.id;
              schedule();
              if (!(await game.vote(s.id))) myVote = prev;
              schedule();
            },
          }, avatar(s, 48), h("span", { class: "name" }, first(s.name), s.bot ? h("small", { class: "bot" }, "bot") : null)),
        ),
      ),
      myVote ? h("p", { class: "fine" }, "Voted. You can change it until the time's up.") : null,
    );
  }

  // ── Results ───────────────────────────────────────────────────────────

  async function addFriend(r: PublicRound, s: PublicSeat) {
    const mine = r.seats.find((x) => x.id === me.id);
    const gave = mine?.gave[s.id] ?? 0;
    const where = game.state.code ? `Met in room ${game.state.code}.` : "Met in an Owambe room.";
    // This note becomes a line in their Zend chat, next to real payments: no ₦ there.
    const extra = gave ? ` ${first(me.name)} gave ${first(s.name)} ${formatPlay(gave)} in play money.` : "";
    const note = (where + extra).length <= 80 ? where + extra : where;
    friend[s.id] = "adding";
    schedule();
    const connect = (withNote: boolean) => zend.people.connect({ appUserId: s.id, interactionId: game.roundId, ...(withNote ? { note } : {}) });
    try {
      await connect(true).catch((e) => (code(e) === "INVALID_NOTE" ? connect(false) : Promise.reject(e)));
      friend[s.id] = "done";
      game.added(s.id);
    } catch (e) {
      delete friend[s.id];
      const c = code(e);
      if (c === "UNKNOWN_METHOD" || c === "NOT_IN_ZEND") friendsOff = true;
      else if (c === "BLOCKED") toast(`You can't add ${first(s.name)}.`);
      else if (c === "CONNECT_LIMIT") toast("You've added a lot of people. Try again later.");
      else if (c !== "USER_CANCELLED") toast("That didn't go through. Try again.");
    }
    schedule();
  }

  async function chat(s: PublicSeat) {
    try {
      await zend.people.chat({ appUserId: s.id });
    } catch (e) {
      toast(code(e) === "NO_CHAT" ? `Add ${first(s.name)} first.` : "Couldn't open the chat. Find them in your Zend chats.");
    }
  }

  function friendsBlock(r: PublicRound) {
    const people = r.seats.filter((s) => s.id !== me.id && isHuman(s.id));
    if (game.practice || !people.length) return null;
    if (friendsOff || !inZend) return h("p", { class: "fine" }, "Update Zend to add the people you played with.");
    const mine = r.seats.find((x) => x.id === me.id);
    const added = game.state.added;
    return h(
      "div",
      { class: "friends" },
      h("h3", null, "Clicked with someone?"),
      people.map((s) => {
        const iAdded = friend[s.id] === "done" || added.some(([a, b]) => a === me.id && b === s.id);
        const theyAdded = added.some(([a, b]) => a === s.id && b === me.id);
        const gaveThem = mine?.gave[s.id] ?? 0;
        const gaveMe = s.gave[me.id] ?? 0;
        const line = [gaveThem && `You gave them ${naira(gaveThem)}`, gaveMe && `They gave you ${naira(gaveMe)}`].filter(Boolean).join(" · ");
        return h(
          "div",
          { class: "friend" },
          avatar(s, 40),
          h("div", { class: "who" }, h("b", null, first(s.name)), h("small", null, theyAdded && !iAdded ? `${first(s.name)} added you!` : line || "Played with you")),
          iAdded
            ? h("button", { class: "btn small", onclick: () => chat(s) }, "Chat")
            : h("button", { class: "btn small hot", disabled: friend[s.id] === "adding", onclick: () => addFriend(r, s) }, theyAdded ? "Add back" : "Add friend"),
          h("button", { class: "more", "aria-label": `More for ${s.name}`, onclick: () => personMenu(s, true) }, "⋯"),
        );
      }),
    );
  }

  async function playAgain() {
    if (game.practice) return ctx.go({ kind: "play", game: new PracticeGame(me) });
    try {
      const lobby = await api<LobbyView>("POST", "/api/play", { mode: "again", round: game.roundId });
      ctx.go({ kind: "lobby", lobby });
    } catch (e) {
      // The round was forgotten (server restart): a new public game instead.
      try {
        const lobby = await api<LobbyView>("POST", "/api/play", { mode: "public" });
        ctx.go({ kind: "lobby", lobby });
      } catch {
        toast(errorText(e));
      }
    }
  }

  async function postToFeed(r: PublicRound) {
    const res = r.results!;
    const loser = r.seats.find((s) => s.id === res.loserId)!;
    const funny = res.funniestIds.map((id) => first(r.seats.find((s) => s.id === id)?.name ?? "")).filter(Boolean);
    try {
      await zend.postCard({
        interactionId: game.roundId, template: "result", placement: "feed", idempotencyKey: `${game.roundId}:feed:${me.id}`,
        slots: {
          title: `${first(loser.name)} lost Owambe Rooms`.slice(0, 80),
          // Shown in the Zend feed, next to real payments: no ₦ there.
          subtitle: `Left holding ${formatPlay(loser.bag)} in play money.${funny.length ? ` Funniest: ${funny.join(", ")}.` : ""}`.slice(0, 140),
          emoji: "🎉",
          buttons: [{ label: "Play Owambe", action: "open_sheet", path: "/" }],
        },
      });
      posted = true;
      toast("Posted to your feed");
    } catch (e) {
      const c = code(e);
      toast(c === "POSTING_NOT_ALLOWED" ? "Turn on posting for Owambe in Settings → Connected apps." : c === "CARD_LIMIT" ? "Owambe has posted enough for today." : "That didn't go through. Try again.");
    }
    schedule();
  }

  function resultsView(r: PublicRound) {
    const res = r.results;
    if (!res) return h("section", { class: "screen" }, h("p", { class: "status" }, "Counting…"));
    const loser = r.seats.find((s) => s.id === res.loserId)!;
    const name = (id: string) => (id === me.id ? "You" : first(r.seats.find((s) => s.id === id)?.name ?? ""));
    const humans = r.seats.filter((s) => isHuman(s.id)).length;
    const shareResult = async () => {
      const out = await share(`${loser.id === me.id ? "I" : first(loser.name)} lost Owambe Rooms, left holding ${naira(loser.bag)} in play money (not real) 😂 Come and play.`, appLink());
      if (out === "copied") toast("Link copied");
    };
    return h(
      "section",
      { class: "screen results" },
      h(
        "div",
        { class: "loser" },
        h("div", { class: "boom" }, "😂"),
        avatar(loser, 72),
        h("h2", null, loser.id === me.id ? "You lost!" : `${first(loser.name)} lost!`),
        h("p", null, `Left holding ${naira(loser.bag)} in play money`),
      ),
      h(
        "div",
        { class: "awards" },
        res.generousId ? h("div", null, h("span", null, "💸"), h("b", null, name(res.generousId)), h("small", null, `Most generous · gave ${naira(res.generousGiven)}`)) : null,
        res.funniestIds.length ? h("div", null, h("span", null, "🤣"), h("b", null, res.funniestIds.map(name).join(" & ")), h("small", null, "Funniest")) : null,
        res.burned ? h("div", null, h("span", null, "🔨"), h("b", null, naira(res.burned)), h("small", null, "Burned in auctions")) : null,
      ),
      notReal(),
      h("button", { class: "btn big", onclick: playAgain }, "Play again"),
      friendsBlock(r),
      h(
        "ol",
        { class: "standings" },
        res.standings.map((st) => {
          const s = r.seats.find((x) => x.id === st.id)!;
          return h("li", { class: st.id === me.id ? "you" : "" }, h("span", null, name(st.id), s.bot ? h("small", { class: "bot" }, "bot") : null), h("b", null, naira(st.bag)));
        }),
      ),
      h(
        "div",
        { class: "row actions" },
        h("button", { class: "btn ghost", onclick: shareResult }, "Share"),
        !game.practice && inZend && humans >= 2 && !posted ? h("button", { class: "btn ghost", onclick: () => postToFeed(r) }, "Post to feed") : null,
        h("button", { class: "btn ghost", onclick: () => ctx.go({ kind: "home" }) }, ctx.me ? "Home" : "Done"),
      ),
    );
  }

  function render() {
    const r = game.state.round;
    let el: HTMLElement;
    if (!r) el = h("section", { class: "screen" }, h("p", { class: "status" }, "Joining the room…"), h("div", { class: "logo spin" }, "🎉"));
    else if (r.phase === "ready" || r.phase === "playing") el = playingView(r);
    else if (r.phase === "voting") el = voteView(r);
    else el = resultsView(r);
    paint(ctx.root, el);
  }

  const unsub = game.subscribe(schedule);
  const timer = setInterval(schedule, 250);
  render();
  return () => {
    unsub();
    clearInterval(timer);
    cancelAnimationFrame(raf);
    game.close();
  };
}
