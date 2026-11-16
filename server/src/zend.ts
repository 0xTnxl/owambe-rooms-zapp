import { ZendServer } from "@zendfi/appkit/server";
import WebSocket from "ws";
import type { Player } from "./token";

/** What a round's room tells the game server. `from` is set by Zend, never by a page. */
export interface RoomHandlers {
  message(from: string, data: unknown): void;
  /** App user ids of the people in the room right now. */
  presence(ids: string[]): void;
  /** The room is gone for good (interaction finished, or Zend refused us). */
  closed(reason: string): void;
}

export interface RoomIO {
  /** False when the socket isn't open; callers resend state on the next snapshot. */
  send(data: unknown): boolean;
  close(): void;
}

/** Everything Owambe needs from Zend. `RealZend` in production, `DevZend` locally. */
export interface ZendPort {
  verifySession(appSession: string): Promise<Player>;
  createRound(p: { createdBy: string; participants: string[]; data: Record<string, unknown>; expiresInSecs: number }): Promise<string>;
  setState(interactionId: string, state: string): Promise<void>;
  blockedPairs(ids: string[]): Promise<[string, string][]>;
  /** True if this is one of our `invite` interactions (a chat-tray invite) and the player is in it. */
  isInvite(interactionId: string, player: string): Promise<boolean>;
  openRoom(interactionId: string, h: RoomHandlers): RoomIO;
}

/** Frames Zend sends on a live room socket (`WsServerFrame` in zendfi `pool_ws.rs`). */
export type LiveFrame =
  | { type: "live_message"; interaction_id: string; from: string; data: unknown; at: string }
  | { type: "live_presence"; interaction_id: string; members: { app_user_id: string }[] }
  | { type: "live_closed"; interaction_id: string; reason: string }
  | { type: "error"; code: string; message: string };

export function handleFrame(raw: string, h: RoomHandlers): "closed" | undefined {
  let f: LiveFrame;
  try {
    f = JSON.parse(raw) as LiveFrame;
  } catch {
    return;
  }
  switch (f.type) {
    case "live_message":
      if (typeof f.from === "string") h.message(f.from, f.data);
      return;
    case "live_presence":
      h.presence((f.members ?? []).map((m) => m.app_user_id).filter((x): x is string => typeof x === "string"));
      return;
    case "live_closed":
      h.closed(f.reason ?? "closed");
      return "closed";
    case "error":
      console.warn(JSON.stringify({ at: "zend_room_error", code: f.code }));
      return;
  }
}

export class RealZend implements ZendPort {
  private api: ZendServer;

  constructor(private appKey: string, private base: string) {
    this.api = new ZendServer(appKey, base);
  }

  async verifySession(appSession: string): Promise<Player> {
    const u = await this.api.verifySession(appSession);
    return { id: u.app_user_id, name: u.name, avatar: u.avatar };
  }

  async createRound(p: { createdBy: string; participants: string[]; data: Record<string, unknown>; expiresInSecs: number }) {
    const i = (await this.api.createInteraction({
      type: "round", created_by: p.createdBy, participants: p.participants, data: p.data,
      expires_in_secs: p.expiresInSecs,
    })) as { id: string };
    return i.id;
  }

  async setState(interactionId: string, state: string) {
    await this.api.updateInteraction(interactionId, { state, idempotency_key: `${interactionId}:${state}` });
  }

  async blockedPairs(ids: string[]) {
    if (ids.length < 2) return [];
    return (await this.api.blockedPairs(ids.slice(0, 50))).pairs;
  }

  async isInvite(interactionId: string, player: string) {
    try {
      const i = (await this.api.getInteraction(interactionId)) as { type?: string; participants?: { app_user_id?: string }[] };
      return i.type === "invite" && (i.participants ?? []).some((p) => p.app_user_id === player);
    } catch {
      return false;
    }
  }

  openRoom(interactionId: string, h: RoomHandlers): RoomIO {
    const url = `${this.base.replace(/^http/, "ws")}/api/zend/v2/apps/server/live/${encodeURIComponent(interactionId)}/ws`;
    let ws: WebSocket | null = null;
    let done = false;
    let delay = 500;
    const connect = () => {
      if (done) return;
      const sock = new WebSocket(url, { headers: { authorization: `Bearer ${this.appKey}` } });
      ws = sock;
      sock.on("open", () => (delay = 500));
      sock.on("message", (buf) => {
        if (handleFrame(buf.toString(), h) === "closed") done = true;
      });
      // Zend says no (finished interaction, wrong app): stop for good.
      sock.on("unexpected-response", (_req, res) => {
        if (res.statusCode === 403 || res.statusCode === 404 || res.statusCode === 410) {
          done = true;
          h.closed(`http_${res.statusCode}`);
        }
        sock.terminate();
      });
      sock.on("error", () => {});
      sock.on("close", () => {
        if (done) return;
        setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15_000);
      });
    };
    connect();
    return {
      send(data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify({ type: "send", data }));
        return true;
      },
      close() {
        done = true;
        ws?.close();
      },
    };
  }
}
