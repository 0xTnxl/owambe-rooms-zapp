// Fails the build if the page's JS + CSS is over 80 KB gzipped (spec R8.1).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const LIMIT = 80 * 1024;
const dir = new URL("../dist", import.meta.url).pathname;
let total = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html)$/.test(f)) {
      const gz = gzipSync(readFileSync(p)).length;
      total += gz;
      console.log(`${(gz / 1024).toFixed(1).padStart(6)} KB  ${p.slice(dir.length + 1)}`);
    }
  }
};
walk(dir);
console.log(`${(total / 1024).toFixed(1).padStart(6)} KB  total gzipped (limit ${LIMIT / 1024} KB)`);
if (total > LIMIT) {
  console.error("Page is over its size budget.");
  process.exit(1);
}
