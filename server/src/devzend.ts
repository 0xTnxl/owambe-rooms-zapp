import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Player } from "./token";
import type { RoomHandlers, RoomIO, ZendPort } from "./zend";

interface DevRoom {
  allowed: Set<string>;
  server: RoomHandlers | null;
  pages: Map<string, { ws: WebSocket; who: Player }>;
}

/**
 * Local stand-in for Zend (`OWAMBE_DEV=1`). Same rules where they matter to the game: only an
 * interaction's participants can join its room, Zend stamps `from`, the room closes on a terminal
 * state, and frames look like Zend's. Pages connect to `/dev/live/:id?token=…`.
 */
export class DevZend implements ZendPort {
  private rooms = new Map<string, DevRoom>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  constructor(private auth: (token: string) => Player | null) {}

  async verifySession(): Promise<Player> {
    throw Object.assign(new Error("Use /api/dev/session in dev"), { code: "DEV" });
  }

  async createRound(p: { createdBy: string; participants: string[] }) {
    const id = `int_dev${randomBytes(5).toString("hex")}`;
    this.rooms.set(id, { allowed: new Set([p.createdBy, ...p.participants]), server: null, pages: new Map() });
    return id;
  }

  async setState(id: string, state: string) {
    if (state !== "done" && state !== "expired") return;
    const room = this.rooms.get(id);
    if (!room) return;
    const frame = JSON.stringify({ type: "live_closed", interaction_id: id, reason: state });
    for (const { ws } of room.pages.values()) {
      ws.send(frame);
      ws.close();
    }
    room.server?.closed(state);
    this.rooms.delete(id);
  }

  async blockedPairs() {
    return [] as [string, string][];
  }

  async isInvite() {
    return false;
  }

  openRoom(id: string, h: RoomHandlers): RoomIO {
    const room = this.rooms.get(id);
    if (room) room.server = h;
    return {
      send: (data) => {
        const r = this.rooms.get(id);
        if (!r) return false;
        this.fanOut(r, id, "app", data, null);
        return true;
      },
      close: () => {
        const r = this.rooms.get(id);
        if (r) r.server = null;
      },
    };
  }

  private fanOut(room: DevRoom, id: string, from: string, data: unknown, except: string | null) {
    const frame = JSON.stringify({ type: "live_message", interaction_id: id, from, data, at: new Date().toISOString() });
    for (const [pid, { ws }] of room.pages) if (pid !== except) ws.send(frame);
  }

  private presence(room: DevRoom, id: string) {
    const members = [...room.pages.values()].map(({ who }) => ({ app_user_id: who.id, name: who.name, username: null, avatar: who.avatar }));
    const frame = JSON.stringify({ type: "live_presence", interaction_id: id, members });
    for (const { ws } of room.pages.values()) ws.send(frame);
    room.server?.presence(members.map((m) => m.app_user_id));
  }

  /** Handles `GET /dev/live/:id?token=` upgrades. Returns false for other paths. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? "/", "http://dev");
    const m = /^\/dev\/live\/([A-Za-z0-9_]+)$/.exec(url.pathname);
    if (!m) return false;
    const id = m[1]!;
    const who = this.auth(url.searchParams.get("token") ?? "");
    const room = this.rooms.get(id);
    if (!who || !room || !room.allowed.has(who.id)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      // A second tab replaces the first, as on Zend.
      room.pages.get(who.id)?.ws.close();
      room.pages.set(who.id, { ws, who });
      this.presence(room, id);
      ws.on("message", (buf) => {
        let f: { type?: string; data?: unknown };
        try {
          f = JSON.parse(buf.toString());
        } catch {
          return;
        }
        if (f.type !== "send") return;
        this.fanOut(room, id, who.id, f.data, who.id);
        room.server?.message(who.id, f.data);
      });
      ws.on("close", () => {
        if (room.pages.get(who.id)?.ws === ws) {
          room.pages.delete(who.id);
          this.presence(room, id);
        }
      });
    });
    return true;
  }
}
