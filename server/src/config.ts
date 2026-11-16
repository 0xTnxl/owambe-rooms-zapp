import { type Config, DEFAULT_CONFIG } from "@owambe/engine";

export interface ServerConfig {
  port: number;
  /** Local play without Zend: dev sign-in and an in-process copy of Zend's live rooms. */
  dev: boolean;
  zendApi: string;
  zendAppKey: string;
  webhookSecret: string;
  sessionSecret: string;
  slug: string;
  /** Built page to serve from this server (one origin for page and API), or null. */
  webDir: string | null;
  dataDir: string;
  /** Extra origins allowed to call the API from a browser (when the page is hosted elsewhere). */
  corsOrigins: string[];
  frameAncestors: string[];
  roomSize: number;
  queueWaitMs: number;
  rematchWaitMs: number;
  labelBots: boolean;
  game: Config;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dev = env.OWAMBE_DEV === "1";
  const cfg: ServerConfig = {
    port: num(env.PORT, 8787),
    dev,
    zendApi: env.ZEND_API ?? "https://api.usezend.app",
    zendAppKey: env.ZEND_APP_KEY ?? "",
    webhookSecret: env.ZEND_WEBHOOK_SECRET ?? "",
    sessionSecret: env.SESSION_SECRET ?? (dev ? "dev-only-session-secret-not-for-production!!" : ""),
    slug: env.ZEND_APP_SLUG ?? "owambe",
    webDir: env.WEB_DIR ?? null,
    dataDir: env.DATA_DIR ?? "data",
    corsOrigins: list(env.CORS_ORIGINS),
    frameAncestors: list(env.FRAME_ANCESTORS ?? "https://app.usezend.app"),
    roomSize: Math.min(6, Math.max(2, num(env.ROOM_SIZE, 6))),
    queueWaitMs: num(env.QUEUE_WAIT_SECS, 8) * 1000,
    rematchWaitMs: num(env.REMATCH_WAIT_SECS, 12) * 1000,
    labelBots: env.LABEL_BOTS !== "0",
    game: {
      ...DEFAULT_CONFIG,
      readyMs: num(env.READY_SECS, 5) * 1000,
      playMs: num(env.ROUND_SECS, 120) * 1000,
      voteMs: num(env.VOTE_SECS, 20) * 1000,
      resultsMs: num(env.RESULTS_SECS, 45) * 1000,
    },
  };
  // Fail closed: production needs real keys and a real secret.
  const missing: string[] = [];
  if (cfg.sessionSecret.length < 32) missing.push("SESSION_SECRET (32+ characters)");
  if (!dev && !cfg.zendAppKey.startsWith("zapp_sk_")) missing.push("ZEND_APP_KEY");
  if (!dev && !cfg.webhookSecret) missing.push("ZEND_WEBHOOK_SECRET");
  if (missing.length) throw new Error(`Missing config: ${missing.join(", ")}`);
  return cfg;
}
