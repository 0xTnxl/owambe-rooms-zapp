import { Color, type MeshToonMaterial } from "three";
import { canvasTexture, HAIR, softToon } from "./kit";

export type Mood = "happy" | "grin" | "wow" | "sad" | "blink" | "joy";

/**
 * Faces are painted on a patch of sphere just in front of the head. Canvas layout (256 × 200)
 * matches the patch: the eye line sits at y ≈ 92, the 3D nose at ≈ 104, the mouth at ≈ 138.
 */
export const FACE = { width: 1.7, height: 1.3, above: 0.55 } as const;

const W = 256;
const H = 200;
const EYE = { y: 92, x: 36 };
const MY = 138;
/** Features are drawn this much bigger than their base sizes: a chibi face fills the head. */
const K = 1.35;
const INK = "#1d1714";
const MOUTH = "#4a1f19";

function eyes(g: CanvasRenderingContext2D, open: boolean, happyClosed = false): void {
  for (const s of [-1, 1]) {
    const cx = W / 2 + s * EYE.x;
    if (open) {
      g.fillStyle = INK;
      g.beginPath();
      g.ellipse(cx, EYE.y, 12 * K, 16.5 * K, 0, 0, Math.PI * 2);
      g.fill();
      // Two catch-lights: what makes a toy face look alive.
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(cx + 4.5 * K, EYE.y - 6 * K, 4.8 * K, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(cx - 4 * K, EYE.y + 6 * K, 2.3 * K, 0, Math.PI * 2);
      g.fill();
    } else {
      g.strokeStyle = INK;
      g.lineWidth = 6.5;
      g.lineCap = "round";
      g.beginPath();
      // Happy closed eyes curve up (^ ^); a blink is a gentle line.
      if (happyClosed) g.arc(cx, EYE.y + 8, 13, Math.PI * 1.15, Math.PI * 1.85);
      else g.arc(cx, EYE.y - 8, 14, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
    }
  }
}

function brows(g: CanvasRenderingContext2D, lift: number, tilt: number): void {
  g.strokeStyle = HAIR;
  g.lineWidth = 7;
  g.lineCap = "round";
  for (const s of [-1, 1]) {
    const cx = W / 2 + s * (EYE.x + 3);
    const y = EYE.y - 37 - lift;
    g.beginPath();
    g.moveTo(cx - 14, y + 3 + s * tilt);
    g.quadraticCurveTo(cx, y - 6, cx + 14, y + 3 - s * tilt);
    g.stroke();
  }
}

function blush(g: CanvasRenderingContext2D, k = 1): void {
  for (const s of [-1, 1]) {
    const cx = W / 2 + s * 66;
    const r = g.createRadialGradient(cx, 122, 2, cx, 122, 26);
    r.addColorStop(0, `rgba(255, 105, 90, ${0.45 * k})`);
    r.addColorStop(1, "rgba(255, 105, 90, 0)");
    g.fillStyle = r;
    g.beginPath();
    g.ellipse(cx, 122, 28, 18, 0, 0, Math.PI * 2);
    g.fill();
  }
}

/** Runs `fn` with the canvas scaled by K round the mouth, so mouths grow with the eyes. */
function mouth(g: CanvasRenderingContext2D, fn: () => void): void {
  g.save();
  g.translate(W / 2, MY);
  g.scale(K, K);
  g.translate(-W / 2, -MY);
  g.strokeStyle = MOUTH;
  g.fillStyle = MOUTH;
  g.lineWidth = 4.5;
  g.lineCap = "round";
  fn();
  g.restore();
}

function draw(g: CanvasRenderingContext2D, mood: Mood): void {
  const c = W / 2;
  switch (mood) {
    case "happy":
    case "blink":
      blush(g);
      brows(g, 0, 0);
      eyes(g, mood === "happy");
      mouth(g, () => {
        g.beginPath();
        g.arc(c, MY - 12, 15, Math.PI * 0.2, Math.PI * 0.8);
        g.stroke();
      });
      break;
    case "grin":
    case "joy":
      blush(g, 1.2);
      brows(g, 3, 0);
      eyes(g, mood === "grin", true);
      // An open laugh: a dark D with a tongue and a line of teeth.
      mouth(g, () => {
        g.beginPath();
        g.moveTo(c - 18, MY - 6);
        g.quadraticCurveTo(c, MY - 9, c + 18, MY - 6);
        g.quadraticCurveTo(c + 15, MY + 17, c, MY + 18);
        g.quadraticCurveTo(c - 15, MY + 17, c - 18, MY - 6);
        g.fill();
        g.fillStyle = "#ff8a7a";
        g.beginPath();
        g.ellipse(c, MY + 11, 8.5, 5, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fffefc";
        g.fillRect(c - 12, MY - 7, 24, 4.5);
      });
      break;
    case "wow":
      blush(g, 0.8);
      brows(g, 9, 0);
      eyes(g, true);
      mouth(g, () => {
        g.beginPath();
        g.ellipse(c, MY, 7.5, 10, 0, 0, Math.PI * 2);
        g.fill();
      });
      break;
    case "sad":
      brows(g, 2, -7);
      eyes(g, true);
      mouth(g, () => {
        g.beginPath();
        g.arc(c, MY + 12, 13, Math.PI * 1.2, Math.PI * 1.8);
        g.stroke();
      });
      // One big cartoon tear.
      g.fillStyle = "#8dd3f5";
      g.beginPath();
      g.moveTo(c + EYE.x + 10, EYE.y + 20);
      g.quadraticCurveTo(c + EYE.x + 20, EYE.y + 42, c + EYE.x + 10, EYE.y + 47);
      g.quadraticCurveTo(c + EYE.x, EYE.y + 42, c + EYE.x + 10, EYE.y + 20);
      g.fill();
      break;
  }
}

const cache = new Map<Mood, MeshToonMaterial>();

/** The face for a mood. One texture per mood, shared by every guest. */
export function faceMaterial(mood: Mood): MeshToonMaterial {
  let m = cache.get(mood);
  if (!m) {
    m = softToon({
      map: canvasTexture(W, H, (g) => draw(g, mood)),
      color: new Color("#ffffff"),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    cache.set(mood, m);
  }
  return m;
}
