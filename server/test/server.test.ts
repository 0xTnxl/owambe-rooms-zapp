import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { Req } from "../src/http";
import { Matchmaker } from "../src/matchmaker";
import { Rounds } from "../src/rounds";
import { AvoidStore } from "../src/store";
import { signToken, verifyToken } from "../src/token";
import { handleFrame, type RoomHandlers, type ZendPort } from "../src/zend";

const SECRET = "test-secret-test-secret-test-secret!!";
const cfg = loadConfig({
  OWAMBE_DEV: "0", SESSION_SECRET: SECRET, ZEND_APP_KEY: "zapp_sk_test", ZEND_WEBHOOK_SECRET: "whsec",
  DATA_DIR: "", ROUND_SECS: "60",
});

class FakeZend implements ZendPort {
  rooms = new Map<string, { h: RoomHandlers; sent: unknown[] }>();
  states: [string, string][] = [];
  blocks: [string, string][] = [];
  created: { createdBy: string; participants: string[] }[] = [];
  n = 0;
  async verifySession(s: string) {
    if (s !== "good") throw Object.assign(new Error("bad"), { code: "INVALID_APP_SESSION" });
    return { id: "zu_aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ada", avatar: null };
  }
  async createRound(p: { createdBy: string; participants: string[] }) {
    this.created.push(p);
    return `int_test${++this.n}`;
  }
  async setState(id: string, s: string) {
    this.states.push([id, s]);
  }
  async blockedPairs(ids: string[]) {
    return this.blocks.filter(([a, b]) => ids.includes(a) && ids.includes(b));
  }
  async isInvite() {
    return false;
  }
  openRoom(id: string, h: RoomHandlers) {
    const room = { h, sent: [] as unknown[] };
    this.rooms.set(id, room);
    return { send: (d: unknown) => (room.sent.push(d), true), close() {} };
  }
}

const p = (id: string) => ({ id, name: id.toUpperCase(), avatar: null, sid: `s_${id}` });
const flush = () => new Promise((r) => setTimeout(r, 0));
const live: Rounds[] = [];
afterEach(() => {
  for (const r of live.splice(0)) r.stopAll();
});

function harness() {
  let t = 1_000_000;
  const zend = new FakeZend();
  const log: { type: string; f: Record<string, unknown> }[] = [];
  const deps = { cfg, zend, log: (type: string, f: Record<string, unknown>) => void log.push({ type, f }), now: () => t };
  const rounds = new Rounds(deps);
  live.push(rounds);
  const avoid = new AvoidStore(null);
  const match = new Matchmaker({ ...deps, avoid, startRound: (x) => rounds.start(x), leaveRound: (x) => rounds.leave(x) });
  return { zend, rounds, match, avoid, log, advance: (ms: number) => (t += ms), now: () => t };
}

describe("game tokens", () => {
  it("round-trip, refuse tampering and expire", () => {
    const tok = signToken(SECRET, { id: "zu_x", name: "X", avatar: null }, "sid1", 0);
    expect(verifyToken(SECRET, tok, 1000)?.id).toBe("zu_x");
    expect(verifyToken("other-secret-other-secret-other!!", tok, 1000)).toBeNull();
    const [body, sig] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ id: "zu_y", exp: 9e9 })).toString("base64url");
    expect(verifyToken(SECRET, `${forged}.${sig}`, 1000)).toBeNull();
    expect(verifyToken(SECRET, `${body}.${sig}`, 13 * 3600 * 1000)).toBeNull();
  });
});

describe("config", () => {
  it("fails closed without production keys", () => {
    expect(() => loadConfig({})).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ SESSION_SECRET: SECRET })).toThrow(/ZEND_APP_KEY/);
  });
});

