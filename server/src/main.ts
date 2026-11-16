import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { DevZend } from "./devzend";
import { err, readBody, send } from "./http";
import { eventLog } from "./store";
import { verifyToken } from "./token";
import { RealZend } from "./zend";

const cfg = loadConfig();
const log = eventLog(cfg.dataDir);
const dev = cfg.dev
  ? new DevZend((t) => {
      const c = verifyToken(cfg.sessionSecret, t);
      return c ? { id: c.id, name: c.name, avatar: c.avatar } : null;
    })
  : null;
const zend = dev ?? new RealZend(cfg.zendAppKey, cfg.zendApi);
const app = createApp({ cfg, zend, dev, log });

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

const webRoot = cfg.webDir ? resolve(cfg.webDir) : null;
const pageHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  // Only Zend may frame the page (web host); the mobile WebView isn't a frame.
  "content-security-policy": `frame-ancestors 'self' ${cfg.frameAncestors.join(" ")}`,
};

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (!webRoot || (req.method !== "GET" && req.method !== "HEAD")) return false;
  const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
  let file = join(webRoot, rel);
  if (file !== webRoot && !file.startsWith(webRoot + sep)) return false;
  let st = statSync(file, { throwIfNoEntry: false });
  // A missing hashed asset is a 404, never the page (it would be cached as JS).
  if (!st && rel.startsWith("assets")) return false;
  // Unknown paths are screens of the page (`/?room=…` and friends): serve the app.
  if (!st || st.isDirectory()) {
    file = join(webRoot, "index.html");
    st = statSync(file, { throwIfNoEntry: false });
    if (!st) return false;
  }
  const hashed = /\/assets\//.test(file);
  res.writeHead(200, {
    ...pageHeaders,
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": String(st.size),
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}

function cors(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !(cfg.corsOrigins.includes(origin) || (cfg.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://owambe");
  const path = url.pathname;
  const extra = cors(req);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, extra);
      res.end();
      return;
    }
    const hit = app.router.match(req.method ?? "GET", path);
    if (!hit) {
      if (path.startsWith("/api/") || path.startsWith("/zend/") || !serveStatic(req, res, path)) send(res, err(404, "NOT_FOUND", "Not found"), extra);
      return;
    }
    const raw = req.method === "POST" ? await readBody(req) : "";
    let body: Record<string, unknown> = {};
    if (raw && !path.startsWith("/zend/")) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch {
        send(res, err(400, "BAD_REQUEST", "Body must be JSON"), extra);
        return;
      }
    }
    const fwd = req.headers["x-forwarded-for"];
    const ip = (typeof fwd === "string" ? fwd.split(",")[0]!.trim() : null) ?? req.socket.remoteAddress ?? "";
    const out = await hit.handler({ method: req.method ?? "GET", path, params: hit.params, query: url.searchParams, headers: req.headers, ip, raw, body });
    if (!res.headersSent) send(res, out, extra);
  } catch (e) {
    const tooLarge = (e as { code?: string }).code === "TOO_LARGE";
    if (!tooLarge) console.error(JSON.stringify({ at: "request_failed", path, error: String((e as Error).stack ?? e) }));
    if (!res.headersSent) send(res, tooLarge ? err(413, "TOO_LARGE", "Too large") : err(500, "INTERNAL", "That didn't go through. Try again."), extra);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (!dev?.upgrade(req, socket, head)) socket.destroy();
});

const timer = setInterval(() => app.tick(), 1000);
server.listen(cfg.port, () => {
  console.log(JSON.stringify({ at: "listening", port: cfg.port, dev: cfg.dev, web: webRoot }));
});

function shutdown() {
  clearInterval(timer);
  app.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
