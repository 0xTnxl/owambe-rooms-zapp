import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface Player {
  /** Zend appUserId (`zu_…`), or `zu_dev…` in dev. */
  id: string;
  name: string;
  avatar: string | null;
}

export interface Claims extends Player {
  /** One sign-in: "second round in the same session" is counted per sid. */
  sid: string;
  iat: number;
  exp: number;
}

const TTL_SECS = 12 * 3600;
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function newSid(): string {
  return randomBytes(9).toString("base64url");
}

/** `base64url(json).base64url(hmac)`. Stateless: nothing to store or expire server-side. */
export function signToken(secret: string, p: Player, sid: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const claims: Claims = { id: p.id, name: p.name, avatar: p.avatar, sid, iat, exp: iat + TTL_SECS };
  const body = b64(JSON.stringify(claims));
  return `${body}.${b64(createHmac("sha256", secret).update(body).digest())}`;
}

export function verifyToken(secret: string, token: string, nowMs = Date.now()): Claims | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || token.length > 4096) return null;
  const want = createHmac("sha256", secret).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    if (typeof c.id !== "string" || typeof c.exp !== "number" || c.exp * 1000 <= nowMs) return null;
    return c;
  } catch {
    return null;
  }
}
