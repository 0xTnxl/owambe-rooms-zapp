import { randomBytes } from "node:crypto";
import type { ServerConfig } from "./config";
import type { Seated } from "./rounds";
import type { AvoidStore, Log } from "./store";
import type { ZendPort } from "./zend";

export type LobbyKind = "public" | "room" | "again";
export type LobbyStatus = "waiting" | "starting" | "started" | "failed" | "closed";

interface Lobby {
  id: string;
  kind: LobbyKind;
  code: string | null;
  hostId: string | null;
  /** Rematch: the round it came from, and who was in it. */
  fromRound: string | null;
  expected: string[];
  /** Chat-tray invite this room was made for. */
  inviteId: string | null;
  members: Seated[];
  createdAt: number;
  firstAt: number | null;
  v: number;
  status: LobbyStatus;
  roundId: string | null;
  error: string | null;
  endedAt: number | null;
  waiters: Set<() => void>;
}

export interface LobbyView {
  id: string;
  kind: LobbyKind;
  code: string | null;
  isHost: boolean;
  members: { id: string; name: string; avatar: string | null }[];
  status: LobbyStatus;
  /** When a waiting public or rematch lobby starts on its own (server time, ms). */
  startsAt: number | null;
  roundId: string | null;
  error: string | null;
  size: number;
  v: number;
  now: number;
}

export class MatchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

interface Deps {
  cfg: ServerConfig;
  zend: ZendPort;
  avoid: AvoidStore;
  log: Log;
  now: () => number;
  /** Starts a round for these people; resolves its id (the Zend interaction id). */
  startRound: (p: { kind: LobbyKind; code: string | null; humans: Seated[] }) => Promise<string>;
  /** Called when a player starts looking for a new game, so their old round can let them go. */
  leaveRound: (player: string) => void;
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_EMPTY_MS = 2 * 60_000;
const ROOM_MAX_WAIT_MS = 30 * 60_000;
const KEEP_ENDED_MS = 10 * 60_000;
const BLOCK_CACHE_MS = 30_000;

export class Matchmaker {
  private lobbies = new Map<string, Lobby>();
  private codes = new Map<string, string>();
  private tickets = new Map<string, string>();
  private blockCache = new Map<string, { at: number; pairs: [string, string][] }>();

  constructor(private d: Deps) {}

  // ── Joining ────────────────────────────────────────────────────────────

  /** "Play now": the oldest open public lobby with nobody to avoid, or a new one. */
  async playPublic(p: Seated): Promise<LobbyView> {
    this.release(p.id);
    const open = [...this.lobbies.values()]
      .filter((l) => l.kind === "public" && l.status === "waiting" && l.members.length < this.d.cfg.roomSize)
      .sort((a, b) => a.createdAt - b.createdAt);
    const ids = [p.id];
    for (const l of open) {
      if (ids.length + l.members.length > 50) break;
      ids.push(...l.members.map((m) => m.id));
    }
    const blocked = await this.blocked(ids);
    const fits = open.find(
      (l) => l.status === "waiting" && l.members.length < this.d.cfg.roomSize && !this.conflicts(p.id, l, blocked),
    );
    const lobby = fits ?? this.create("public", null);
    this.add(lobby, p);
    this.maybeStart(lobby);
    return this.view(lobby, p.id);
  }

