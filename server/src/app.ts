import { verifyWebhook } from "@zendfi/appkit/server";
import type { ServerConfig } from "./config";
import { type DevZend } from "./devzend";
import { err, type Handler, Limiter, ok, type Req, type Res, Router, str } from "./http";
import { MatchError, Matchmaker } from "./matchmaker";
import { Rounds, type Seated } from "./rounds";
import { AvoidStore, type Log } from "./store";
import { type Claims, newSid, signToken, verifyToken } from "./token";
import type { ZendPort } from "./zend";

export interface App {
  router: Router;
  rounds: Rounds;
  match: Matchmaker;
  tick(): void;
  stop(): void;
}

const REPORT_REASONS = ["rude", "harassment", "cheating", "spam", "underage", "other"] as const;

export function createApp(deps: { cfg: ServerConfig; zend: ZendPort; dev: DevZend | null; log: Log; now?: () => number }): App {
  const { cfg, zend, log } = deps;
  const now = deps.now ?? Date.now;
  const avoid = new AvoidStore(cfg.dev ? null : cfg.dataDir);
  const rounds = new Rounds({ cfg, zend, log, now });
  const match = new Matchmaker({
    cfg, zend, avoid, log, now,
    startRound: (p) => rounds.start(p),
    leaveRound: (player) => rounds.leave(player),
  });
  const limits = new Limiter();
  const router = new Router();

  const auth = (req: Req): Claims | null => {
    const h = req.headers.authorization;
    const t = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : null;
    return t ? verifyToken(cfg.sessionSecret, t, now()) : null;
  };
  const seated = (c: Claims): Seated => ({ id: c.id, name: c.name, avatar: c.avatar, sid: c.sid });

  /** Signed-in routes, with a per-player rate limit. */
  const signedIn = (max: number, fn: (c: Claims, req: Req) => Promise<Res> | Res): Handler => async (req) => {
    const c = auth(req);
    if (!c) return err(401, "SIGN_IN", "Sign in again");
    if (!limits.allow(`${c.id}:${req.path.split("/")[2]}`, max, 60_000, now())) return err(429, "SLOW_DOWN", "Slow down a little");
    try {
      return await fn(c, req);
    } catch (e) {
      if (e instanceof MatchError) return err(409, e.code, e.message);
      throw e;
    }
  };

  const session = (p: { id: string; name: string; avatar: string | null }) => {
    const sid = newSid();
    log("session", { player: p.id, sid });
    return ok({ token: signToken(cfg.sessionSecret, p, sid, now()), player: p });
  };

  // ── Sign-in ─────────────────────────────────────────────────────────────

  router.on("POST", "/api/session", async (req) => {
    if (!limits.allow(`session:${req.ip}`, 30, 60_000, now())) return err(429, "SLOW_DOWN", "Slow down a little");
    const appSession = str(req.body.appSession, 4096);
    if (!appSession) return err(400, "BAD_REQUEST", "appSession is required");
    try {
      return session(await zend.verifySession(appSession));
    } catch (e) {
      log("verify_failed", { code: (e as { code?: string }).code ?? null });
      return err(401, "SIGN_IN", "Open Owambe from Zend and try again");
    }
  });

  if (cfg.dev) {
    // Local play only: pick a name, get a session. Never enabled in production (see config).
    router.on("POST", "/api/dev/session", (req) => {
      const name = (str(req.body.name, 24) ?? "Player").replace(/[^\p{L}\p{N} '.-]/gu, "").trim() || "Player";
      const key = Buffer.from(name.toLowerCase()).toString("hex").slice(0, 20).padEnd(20, "0");
      return session({ id: `zu_dev${key}`, name, avatar: null });
    });
  }

  // ── Lobbies ─────────────────────────────────────────────────────────────

  router.on("POST", "/api/play", signedIn(30, async (c, req) => {
    const mode = req.body.mode;
    if (mode === "public") return ok(await match.playPublic(seated(c)));
    if (mode === "room") {
      const code = str(req.body.code, 12);
      if (!code) return err(400, "BAD_REQUEST", "code is required");
      return ok(await match.joinRoom(seated(c), code, req.body.via === "link" ? "link" : null));
    }
    if (mode === "again") {
      const id = str(req.body.round, 64);
      const r = id ? rounds.get(id) : undefined;
      if (!r) return err(404, "NO_ROUND", "That round is over");
      return ok(await match.playAgain(seated(c), r.id, [...r.humans.keys()]));
    }
    return err(400, "BAD_REQUEST", "mode must be public, room or again");
  }));

  router.on("POST", "/api/rooms", signedIn(10, async (c, req) => {
    // From the chat tray: the room is for this invite, whose card turns to "joined".
    const invite = str(req.body.invite, 64);
    const inviteId = invite && (await zend.isInvite(invite, c.id)) ? invite : null;
    return ok(match.createRoom(seated(c), inviteId));
  }));

  router.on("POST", "/api/rooms/start", signedIn(10, (c) => ok(match.start(c.id))));

  router.on("GET", "/api/lobby", signedIn(120, async (c, req) => {
    const v = Number(req.query.get("v") ?? "-1");
    const view = await match.wait(c.id, Number.isFinite(v) ? v : -1, 25_000);
    return ok({ lobby: view });
  }));

  router.on("POST", "/api/leave", signedIn(30, (c) => {
    match.leave(c.id);
    rounds.leave(c.id);
    return ok({ ok: true });
  }));

  // ── Rounds ──────────────────────────────────────────────────────────────

  const inRound = (c: Claims, id: unknown) => {
    const r = typeof id === "string" ? rounds.get(id) : undefined;
    return r && r.humans.has(c.id) ? r : null;
  };

  router.on("GET", "/api/round/:id", signedIn(60, (c, req) => {
    const r = inRound(c, req.params.id);
    if (!r) return err(404, "NO_ROUND", "That round is over");
    const snap = r.snapshotFrame(now());
    return ok({ round: snap.round, added: snap.added, humans: [...r.humans.keys()], kind: r.meta.kind, code: r.meta.code });
  }));

  router.on("POST", "/api/vote", signedIn(30, (c, req) => {
    const r = inRound(c, req.body.round);
    if (!r) return err(404, "NO_ROUND", "That round is over");
    const forId = str(req.body.for, 64);
    if (!forId) return err(400, "BAD_REQUEST", "for is required");
    const res = r.vote(c.id, forId);
    return res.ok ? ok({ ok: true }) : err(409, res.code, "That vote didn't count");
  }));

  router.on("POST", "/api/report", signedIn(10, (c, req) => {
    const r = inRound(c, req.body.round);
    const target = str(req.body.target, 64);
    const reason = REPORT_REASONS.find((x) => x === req.body.reason);
    if (!r || !target || !r.humans.has(target) || target === c.id || !reason) return err(400, "BAD_REQUEST", "Can't report that");
    const detail = str(req.body.detail, 280);
    avoid.add(c.id, target);
    log("report", { round: r.id, from: c.id, target, reason, detail });
    return ok({ ok: true });
  }));

  router.on("POST", "/api/avoid", signedIn(20, (c, req) => {
    const r = inRound(c, req.body.round);
    const target = str(req.body.target, 64);
    if (!r || !target || !r.humans.has(target) || target === c.id) return err(400, "BAD_REQUEST", "Can't do that");
    avoid.add(c.id, target);
    log("avoid", { round: r.id, from: c.id, target });
    return ok({ ok: true });
  }));

  // ── Zend ────────────────────────────────────────────────────────────────

  router.on("POST", "/zend/webhook", (req) => {
    const sig = req.headers["x-zend-signature"];
    if (cfg.dev || typeof sig !== "string" || !verifyWebhook(req.raw, sig, cfg.webhookSecret)) return err(401, "BAD_SIGNATURE", "Bad signature");
    let event: { id?: string; type?: string; data?: Record<string, unknown> };
    try {
      event = JSON.parse(req.raw);
    } catch {
      return err(400, "BAD_REQUEST", "Bad JSON");
    }
    if (event.type === "people.connected" && event.data) {
      const d = event.data;
      log("friend_add", { event: event.id ?? null, from: d.from, to: d.to, round: d.interaction_id, mutual: d.mutual === true });
      const r = typeof d.interaction_id === "string" ? rounds.get(d.interaction_id) : undefined;
      if (r && typeof d.from === "string" && typeof d.to === "string") r.recordAdd(d.from, d.to);
    }
    return ok({ ok: true });
  });

  router.on("GET", "/healthz", () => ok({ ok: true }));

  router.on("GET", "/api/config", () => ok({ dev: cfg.dev, slug: cfg.slug, labelBots: cfg.labelBots, roundSecs: cfg.game.playMs / 1000 }));

  router.on("GET", "/api/me", signedIn(60, (c) => ok({ player: { id: c.id, name: c.name, avatar: c.avatar } })));

  return {
    router, rounds, match,
    tick() {
      match.tick();
      rounds.sweep(now());
      limits.sweep(now());
    },
    stop() {
      rounds.stopAll();
    },
  };
}
