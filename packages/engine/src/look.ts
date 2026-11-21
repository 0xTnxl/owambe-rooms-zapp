import type { Rng } from "./rng";

/**
 * A guest's outfit, shared by the page (to draw it) and the server (to check it). Cosmetic only:
 * it never changes the rules. Encoded as a version digit plus one base-36 digit per part, e.g.
 * "241210063001", so it fits in every room frame.
 */
export interface Look {
  skin: number;
  body: number;
  hair: number;
  head: number;
  outfit: number;
  color: number;
  accent: number;
  extra: number;
  dance: number;
  print: number;
}

export const SKIN = ["#F1C9A5", "#E0B08A", "#C98E64", "#B07850", "#8D5A3B", "#6B4226", "#553420", "#3E2716"] as const;

/** Aso-ebi colours: Zend's people tints plus the deep party colours. */
export const ASO = [
  "#F4B740", "#8DBDEB", "#93CBA0", "#F2A08B", "#C9AAF0", "#F5C3D2",
  "#0F5C4A", "#7A1F3D", "#1F3A93", "#E8B98A", "#FFFEFC", "#2B2A27",
] as const;

export const BODIES = ["Slim", "Regular", "Big"] as const;
export const HAIRS = ["Low cut", "Afro", "Braids", "Bun", "Locs", "Bald"] as const;
export const HEADS = ["Nothing", "Gele", "Fila", "Cap"] as const;
export const OUTFITS = ["Agbada", "Buba and iro", "Kaftan", "Tee and jeans"] as const;
export const EXTRAS = ["Nothing", "Shades", "Gold chain", "Hand fan"] as const;
export const DANCES = ["Shaku", "Zanku", "Legwork", "Gwara"] as const;
/** The fabric: plain, an ankara wax print, aso-oke stripes, or indigo adire. Prints use both colours. */
export const PRINTS = ["Plain", "Ankara", "Aso-oke", "Adire"] as const;

const KEYS = ["skin", "body", "hair", "head", "outfit", "color", "accent", "extra", "dance", "print"] as const;
const SIZES: Record<(typeof KEYS)[number], number> = {
  skin: SKIN.length, body: BODIES.length, hair: HAIRS.length, head: HEADS.length, outfit: OUTFITS.length,
  color: ASO.length, accent: ASO.length, extra: EXTRAS.length, dance: DANCES.length, print: PRINTS.length,
};

export const DEFAULT_LOOK: Look = { skin: 4, body: 1, hair: 0, head: 1, outfit: 1, color: 0, accent: 6, extra: 0, dance: 0, print: 1 };

/** Version 2 codes carry the print. Version 1 codes (before prints) still read, as plain fabric. */
export function encodeLook(l: Look): string {
  return "2" + KEYS.map((k) => Math.max(0, Math.min(SIZES[k] - 1, l[k] | 0)).toString(36)).join("");
}

/** Reads an outfit code. Anything malformed or out of range gives null. */
export function decodeLook(code: unknown): Look | null {
  if (typeof code !== "string") return null;
  const keys = code[0] === "2" ? KEYS : code[0] === "1" ? KEYS.slice(0, -1) : null;
  if (!keys || code.length !== keys.length + 1) return null;
  const out = { print: 0 } as Look;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const n = parseInt(code[i + 1]!, 36);
    if (!Number.isInteger(n) || n < 0 || n >= SIZES[k]) return null;
    out[k] = n;
  }
  return out;
}

export function randomLook(rng: Rng): Look {
  const out = {} as Look;
  for (const k of KEYS) out[k] = Math.floor(rng() * SIZES[k]);
  // Headwear over big hair looks odd: keep it to short hair.
  if (out.head !== 0 && (out.hair === 1 || out.hair === 4)) out.hair = 0;
  if (out.accent === out.color) out.accent = (out.color + 6) % ASO.length;
  return out;
}

/** A stable outfit for someone who hasn't dressed up yet, picked from their id. */
export function lookFor(id: string): Look {
  let x = 2166136261;
  for (const c of id) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  let a = x >>> 0;
  return randomLook(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}