describe("matchmaker", () => {
  it("starts a public room after 8 s with bots filling the seats", async () => {
    const h = harness();
    await h.match.playPublic(p("a"));
    await h.match.playPublic(p("b"));
    h.match.tick();
    expect(h.zend.created).toHaveLength(0);
    h.advance(8_000);
    h.match.tick();
    await flush();
    expect(h.zend.created).toMatchObject([{ createdBy: "a", participants: ["b"], data: { kind: "public" } }]);
    const view = h.match.viewFor("a")!;
    expect(view.status).toBe("started");
    const r = h.rounds.get(view.roundId!)!;
    expect(r.round.seats).toHaveLength(6);
    expect(r.round.seats.filter((s) => s.bot)).toHaveLength(4);
  });

  it("starts at once when 6 people wait", async () => {
    const h = harness();
    for (const id of ["a", "b", "c", "d", "e", "f"]) await h.match.playPublic(p(id));
    await flush();
    expect(h.zend.created).toHaveLength(1);
    expect(h.zend.created[0]!.participants).toHaveLength(5);
  });

  it("never seats a blocked or avoided pair together", async () => {
    const h = harness();
    h.zend.blocks.push(["b", "a"]);
    h.avoid.add("c", "a");
    await h.match.playPublic(p("a"));
    await h.match.playPublic(p("b"));
    await h.match.playPublic(p("c"));
    await h.match.playPublic(p("d"));
    expect(h.match.viewFor("a")!.id).not.toBe(h.match.viewFor("b")!.id);
    expect(h.match.viewFor("a")!.id).not.toBe(h.match.viewFor("c")!.id);
    expect(h.match.viewFor("d")!.id).toBe(h.match.viewFor("a")!.id);
  });

  it("keeps one ticket per player", async () => {
    const h = harness();
    const room = h.match.createRoom(p("host"));
    await h.match.joinRoom(p("a"), room.code!, null);
    await h.match.playPublic(p("a"));
    expect(h.match.viewFor("host")!.members.map((m) => m.id)).toEqual(["host"]);
    expect(h.match.viewFor("a")!.kind).toBe("public");
  });

  it("private rooms: codes, host start, full and started rooms", async () => {
    const h = harness();
    const room = h.match.createRoom(p("host"));
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(h.match.joinRoom(p("x"), "NOPE00", null)).rejects.toMatchObject({ code: "NO_ROOM" });
    await h.match.joinRoom(p("a"), room.code!.toLowerCase(), "link");
    expect(h.log.some((l) => l.type === "invite_join")).toBe(true);
    expect(() => h.match.start("a")).toThrow(/host/);
    h.match.start("host");
    await flush();
    await expect(h.match.joinRoom(p("late"), room.code!, null)).rejects.toMatchObject({ code: "ROOM_STARTED" });
    expect(h.zend.created).toHaveLength(1);
    expect(h.match.viewFor("a")!.status).toBe("started");
  });

  it("rematch starts as soon as everyone from the round is back", async () => {
    const h = harness();
    await h.match.playAgain(p("a"), "int_old", ["a", "b"]);
    expect(h.zend.created).toHaveLength(0);
    await h.match.playAgain(p("b"), "int_old", ["a", "b"]);
    await flush();
    expect(h.zend.created).toHaveLength(1);
    await expect(h.match.playAgain(p("z"), "int_old", ["a", "b"])).rejects.toMatchObject({ code: "NOT_IN_ROUND" });
  });
});

describe("round runner", () => {
  async function liveRound() {
    const h = harness();
    const id = await h.rounds.start({ kind: "public", code: null, humans: [p("a"), p("b")] });
    const r = h.rounds.get(id)!;
    r.stop(); // drive time by hand
    const room = h.zend.rooms.get(id)!;
    room.h.presence(["a", "b"]);
    h.advance(cfg.game.readyMs);
    r.step();
    return { h, r, room, id };
  }

  it("applies actions only from people in the round, stamped by Zend", async () => {
    const { h, r, room } = await liveRound();
    room.h.message("app", { t: "gift", to: "b", item: "jet" });
    room.h.message("zu_stranger", { t: "gift", to: "b", item: "jet" });
    expect(r.round.seats.find((s) => s.id === "b")!.bag).toBe(cfg.game.startBag);
    room.h.message("a", { t: "gift", to: "b", item: "jet" });
    expect(r.round.seats.find((s) => s.id === "b")!.bag).toBe(cfg.game.startBag + 20e9);
    room.h.message("a", { t: "gift", to: "a", item: "jet" });
    h.advance(250);
    r.step();
    expect(room.sent).toContainEqual({ t: "err", to: "a", code: "SELF" });
  });

  it("drops more than 8 actions a second from one person", async () => {
    const { r, room } = await liveRound();
    for (let i = 0; i < 20; i++) room.h.message("a", { t: "gift", to: "b", item: "jollof" });
    expect(r.round.seats.find((s) => s.id === "a")!.given).toBe(5 * 2e6); // 8 allowed, cap stops at 5
    const other = r.round.seats.find((s) => s.bot)!.id;
    for (let i = 0; i < 5; i++) room.h.message("a", { t: "gift", to: other, item: "jollof" });
    expect(r.round.seats.find((s) => s.id === "a")!.given).toBe(5 * 2e6);
  });

  it("stays under Zend's frame limits and mirrors phases to the interaction", async () => {
    const { h, r, room, id } = await liveRound();
    let maxPerSec = 0;
    for (let s = 0; s < 70; s++) {
      const before = room.sent.length;
      for (let i = 0; i < 10; i++) {
        h.advance(100);
        room.h.message("a", { t: "react", r: "😂" });
        r.step();
      }
      maxPerSec = Math.max(maxPerSec, room.sent.length - before);
    }
    expect(maxPerSec).toBeLessThanOrEqual(18);
    for (const f of room.sent) expect(JSON.stringify(f).length).toBeLessThan(8 * 1024);
    expect(r.round.phase).toBe("voting");
    r.vote("a", "b");
    r.vote("b", "a");
    h.advance(100);
    r.step();
    expect(r.round.phase).toBe("results");
    h.advance(cfg.game.resultsMs);
    r.step();
    await flush();
    expect(h.zend.states.filter(([i]) => i === id).map(([, s]) => s)).toEqual(["voting", "results", "done"]);
    expect(h.log.find((l) => l.type === "round_finished")).toBeTruthy();
  });

  it("records friend adds between people in the round only", async () => {
    const { r, room } = await liveRound();
    room.h.message("a", { t: "added", to: "b" });
    room.h.message("a", { t: "added", to: "b" });
    room.h.message("a", { t: "added", to: "zu_nobody" });
    expect(r.addsFor()).toEqual([["a", "b"]]);
  });
});

