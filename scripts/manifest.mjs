// Prints zapp.json for one deploy: `OWAMBE_ORIGIN=owambe.example.com pnpm -s manifest > manifest.json`
// then upload it with `PUT /api/zend/v2/apps/:id/manifest`.
import { readFileSync } from "node:fs";

const origin = (process.env.OWAMBE_ORIGIN ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
if (!/^[a-z0-9.-]+(:\d+)?$/i.test(origin)) {
  console.error("Set OWAMBE_ORIGIN to the game's host, e.g. owambe.example.com");
  process.exit(1);
}
const raw = readFileSync(new URL("../zapp.json", import.meta.url), "utf8");
process.stdout.write(raw.replaceAll("OWAMBE_ORIGIN", origin));
