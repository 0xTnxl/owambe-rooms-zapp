import type { IncomingMessage, ServerResponse } from "node:http";

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  ip: string;
  /** Raw body (webhooks need the exact bytes for the signature). */
  raw: string;
  body: Record<string, unknown>;
}

export interface Res {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (req: Req) => Promise<Res> | Res;

export const ok = (body: unknown): Res => ({ status: 200, body });
export const err = (status: number, code: string, message: string): Res => ({ status, body: { error: code, message } });

const MAX_BODY = 16 * 1024;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const segs = path.split("/").filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      const hit = r.parts.every((p, i) => {
        const s = segs[i]!;
        if (p.startsWith(":")) {
          params[p.slice(1)] = decodeURIComponent(s);
          return true;
        }
        return p === s;
      });
      if (hit) return { handler: r.handler, params };
    }
    return null;
  }
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function send(res: ServerResponse, r: Res, extra: Record<string, string> = {}): void {
  const body = r.body === undefined ? "" : JSON.stringify(r.body);
  res.writeHead(r.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
    ...r.headers,
  });
  res.end(body);
}

/** Fixed-window counters, in memory. */
export class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();

  allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now >= h.reset) {
      this.hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= max;
  }

  sweep(now = Date.now()): void {
    for (const [k, h] of this.hits) if (now >= h.reset) this.hits.delete(k);
  }
}

export const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
