import type { Log } from "./store";

/**
 * Keeps a host that sleeps idle services (Render's free plan sleeps after 15 minutes without
 * inbound requests) awake by calling this server's own public URL. The request goes out through
 * the host's front door, so it counts as inbound traffic. Works on any host: set KEEPALIVE_URL,
 * or on Render it uses RENDER_EXTERNAL_URL. Off when neither is set, or KEEPALIVE_MINS=0.
 */
export function startKeepAlive(env: NodeJS.ProcessEnv, log: Log): (() => void) | null {
  const base = (env.KEEPALIVE_URL ?? env.RENDER_EXTERNAL_URL ?? "").replace(/\/+$/, "");
  const mins = Number(env.KEEPALIVE_MINS ?? "10");
  if (!/^https?:\/\//.test(base) || !Number.isFinite(mins) || mins <= 0) return null;
  // Under the 15-minute window even with a slow request and a missed beat.
  const every = Math.min(mins, 14) * 60_000;
  const url = `${base}/healthz?ping=keepalive`;
  let failures = 0;

  const ping = async () => {
    const started = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "owambe-keepalive" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (failures) console.log(JSON.stringify({ at: "keepalive_recovered", after: failures }));
      failures = 0;
    } catch (e) {
      failures += 1;
      console.warn(JSON.stringify({ at: "keepalive_failed", failures, ms: Date.now() - started, error: String((e as Error).message ?? e) }));
      if (failures === 3) log("keepalive_failing", { url: base, failures });
    }
  };

  // First beat after a minute, so it doesn't race the host's own health check during a deploy.
  const first = setTimeout(() => void ping(), 60_000);
  const timer = setInterval(() => void ping(), every);
  first.unref();
  timer.unref();
  console.log(JSON.stringify({ at: "keepalive_on", url: base, everyMins: every / 60_000 }));
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
