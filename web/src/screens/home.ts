import { DEFAULT_CONFIG, formatPlayNaira } from "@owambe/engine";
import { api, errorText, type LobbyView, type Me, signIn } from "../api";
import type { Ctx } from "../ctx";
import { audio } from "../audio/audio";
import { avatar, first, h, toast } from "../h";
import { loadParty } from "../lazy";
import { hasDressed } from "../outfit";
import { appLink, inZend } from "../zend";

const START = formatPlayNaira(DEFAULT_CONFIG.startBag);
const SPRAY = formatPlayNaira(DEFAULT_CONFIG.sprayAmount);

function howTo() {
  return h(
    "ol",
    { class: "how" },
    h("li", null, h("p", null, h("b", null, "Everyone starts with ", START), " in play money.")),
    h("li", null, h("p", null, h("b", null, "Spray it on people. "), `Tap someone, flick up: ${SPRAY} a flick. Or send a danfo, a duplex, a jet.`)),
    h("li", null, h("p", null, h("b", null, "Outbid the MC's auctions. "), "Whatever wins leaves the game.")),
    h("li", null, h("p", null, h("b", null, "Biggest bag when the music stops loses."))),
  );
}

const playMoneyNote = () =>
  h("p", { class: "fine" }, "The ₦ in Owambe is play money. It isn't real, has no value outside a round, and can't be cashed out, sold or sent.");

const hero = () =>
  h(
    "header",
    { class: "hero" },
    h("p", { class: "kicker" }, "Owambe Rooms"),
    h("h1", { class: "title" }, h("span", null, "Spend it all"), h("span", { class: "soft" }, "before the music stops.")),
    h("p", { class: "lede" }, "A party in a room of six. Spray everyone, outbid the MC, and don't be the one left holding the biggest bag."),
  );

export async function playOrToast(ctx: Ctx, body: Record<string, unknown>, path = "/api/play"): Promise<void> {
  try {
    const lobby = await api<LobbyView>("POST", path, body);
    ctx.go({ kind: "lobby", lobby });
  } catch (e) {
    toast(errorText(e));
  }
}

/** Practice: a party with five bots, right here. Asks you to dress up the first time. */
function practice(ctx: Ctx, me: Me) {
  audio.unlock();
  const party = { kind: "practice" as const, me };
  ctx.go(hasDressed() ? party : { kind: "dressup", then: party });
}

/** The dress-up screen, then back to wherever you were. */
const dressUp = (ctx: Ctx, then: Parameters<Ctx["go"]>[0]) => () => ctx.go({ kind: "dressup", then });

export function home(ctx: Ctx): () => void {
  const me = ctx.me!;
  let busy = false;
  const once = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  };
  const codeInput = h("input", {
    class: "code-input", maxlength: 6, placeholder: "Room code", autocapitalize: "characters", autocomplete: "off",
    "aria-label": "Room code", spellcheck: "false",
  });
  const join = once(async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return toast("Room codes have 6 letters and numbers.");
    await playOrToast(ctx, { mode: "room", code });
  });
  codeInput.addEventListener("keydown", (e) => e.key === "Enter" && void join());
  // Start fetching the party now, so it's ready by the time anyone taps.
  setTimeout(() => void loadParty().catch(() => {}), 400);

  ctx.root.replaceChildren(
    h(
      "section",
      { class: "screen home" },
      h("div", { class: "me" }, avatar(me, 28), h("span", null, `Hi, ${first(me.name)}`), h("button", { class: "text-link", onclick: dressUp(ctx, { kind: "home" }) }, "Dress up")),
      hero(),
      h("div", { class: "stack" },
        h("button", { class: "pill ink", onclick: once(() => playOrToast(ctx, { mode: "public" })) }, "Play now"),
        h("button", { class: "pill ghost", onclick: once(() => playOrToast(ctx, {}, "/api/rooms")) }, "Start a room"),
        h("div", { class: "join" }, codeInput, h("button", { class: "pill ghost small", onclick: join }, "Join")),
        h("button", { class: "pill ghost", onclick: () => practice(ctx, me) }, "Practice with bots")),
      howTo(),
      playMoneyNote(),
    ),
  );
  return () => {};
}

/** Outside Zend: play there, or practise here. */
export function landing(ctx: Ctx, room: string | null): () => void {
  const name = h("input", { class: "code-input wide", maxlength: 24, placeholder: "Your name", "aria-label": "Your name" });
  const guest: Me = { id: "me", name: "You", avatar: null };
  setTimeout(() => void loadParty().catch(() => {}), 400);
  ctx.root.replaceChildren(
    h(
      "section",
      { class: "screen home" },
      hero(),
      room ? h("p", { class: "invite" }, h("i", null), `You're invited to room ${room}.`) : null,
      h("div", { class: "stack" },
        h("button", { class: "pill ink", onclick: () => practice(ctx, guest) }, "Practice with bots"),
        h("a", { class: "pill ghost", href: appLink(room ? { room } : {}) }, room ? "Join in Zend" : "Play with people in Zend"),
        h("button", { class: "pill ghost", onclick: dressUp(ctx, { kind: "landing", room }) }, "Dress up")),
      h("p", { class: "fine" }, "Playing with people happens in Zend. Sign in with Google in one tap, and chat after."),
      howTo(),
      ctx.dev && !inZend
        ? h(
            "div",
            { class: "dev" },
            h("p", { class: "fine" }, "Local dev: sign in as anyone. Open a second tab to play each other."),
            h("div", { class: "join" }, name, h("button", {
              class: "pill ghost small",
              onclick: async () => {
                try {
                  ctx.me = await signIn({ name: name.value || "Player" }, true);
                  if (room) await playOrToast(ctx, { mode: "room", code: room, via: "link" });
                  else ctx.go({ kind: "home" });
                } catch (e) {
                  toast(errorText(e));
                }
              },
            }, "Sign in")),
          )
        : null,
      playMoneyNote(),
    ),
  );
  return () => {};
}
