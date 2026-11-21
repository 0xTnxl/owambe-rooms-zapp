import type { LobbyView, Me } from "./api";
import type { Game } from "./game";

export type Screen =
  | { kind: "home" }
  | { kind: "landing"; room: string | null }
  | { kind: "lobby"; lobby: LobbyView }
  | { kind: "play"; game: Game }
  /** The 3D party for a game that's already running. */
  | { kind: "party"; game: Game }
  /** A new practice party with bots, started when the screen opens. */
  | { kind: "practice"; me: Me }
  | { kind: "dressup"; then: Screen }
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
