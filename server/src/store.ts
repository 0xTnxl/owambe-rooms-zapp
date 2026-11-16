import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Log = (type: string, fields: Record<string, unknown>) => void;

/**
 * Append-only JSON lines in `data/events.jsonl`: metrics and reports (PRD success metrics).
 * One process for v1; move to Postgres when there is more than one.
 */
export function eventLog(dir: string | null): Log {
  if (!dir) return () => {};
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "events.jsonl");
  return (type, fields) => {
    try {
      appendFileSync(file, `${JSON.stringify({ type, at: new Date().toISOString(), ...fields })}\n`);
    } catch (e) {
      console.error(JSON.stringify({ at: "event_log_failed", type, error: String(e) }));
    }
  };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** People who asked not to be matched again (or reported someone). Symmetric. */
export class AvoidStore {
  private pairs = new Set<string>();
  private file: string | null;

  constructor(dir: string | null) {
    this.file = dir ? join(dir, "avoid.json") : null;
    if (!this.file) return;
    try {
      for (const k of JSON.parse(readFileSync(this.file, "utf8")) as string[]) this.pairs.add(k);
    } catch {
      // No file yet.
    }
  }

  has(a: string, b: string): boolean {
    return this.pairs.has(pairKey(a, b));
  }

  add(a: string, b: string): void {
    if (a === b || this.has(a, b)) return;
    this.pairs.add(pairKey(a, b));
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.pairs]));
    renameSync(tmp, this.file);
  }
}
