import "./style.css";
import { api, errorText, hasSession, type LobbyView, type Me, setSession, signIn } from "./api";
import type { Ctx, Screen } from "./ctx";
import { OnlineGame } from "./game";
import { h, toast } from "./h";
import { home, landing, playOrToast } from "./screens/home";
import { lobby } from "./screens/lobby";
import { play } from "./screens/play";
import { code, inZend, zend } from "./zend";

const root = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
const roomParam = params.get("room")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || null;
let cleanup: () => void = () => {};

const ctx: Ctx = {
  root,
  me: null,
  dev: false,
  go(s: Screen) {
    cleanup();
    cleanup = () => {};
    window.scrollTo(0, 0);
    switch (s.kind) {
      case "home":
        if (!ctx.me) return ctx.go({ kind: "landing", room: null });
        cleanup = home(ctx);
        break;
      case "landing":
        cleanup = landing(ctx, s.room);
        break;
      case "lobby":
        cleanup = lobby(ctx, s.lobby);
        break;
      case "play":
        cleanup = play(ctx, s.game);
        break;
      case "message":
        root.replaceChildren(
          h("section", { class: "screen" }, h("div", { class: "logo" }, "🎉"), h("h2", null, s.title), h("p", { class: "status" }, s.text),
            s.retry ? h("button", { class: "btn big", onclick: s.retry }, "Try again") : null),
        );
    }
  },
};

/** Who am I: Zend's identity, swapped for a game session on our server. */
async function signInWithZend(): Promise<Me> {
  const id = await zend.identity.get();
  return signIn({ appSession: id.appSession });
}

/** Back to a round or lobby after a refresh or a dropped connection. */
async function resume(): Promise<boolean> {
  const r = await api<{ lobby: LobbyView | null }>("GET", "/api/lobby?v=-1").catch(() => null);
  const l = r?.lobby;
  if (!l || l.status === "closed" || l.status === "failed") return false;
  if (l.status === "started" && l.roundId) {
    const game = new OnlineGame(ctx.me!, l.roundId);
    await game.start();
    if (game.state.round && game.state.round.phase !== "done") {
      ctx.go({ kind: "play", game });
      return true;
    }
    game.close();
    return false;
  }
  ctx.go({ kind: "lobby", lobby: l });
  return true;
}

/** Opened from "Play Owambe" in a Zend chat: make a room and drop an invite card in that chat. */
async function fromChatTray(interactionId: string): Promise<boolean> {
  const i = await zend.interaction.get(interactionId).catch(() => null);
  if (!i || i.type !== "invite") return false;
  try {
    const l = await api<LobbyView>("POST", "/api/rooms", { invite: interactionId });
    await zend
      .postCard({
        interactionId, template: "invite", placement: "chat", idempotencyKey: `${interactionId}:card`,
        slots: {
          title: "Come and play Owambe Rooms",
          subtitle: `Room ${l.code}. Spend your play money fast: biggest bag loses.`,
          emoji: "🎉",
          buttons: [{ label: "Join", action: "open_sheet", path: `/?room=${l.code}` }],
        },
      })
      .catch((e) => toast(code(e) === "POSTING_NOT_ALLOWED" ? "Couldn't post the invite. Tap Invite friends to share it." : "Tap Invite friends to share the room."));
    ctx.go({ kind: "lobby", lobby: l });
    return true;
  } catch (e) {
    toast(errorText(e));
    return false;
  }
}

async function boot(): Promise<void> {
  const config = await api<{ dev?: boolean }>("GET", "/api/config").catch(() => ({ dev: false }));
  ctx.dev = config.dev === true;

  if (!inZend) {
    // A dev session survives a refresh; production play happens inside Zend.
    if (ctx.dev && hasSession()) {
      const who = await api<{ player: Me }>("GET", "/api/me").catch(() => null);
      if (who) {
        ctx.me = who.player;
        if (roomParam) return playOrToast(ctx, { mode: "room", code: roomParam, via: "link" });
        if (await resume()) return;
        return ctx.go({ kind: "home" });
      }
      setSession(null);
    }
    return ctx.go({ kind: "landing", room: roomParam });
  }

  try {
    ctx.me = await signInWithZend();
  } catch (e) {
    const c = code(e);
    return ctx.go({
      kind: "message", title: "Couldn't sign you in",
      text: c === "USER_CANCELLED" ? "Owambe needs your name and photo to seat you in a room." : errorText(e),
      retry: () => void boot(),
    });
  }

  if (roomParam) return playOrToast(ctx, { mode: "room", code: roomParam, via: "link" }).then(() => {
    // A dead room link still lands somewhere useful.
    if (!root.querySelector(".lobby")) ctx.go({ kind: "home" });
  });
  const launched = zend.launch.interaction;
  if (launched && (await fromChatTray(launched))) return;
  if (await resume()) return;
  ctx.go({ kind: "home" });
}

void boot();