  /** "Start a room": a private room with a code; the host taps Start. */
  createRoom(p: Seated, inviteId: string | null = null): LobbyView {
    this.release(p.id);
    let code: string;
    do {
      code = Array.from(randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    } while (this.codes.has(code));
    const lobby = this.create("room", code);
    lobby.hostId = p.id;
    lobby.inviteId = inviteId;
    this.add(lobby, p);
    return this.view(lobby, p.id);
  }

  async joinRoom(p: Seated, rawCode: string, via: string | null): Promise<LobbyView> {
    const code = rawCode.trim().toUpperCase();
    const lobby = this.lobbyByCode(code);
    if (!lobby || lobby.status === "closed" || lobby.status === "failed") throw new MatchError("NO_ROOM", "That room isn't open");
    if (lobby.members.some((m) => m.id === p.id)) return this.view(lobby, p.id);
    if (lobby.status !== "waiting") throw new MatchError("ROOM_STARTED", "That room already started");
    if (lobby.members.length >= this.d.cfg.roomSize) throw new MatchError("ROOM_FULL", "That room is full");
    const blocked = await this.blocked([p.id, ...lobby.members.map((m) => m.id)]);
    // Don't say why: never reveal a block or a report.
    if (this.conflicts(p.id, lobby, blocked)) throw new MatchError("CANT_JOIN", "You can't join this room");
    this.release(p.id);
    this.add(lobby, p);
    this.markInvite(lobby);
    if (via === "link" && lobby.hostId && lobby.hostId !== p.id) {
      this.d.log("invite_join", { code, host: lobby.hostId, player: p.id });
    }
    return this.view(lobby, p.id);
  }

  /** "Play again": a lobby for the people from that round who also tap it. */
  async playAgain(p: Seated, fromRound: string, humans: string[]): Promise<LobbyView> {
    if (!humans.includes(p.id)) throw new MatchError("NOT_IN_ROUND", "You weren't in that round");
    let lobby = [...this.lobbies.values()].find((l) => l.kind === "again" && l.fromRound === fromRound && l.status === "waiting");
    if (lobby && lobby.members.length >= this.d.cfg.roomSize) lobby = undefined;
    if (lobby && !lobby.members.some((m) => m.id === p.id)) {
      const blocked = await this.blocked([p.id, ...lobby.members.map((m) => m.id)]);
      if (this.conflicts(p.id, lobby, blocked)) lobby = undefined;
    }
    if (!lobby) {
      lobby = this.create("again", null);
      lobby.fromRound = fromRound;
      lobby.expected = humans;
    }
    this.release(p.id, lobby.id);
    this.add(lobby, p);
    this.maybeStart(lobby);
    return this.view(lobby, p.id);
  }

  /** Host taps Start: bots fill the empty seats. */
  start(playerId: string): LobbyView {
    const lobby = this.lobbyOf(playerId);
    if (!lobby || lobby.kind !== "room") throw new MatchError("NO_ROOM", "You're not in a room");
    if (lobby.hostId !== playerId) throw new MatchError("NOT_HOST", "Only the host can start");
    if (lobby.status === "waiting") this.launch(lobby);
    return this.view(lobby, playerId);
  }

  /** Leaves the lobby (if still waiting). Rounds are left separately. */
  leave(playerId: string): void {
    this.release(playerId);
  }

  // ── Reading ────────────────────────────────────────────────────────────

  lobbyOf(playerId: string): Lobby | undefined {
    const id = this.tickets.get(playerId);
    return id ? this.lobbies.get(id) : undefined;
  }

  viewFor(playerId: string): LobbyView | null {
    const l = this.lobbyOf(playerId);
    return l ? this.view(l, playerId) : null;
  }

  /** Long poll: resolves when the player's lobby moves past `v`, or after `ms`. */
  wait(playerId: string, v: number, ms: number): Promise<LobbyView | null> {
    const lobby = this.lobbyOf(playerId);
    if (!lobby || lobby.v > v) return Promise.resolve(lobby ? this.view(lobby, playerId) : null);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        lobby.waiters.delete(done);
        resolve(this.viewFor(playerId));
      };
      const timer = setTimeout(done, ms);
      lobby.waiters.add(done);
    });
  }

  /** Timers: auto-starts, idle rooms, cleanup. Called every second. */
  tick(): void {
    const now = this.d.now();
    for (const l of this.lobbies.values()) {
      if (l.status === "waiting") {
        this.maybeStart(l);
        if (l.kind === "room") {
          // Empty for 2 minutes, or never started within 30.
          if ((l.members.length === 0 && now - l.createdAt > ROOM_EMPTY_MS) || now - l.createdAt > ROOM_MAX_WAIT_MS) this.end(l, "closed");
        } else if (l.members.length === 0) {
          this.end(l, "closed");
        }
      } else if (l.endedAt !== null && now - l.endedAt > KEEP_ENDED_MS) {
        this.lobbies.delete(l.id);
        if (l.code) this.codes.delete(l.code);
        for (const m of l.members) if (this.tickets.get(m.id) === l.id) this.tickets.delete(m.id);
      }
    }
    for (const [k, c] of this.blockCache) if (now - c.at > BLOCK_CACHE_MS) this.blockCache.delete(k);
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private create(kind: LobbyKind, code: string | null): Lobby {
    const lobby: Lobby = {
      id: `lb_${randomBytes(6).toString("hex")}`, kind, code, hostId: null, fromRound: null, expected: [],
      inviteId: null, members: [], createdAt: this.d.now(), firstAt: null, v: 0, status: "waiting",
      roundId: null, error: null, endedAt: null, waiters: new Set(),
    };
    this.lobbies.set(lobby.id, lobby);
    if (code) this.codes.set(code, lobby.id);
    return lobby;
  }

  private lobbyByCode(code: string): Lobby | undefined {
    const id = this.codes.get(code);
    return id ? this.lobbies.get(id) : undefined;
  }

  private add(lobby: Lobby, p: Seated): void {
    this.d.leaveRound(p.id);
    if (!lobby.members.some((m) => m.id === p.id)) lobby.members.push(p);
    lobby.firstAt ??= this.d.now();
    this.tickets.set(p.id, lobby.id);
    this.bump(lobby);
  }

  /** Takes the player out of whatever waiting lobby holds them (a new Play replaces the old one). */
  private release(playerId: string, keep?: string): void {
    const lobby = this.lobbyOf(playerId);
    if (!lobby || lobby.id === keep) return;
    this.tickets.delete(playerId);
    if (lobby.status !== "waiting") return;
    lobby.members = lobby.members.filter((m) => m.id !== playerId);
    if (lobby.hostId === playerId) lobby.hostId = lobby.members[0]?.id ?? null;
    if (lobby.members.length === 0) lobby.firstAt = null;
    this.bump(lobby);
  }

  private conflicts(player: string, lobby: Lobby, blocked: [string, string][]): boolean {
    return lobby.members.some(
      (m) => m.id !== player && (this.d.avoid.has(player, m.id) || blocked.some(([a, b]) => (a === player && b === m.id) || (b === player && a === m.id))),
    );
  }

  /** Zend blocks among these people. Fails open (logged), as Zend's own block check does. */
  private async blocked(ids: string[]): Promise<[string, string][]> {
    if (ids.length < 2) return [];
    const key = [...ids].sort().join(",");
    const hit = this.blockCache.get(key);
    if (hit && this.d.now() - hit.at < BLOCK_CACHE_MS) return hit.pairs;
    try {
      const pairs = await this.d.zend.blockedPairs(ids);
      this.blockCache.set(key, { at: this.d.now(), pairs });
      return pairs;
    } catch (e) {
      this.d.log("blocked_pairs_failed", { error: String((e as Error).message ?? e) });
      return [];
    }
  }

  private maybeStart(lobby: Lobby): void {
    if (lobby.status !== "waiting" || !lobby.members.length || lobby.firstAt === null) return;
    const now = this.d.now();
    const full = lobby.members.length >= this.d.cfg.roomSize;
    if (lobby.kind === "public" && (full || now - lobby.firstAt >= this.d.cfg.queueWaitMs)) this.launch(lobby);
    if (lobby.kind === "again") {
      const everyone = lobby.expected.every((id) => lobby.members.some((m) => m.id === id));
      if (full || everyone || now - lobby.firstAt >= this.d.cfg.rematchWaitMs) this.launch(lobby);
    }
  }

  private launch(lobby: Lobby): void {
    lobby.status = "starting";
    this.bump(lobby);
    const humans = [...lobby.members];
    this.d
      .startRound({ kind: lobby.kind, code: lobby.code, humans })
      .then((roundId) => {
        lobby.roundId = roundId;
        this.end(lobby, "started");
      })
      .catch((e) => {
        lobby.error = (e as { code?: string }).code ?? "START_FAILED";
        this.d.log("round_start_failed", { lobby: lobby.id, error: String((e as Error).message ?? e) });
        this.end(lobby, "failed");
      });
  }

  private end(lobby: Lobby, status: LobbyStatus): void {
    lobby.status = status;
    lobby.endedAt = this.d.now();
    this.bump(lobby);
  }

  private bump(lobby: Lobby): void {
    lobby.v += 1;
    for (const w of [...lobby.waiters]) w();
  }

  private view(l: Lobby, playerId: string): LobbyView {
    const now = this.d.now();
    const wait = l.kind === "public" ? this.d.cfg.queueWaitMs : l.kind === "again" ? this.d.cfg.rematchWaitMs : null;
    return {
      id: l.id, kind: l.kind, code: l.code, isHost: l.hostId === playerId,
      members: l.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar })),
      status: l.status,
      startsAt: l.status === "waiting" && wait !== null && l.firstAt !== null ? l.firstAt + wait : null,
      roundId: l.roundId, error: l.error, size: this.d.cfg.roomSize, v: l.v, now,
    };
  }

  /** The chat-tray invite shows "joined" once someone else is in the room. */
  private markInvite(l: Lobby): void {
    if (!l.inviteId || l.members.length < 2) return;
    const id = l.inviteId;
    l.inviteId = null;
    this.d.zend.setState(id, "joined").catch((e) => this.d.log("invite_mark_failed", { invite: id, error: String((e as Error).message ?? e) }));
  }
}