describe("zend frames", () => {
  it("maps Zend's live frames", () => {
    const got: unknown[] = [];
    const h: RoomHandlers = { message: (f, d) => got.push(["m", f, d]), presence: (ids) => got.push(["p", ids]), closed: (r) => got.push(["c", r]) };
    handleFrame(JSON.stringify({ type: "live_message", interaction_id: "i", from: "zu_a", data: { t: "react" }, at: "" }), h);
    handleFrame(JSON.stringify({ type: "live_presence", interaction_id: "i", members: [{ app_user_id: "zu_a" }] }), h);
    expect(handleFrame(JSON.stringify({ type: "live_closed", interaction_id: "i", reason: "done" }), h)).toBe("closed");
    handleFrame("not json", h);
    expect(got).toEqual([["m", "zu_a", { t: "react" }], ["p", ["zu_a"]], ["c", "done"]]);
  });
});

describe("api", () => {
  const req = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}, raw = ""): Req => ({
    method: "POST", path, params: {}, query: new URLSearchParams(), headers, ip: "1.1.1.1", raw, body,
  });

  it("signs in through Zend and refuses bad sessions", async () => {
    const app = createApp({ cfg, zend: new FakeZend(), dev: null, log: () => {} });
    const route = app.router.match("POST", "/api/session")!;
    expect((await route.handler(req("/api/session", { appSession: "bad" }))).status).toBe(401);
    const res = await route.handler(req("/api/session", { appSession: "good" }));
    expect(res.status).toBe(200);
    const token = (res.body as { token: string }).token;
    const play = app.router.match("POST", "/api/play")!;
    expect((await play.handler(req("/api/play", { mode: "public" }))).status).toBe(401);
    const ok = await play.handler(req("/api/play", { mode: "public" }, { authorization: `Bearer ${token}` }));
    expect(ok.status).toBe(200);
    expect(app.router.match("POST", "/api/dev/session")).toBeNull();
  });

  it("checks webhook signatures", async () => {
    const log: string[] = [];
    const app = createApp({ cfg, zend: new FakeZend(), dev: null, log: (t) => void log.push(t) });
    const hook = app.router.match("POST", "/zend/webhook")!;
    const raw = JSON.stringify({ id: "ev1", type: "people.connected", data: { from: "a", to: "b", interaction_id: "int_x", mutual: true } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec").update(`${t}.${raw}`).digest("hex");
    expect((await hook.handler(req("/zend/webhook", {}, { "x-zend-signature": `t=${t},v1=${"0".repeat(64)}` }, raw))).status).toBe(401);
    expect((await hook.handler(req("/zend/webhook", {}, { "x-zend-signature": `t=${t},v1=${sig}` }, raw))).status).toBe(200);
    expect(log).toContain("friend_add");
  });
});
