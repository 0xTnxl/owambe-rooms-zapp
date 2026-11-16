import { sessionToken } from "./api";
import { inZend, zend } from "./zend";

export interface RoomEvents {
  message(from: string, data: unknown): void;
  closed(): void;
  status(s: "connected" | "reconnecting" | "disconnected"): void;
}

export interface RoomLink {
  send(data: unknown): void;
  leave(): void;
}

/**
 * The round's live room. Inside Zend it's `zend.live` (Zend checks membership and stamps
 * `from`). In local dev it's the game server's stand-in at `/dev/live/:id`, with the same frames.
 */
export async function joinRoom(interactionId: string, ev: RoomEvents): Promise<RoomLink> {
  if (inZend) {
    const room = await zend.live.join(interactionId);
    room.on("message", (m) => ev.message(m.from, m.data));
    room.on("closed", () => ev.closed());
    room.on("status", (s) => ev.status(s));
    return { send: (d) => void room.send(d).catch(() => {}), leave: () => void room.leave().catch(() => {}) };
  }
  return devRoom(interactionId, ev);
}

function devRoom(id: string, ev: RoomEvents): RoomLink {
  let ws: WebSocket | null = null;
  let done = false;
  let delay = 500;
  const url = `${location.origin.replace(/^http/, "ws")}/dev/live/${encodeURIComponent(id)}?token=${encodeURIComponent(sessionToken() ?? "")}`;
  const connect = () => {
    const s = new WebSocket(url);
    ws = s;
    s.onopen = () => {
      delay = 500;
      ev.status("connected");
    };
    s.onmessage = (m) => {
      let f: { type?: string; from?: string; data?: unknown };
      try {
        f = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (f.type === "live_message" && typeof f.from === "string") ev.message(f.from, f.data);
      if (f.type === "live_closed") {
        done = true;
        ev.closed();
      }
    };
    s.onclose = () => {
      if (done) return;
      ev.status("reconnecting");
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 8000);
    };
  };
  connect();
  return {
    send: (data) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "send", data })),
    leave: () => {
      done = true;
      ws?.close();
    },
  };
}
