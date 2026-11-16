import { api, errorText, type LobbyView } from "../api";
import type { Ctx } from "../ctx";
import { OnlineGame } from "../game";
import { avatar, first, h, paint, toast } from "../h";
import { appLink, share } from "../zend";

export async function inviteShare(code: string): Promise<void> {
  const r = await share("Join my Owambe room 🎉 Everyone gets ₦50B in play money (not real). Spend it before the timer ends. Biggest bag loses.", appLink({ room: code }));
  if (r === "copied") toast("Link copied");
  if (r === "failed") toast("Couldn't share. Tell them the code instead.");
}

export function lobby(ctx: Ctx, initial: LobbyView): () => void {
  let view = initial;
  let alive = true;
  let offset = initial.now - Date.now();
  const ctl = new AbortController();

  const render = () => {
    const l = view;
    const left = l.startsAt ? Math.max(0, Math.ceil((l.startsAt - (Date.now() + offset)) / 1000)) : null;
    const empty = Math.max(0, l.size - l.members.length);
    const title =
      l.kind === "room" ? `Room ${l.code}` : l.kind === "again" ? "Rematch!" : "Finding your people…";
    const host = l.members[0];
    const status =
      l.status === "starting" || l.status === "started" ? "Starting…"
      : l.status === "failed" ? "That didn't start. Try again."
      : l.status === "closed" ? "This room closed."
      : l.kind === "room"
        ? l.isHost ? "Share the link. Start when you're ready." : `Waiting for ${first(host?.name ?? "the host")} to start`
        : left !== null ? `Starting in ${left}s` : "Starting soon";

    paint(
      ctx.root,
      h(
        "section",
        { class: "screen lobby" },
        h("h2", null, title),
        h("p", { class: "status" }, status),
        h(
          "ul",
          { class: "members" },
          l.members.map((m) => h("li", null, avatar(m, 44), h("span", null, m.id === ctx.me?.id ? "You" : first(m.name)))),
          Array.from({ length: empty }, () => h("li", { class: "empty" }, h("span", { class: "av ghost" }, "?"), h("span", null, "…"))),
        ),
        empty ? h("p", { class: "fine" }, "Bots fill the empty seats, so nobody waits.") : null,
        l.kind === "room" && l.code && l.status === "waiting" ? h("button", { class: "btn", onclick: () => inviteShare(l.code!) }, "Invite friends") : null,
        l.kind === "room" && l.isHost && l.status === "waiting"
          ? h("button", {
              class: "btn big",
              onclick: async () => {
                try {
                  view = await api<LobbyView>("POST", "/api/rooms/start");
                  render();
                } catch (e) {
                  toast(errorText(e));
                }
              },
            }, "Start")
          : null,
        l.status === "failed" || l.status === "closed"
          ? h("button", { class: "btn big", onclick: () => ctx.go({ kind: "home" }) }, "Back")
          : h("button", {
              class: "btn ghost",
              onclick: () => {
                void api("POST", "/api/leave").catch(() => {});
                ctx.go({ kind: "home" });
              },
            }, "Leave"),
      ),
    );
  };

  const loop = async () => {
    while (alive) {
      try {
        const r = await api<{ lobby: LobbyView | null }>("GET", `/api/lobby?v=${view.v}`, undefined, ctl.signal);
        if (!alive) return;
        if (!r.lobby) {
          toast("You left that room.");
          return ctx.go({ kind: "home" });
        }
        view = r.lobby;
        offset = view.now - Date.now();
        if (view.status === "started" && view.roundId) {
          const game = new OnlineGame(ctx.me!, view.roundId);
          void game.start();
          return ctx.go({ kind: "play", game });
        }
        render();
      } catch (e) {
        if (!alive) return;
        if ((e as Error).name !== "AbortError") await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };

  if (initial.status === "started" && initial.roundId) {
    const game = new OnlineGame(ctx.me!, initial.roundId);
    void game.start();
    queueMicrotask(() => ctx.go({ kind: "play", game }));
    return () => {};
  }
  render();
  const timer = setInterval(render, 1000);
  void loop();
  return () => {
    alive = false;
    clearInterval(timer);
    ctl.abort();
  };
}
