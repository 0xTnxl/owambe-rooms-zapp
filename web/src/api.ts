import type { PublicRound } from "@owambe/engine";

export interface Me {
  id: string;
  name: string;
  avatar: string | null;
}

export interface LobbyView {
  id: string;
  kind: "public" | "room" | "again";
  code: string | null;
  isHost: boolean;
  members: Me[];
  status: "waiting" | "starting" | "started" | "failed" | "closed";
  startsAt: number | null;
  roundId: string | null;
  error: string | null;
  size: number;
  v: number;
  now: number;
}

export interface RoundInfo {
  round: PublicRound;
  added: [string, string][];
  humans: string[];
  kind: string;
  code: string | null;
}

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const KEY = "owambe.session";
let token: string | null = sessionStorage.getItem(KEY);

export const hasSession = () => token !== null;
export const sessionToken = () => token;

export function setSession(t: string | null): void {
  token = t;
  if (t) sessionStorage.setItem(KEY, t);
  else sessionStorage.removeItem(KEY);
}

export async function api<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("OFFLINE", 0, "No connection");
  }
  const json = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!r.ok) {
    if (r.status === 401) setSession(null);
    throw new ApiError(json.error ?? `HTTP_${r.status}`, r.status, json.message ?? "That didn't go through. Try again.");
  }
  return json as T;
}

export const signIn = async (body: Record<string, string>, dev = false) => {
  const r = await api<{ token: string; player: Me }>("POST", dev ? "/api/dev/session" : "/api/session", body);
  setSession(r.token);
  return r.player;
};

/** Plain-language copy for server error codes. */
export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : (e as { code?: string })?.code;
  switch (code) {
    case "NO_ROOM": return "That room isn't open any more.";
    case "ROOM_FULL": return "That room is full.";
    case "ROOM_STARTED": return "That room already started. Try Play now.";
    case "CANT_JOIN": return "You can't join this room.";
    case "NO_ROUND": return "That round is over.";
    case "SLOW_DOWN": return "Slow down a little.";
    case "OFFLINE": return "No connection. Check your data and try again.";
    case "SIGN_IN": return "Couldn't sign you in. Try again.";
    default: return "That didn't go through. Try again.";
  }
}
