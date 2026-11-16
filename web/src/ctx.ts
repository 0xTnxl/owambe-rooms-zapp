import type { LobbyView, Me } from "./api";
import type { Game } from "./game";

export type Screen =
  | { kind: "home" }
  | { kind: "landing"; room: string | null }
  | { kind: "lobby"; lobby: LobbyView }
  | { kind: "play"; game: Game }
  | { kind: "message"; title: string; text: string; retry?: () => void };

export interface Ctx {
  root: HTMLElement;
  me: Me | null;
  /** The server allows local dev sign-in (never in production). */
  dev: boolean;
  go(s: Screen): void;
}

/** A screen draws into `ctx.root` and returns its cleanup. */
export type ScreenFn<A> = (ctx: Ctx, arg: A) => () => void;
