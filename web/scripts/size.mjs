// Size budgets, gzipped:
// - first paint (index.html plus the JS and CSS it loads up front): 60 KB, so Home opens fast on
//   a slow connection;
// - the party (three.js, the scene, the soundtrack), loaded on demand and cached: 220 KB.
// Fonts are not counted: they load in the background and the page shows system text until then.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const FIRST = 60 * 1024;
const LAZY = 220 * 1024;
const dir = new URL("../dist", import.meta.url).pathname;
const html = readFileSync(join(dir, "index.html"), "utf8");
const upfront = new Set([...html.matchAll(/(?:src|href)="\/?([^"]+\.(?:js|css))"/g)].map((m) => m[1]));
let first = 0;
let lazy = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html)$/.test(f)) {
      const rel = p.slice(dir.length + 1);
      const gz = gzipSync(readFileSync(p)).length;
      const now = f === "index.html" || upfront.has(rel);
      if (now) first += gz;
      else lazy += gz;
      console.log(`${(gz / 1024).toFixed(1).padStart(6)} KB  ${now ? "first " : "lazy  "} ${rel}`);
    }
  }
};
walk(dir);
console.log(`${(first / 1024).toFixed(1).padStart(6)} KB  first paint (limit ${FIRST / 1024} KB)`);
console.log(`${(lazy / 1024).toFixed(1).padStart(6)} KB  party, on demand (limit ${LAZY / 1024} KB)`);
if (first > FIRST || lazy > LAZY) {
  console.error("The page is over its size budget.");
  process.exit(1);
}
