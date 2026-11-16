import { formatPlayNaira, DEFAULT_CONFIG } from "@owambe/engine";
import { api, errorText, type LobbyView, signIn } from "../api";
import type { Ctx } from "../ctx";
import { PracticeGame } from "../game";
import { avatar, h, toast } from "../h";
import { appLink, inZend } from "../zend";

const START = formatPlayNaira(DEFAULT_CONFIG.startBag);

function howTo() {
  return h(
    "ul",
    { class: "how" },
    h("li", null, `Everyone starts with ${START} in play money.`),
    h("li", null, "Gift people, outbid them, get rid of it fast."),
    h("li", null, h("b", null, "Biggest bag when the timer ends loses.")),
  );
}

const playMoneyNote = () =>
  h("p", { class: "fine" }, "The ₦ in Owambe is play money. It isn't real, has no value outside a round, and can't be cashed out, sold or sent.");

export async function playOrToast(ctx: Ctx, body: Record<string, unknown>, path = "/api/play"): Promise<void> {
  try {
    const lobby = await api<LobbyView>("POST", path, body);
    ctx.go({ kind: "lobby", lobby });
  } catch (e) {
    toast(errorText(e));
  }
}

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
    class: "code-input", maxlength: 6, placeholder: "CODE", autocapitalize: "characters", autocomplete: "off",
    "aria-label": "Room code", spellcheck: "false",
  });
  const join = once(async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return toast("Room codes have 6 letters and numbers.");
    await playOrToast(ctx, { mode: "room", code });
  });
  codeInput.addEventListener("keydown", (e) => e.key === "Enter" && void join());

  ctx.root.replaceChildren(
    h(
      "section",
      { class: "screen home" },
      h("header", { class: "hero" }, h("div", { class: "logo" }, "🎉"), h("h1", null, "Owambe Rooms"), h("p", { class: "tag" }, "Spend it all before the music stops.")),
      h("div", { class: "me" }, avatar(me, 32), h("span", null, `Hi, ${me.name}`)),
      h("button", { class: "btn big", onclick: once(() => playOrToast(ctx, { mode: "public" })) }, "Play now"),
      h("button", { class: "btn", onclick: once(() => playOrToast(ctx, {}, "/api/rooms")) }, "Start a room"),
      h("div", { class: "join" }, codeInput, h("button", { class: "btn ghost", onclick: join }, "Join")),
      h("button", { class: "btn ghost", onclick: () => ctx.go({ kind: "play", game: new PracticeGame(me) }) }, "Practice with bots"),
      howTo(),
      playMoneyNote(),
    ),
  );
  return () => {};
}

/** Outside Zend: play there, or practise here. */
export function landing(ctx: Ctx, room: string | null): () => void {
  const name = h("input", { class: "code-input wide", maxlength: 24, placeholder: "Your name", "aria-label": "Your name" });
  ctx.root.replaceChildren(
    h(
      "section",
      { class: "screen home" },
      h("header", { class: "hero" }, h("div", { class: "logo" }, "🎉"), h("h1", null, "Owambe Rooms"), h("p", { class: "tag" }, "Spend it all before the music stops.")),
      room ? h("p", { class: "invite" }, `You're invited to room ${room}.`) : null,
      h("a", { class: "btn big", href: appLink(room ? { room } : {}) }, room ? "Join in Zend" : "Play in Zend"),
      h("p", { class: "fine" }, "Sign in with Google in one tap. Make friends, chat after."),
      h("button", { class: "btn ghost", onclick: () => ctx.go({ kind: "play", game: new PracticeGame({ id: "me", name: "You", avatar: null }) }) }, "Practice with bots"),
      howTo(),
      ctx.dev && !inZend
        ? h(
            "div",
            { class: "dev" },
            h("p", { class: "fine" }, "Local dev: sign in as anyone. Open a second tab to play each other."),
            h("div", { class: "join" }, name, h("button", {
              class: "btn ghost",
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
