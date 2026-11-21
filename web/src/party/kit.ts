import {
  CanvasTexture, Color, DataTexture, DoubleSide, LinearFilter, Mesh, MeshBasicMaterial, MeshToonMaterial, NearestFilter,
  PlaneGeometry, RedFormat, SRGBColorSpace, type BufferGeometry, type Material,
} from "three";

/** Zend's page colours, so the party sits on the same paper as the rest of Zend. */
export const PAGE = "#f2f1ed";
export const PAGE2 = "#e8e6e1";
export const PAPER = "#fffefc";
export const INK = "#0f0f0e";
export const SIGNAL = "#ff4d1a";
export const GREEN = "#052f26";
export const GOLD = "#e9b949";
export const HAIR = "#1e1a17";

// Four tones of light, soft and never black: the shapes read as painted toys, not flat cut-outs.
const ramp = new DataTexture(new Uint8Array([158, 200, 234, 255]), 4, 1, RedFormat);
ramp.minFilter = NearestFilter;
ramp.magFilter = NearestFilter;
ramp.needsUpdate = true;

/**
 * A warm rim light on every toon surface: edges facing away from the camera glow a little, which
 * is what makes a round head look round and lifts the guests off the floor.
 */
function addRim(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <opaque_fragment>",
    `{
      float facing = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
      outgoingLight += vec3(1.0, 0.96, 0.88) * pow(1.0 - facing, 3.0) * 0.32;
    }
    #include <opaque_fragment>`,
  );
}

/** A toon material with the shared light ramp and rim. */
export function softToon(params: ConstructorParameters<typeof MeshToonMaterial>[0] = {}): MeshToonMaterial {
  const m = new MeshToonMaterial({ gradientMap: ramp, ...params });
  m.onBeforeCompile = addRim;
  // Same shader for every one of these, so the GPU compiles it once.
  m.customProgramCacheKey = () => "owambe-rim";
  return m;
}

const toons = new Map<string, MeshToonMaterial>();

/** A shared toon material for a colour. Never dispose these; they are reused across guests. */
export function toon(color: string): MeshToonMaterial {
  let m = toons.get(color);
  if (!m) {
    m = softToon({ color: new Color(color) });
    toons.set(color, m);
  }
  return m;
}

const basics = new Map<string, MeshBasicMaterial>();
export function flat(color: string, opacity = 1): MeshBasicMaterial {
  const key = `${color}:${opacity}`;
  let m = basics.get(key);
  if (!m) {
    m = new MeshBasicMaterial({ color: new Color(color), transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    basics.set(key, m);
  }
  return m;
}

/** Geometry cache: the same capsule for every arm in the room. */
const geos = new Map<string, BufferGeometry>();
export function geo<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
}

export function mesh(g: BufferGeometry, m: Material, x = 0, y = 0, z = 0): Mesh {
  const out = new Mesh(g, m);
  out.position.set(x, y, z);
  return out;
}

/** Darker or lighter version of a colour, for trims and shading on cloth. */
export function shade(hex: string, k: number): string {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return `#${c.getHexString()}`;
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** A soft round shadow on the floor: cheaper than real shadows, and kinder to old phones. */
let blobMat: MeshBasicMaterial | null = null;
export function blob(size: number): Mesh {
  blobMat ??= new MeshBasicMaterial({
    map: canvasTexture(64, 64, (g) => {
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      r.addColorStop(0, "rgba(15,15,14,0.32)");
      r.addColorStop(1, "rgba(15,15,14,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    }),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const m = new Mesh(geo("blob", () => new PlaneGeometry(1, 1)), blobMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(size);
  m.position.y = 0.075;
  m.renderOrder = 1;
  return m;
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
