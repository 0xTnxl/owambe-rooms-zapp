import { Color, type MeshToonMaterial, RepeatWrapping } from "three";
import { canvasTexture, shade, softToon, toon } from "./kit";

const cache = new Map<string, MeshToonMaterial>();
const S = 128;

/** Draws `fn` at every wrap offset, so shapes crossing an edge carry on from the other side. */
function tiled(g: CanvasRenderingContext2D, fn: (dx: number, dy: number) => void): void {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
}

/** Ankara wax print: big rings in the accent, with dots and small diamonds between. */
function ankara(g: CanvasRenderingContext2D, base: string, acc: string): void {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const dark = shade(base, 0.62);
  const light = shade(acc, 1.2);
  tiled(g, (dx, dy) => {
    for (const [x, y] of [[32, 32], [96, 96]] as const) {
      g.fillStyle = acc;
      g.beginPath();
      g.arc(x + dx, y + dy, 24, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = base;
      g.beginPath();
      g.arc(x + dx, y + dy, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = dark;
      g.beginPath();
      g.arc(x + dx, y + dy, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = light;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.beginPath();
        g.arc(x + dx + Math.cos(a) * 19.5, y + dy + Math.sin(a) * 19.5, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const [x, y] of [[96, 32], [32, 96]] as const) {
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(x + dx, y + dy - 11);
      g.lineTo(x + dx + 11, y + dy);
      g.lineTo(x + dx, y + dy + 11);
      g.lineTo(x + dx - 11, y + dy);
      g.closePath();
      g.fill();
      g.fillStyle = acc;
      g.beginPath();
      g.arc(x + dx, y + dy, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Aso-oke: hand-woven strips, so bands run down the body with fine thread lines. */
function asoOke(g: CanvasRenderingContext2D, base: string, acc: string): void {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const dark = shade(base, 0.75);
  for (let x = 0; x < S; x += 32) {
    g.fillStyle = acc;
    g.fillRect(x + 4, 0, 9, S);
    g.fillStyle = dark;
    g.fillRect(x + 17, 0, 2, S);
    g.fillRect(x + 24, 0, 2, S);
    g.fillStyle = shade(acc, 1.35);
    g.fillRect(x + 7, 0, 2, S);
  }
  // The weave: faint cross threads.
  g.globalAlpha = 0.12;
  g.fillStyle = "#000";
  for (let y = 0; y < S; y += 4) g.fillRect(0, y, S, 1);
  g.globalAlpha = 1;
}

/** Adire: indigo-style resist dye, the base colour deepened, the pattern left light. */
function adire(g: CanvasRenderingContext2D, base: string, acc: string): void {
  const deep = shade(base, 0.48);
  g.fillStyle = deep;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = shade(base, 1.15);
  g.fillStyle = shade(base, 1.15);
  g.lineWidth = 3;
  tiled(g, (dx, dy) => {
    for (const [x, y] of [[32, 32], [96, 96]] as const) {
      for (const r of [6, 13, 20]) {
        g.beginPath();
        g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        g.stroke();
      }
    }
    for (const [x, y] of [[96, 32], [32, 96]] as const) {
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(x + dx + (k % 2 ? 7 : -7), y + dy + (k < 2 ? -7 : 7), 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
  // A few accent threads, as if stitched before dyeing.
  g.strokeStyle = acc;
  g.lineWidth = 1.5;
  g.setLineDash([3, 4]);
  for (const y of [0, 64]) {
    g.beginPath();
    g.moveTo(0, y + 1);
    g.lineTo(S, y + 1);
    g.stroke();
  }
  g.setLineDash([]);
}

const DRAW = [null, ankara, asoOke, adire] as const;

/**
 * Fabric for a guest's clothes: plain, or one of the prints in their two colours. Shared by
 * everyone wearing the same combination; never dispose.
 */
export function cloth(base: string, accent: string, print: number): MeshToonMaterial {
  const draw = DRAW[print] ?? null;
  if (!draw) return toon(base);
  const key = `${print}:${base}:${accent}`;
  let m = cache.get(key);
  if (!m) {
    const tex = canvasTexture(S, S, (g) => draw(g, base, accent));
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.repeat.set(3, 2);
    m = softToon({ map: tex, color: new Color("#ffffff") });
    cache.set(key, m);
  }
  return m;
}
