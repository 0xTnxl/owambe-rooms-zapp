import { ASO, type Look, SKIN } from "@owambe/engine";
import {
  BoxGeometry, CapsuleGeometry, CylinderGeometry, Group, IcosahedronGeometry, LatheGeometry, type Material, type Mesh,
  type Object3D, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from "three";
import { cloth } from "./cloth";
import { FACE, faceMaterial, type Mood } from "./face";
import { blob, clamp01, damp, geo, GOLD, HAIR, INK, mesh, PAPER, shade, toon } from "./kit";

export type Pose = "idle" | "dance" | "sit" | "slump" | "cheer";

const BODY_W = [0.86, 1, 1.24] as const;
const HIP = 0.3;
const HEAD_R = 0.24;
/** Head centre, from the hips. */
const HEAD_Y = 0.64;
const FLOOR_TOP = 0.06;

// ── Shapes ──────────────────────────────────────────────────────────────
// Bodies are lathed from a profile (radius, height), so every outfit has its own silhouette:
// a flared agbada, a long kaftan, a wrapper tied at the waist. Cached per body width.
type Profile = [number, number][];

const TOP: Profile = [[0, 0], [0.16, 0], [0.185, 0.05], [0.2, 0.15], [0.2, 0.24], [0.187, 0.31], [0.145, 0.362], [0.075, 0.388], [0, 0.393]];
const AGBADA: Profile = [[0, -0.25], [0.33, -0.25], [0.338, -0.215], [0.305, -0.02], [0.27, 0.16], [0.238, 0.29], [0.175, 0.365], [0.085, 0.395], [0, 0.4]];
const KAFTAN: Profile = [[0, -0.24], [0.215, -0.24], [0.222, -0.205], [0.212, 0], [0.205, 0.2], [0.19, 0.3], [0.145, 0.36], [0.075, 0.388], [0, 0.393]];
const IRO: Profile = [[0, -0.25], [0.228, -0.25], [0.232, -0.215], [0.212, -0.06], [0.203, 0.04], [0.19, 0.075], [0, 0.08]];
const SHORTS: Profile = [[0, -0.07], [0.15, -0.07], [0.168, -0.02], [0.17, 0.02], [0, 0.03]];
/** A bell sleeve (agbada), hanging from the shoulder. */
const BELL: Profile = [[0, -0.31], [0.13, -0.31], [0.128, -0.27], [0.1, -0.17], [0.07, -0.06], [0.058, 0.02], [0, 0.035]];
const GELE_WRAP: Profile = [[0.248, -0.03], [0.266, 0.04], [0.27, 0.12], [0.245, 0.2], [0.18, 0.255], [0.08, 0.28], [0, 0.284]];
const FILA: Profile = [[0.244, -0.01], [0.252, 0.05], [0.262, 0.12], [0.262, 0.17], [0.2, 0.19], [0, 0.195]];

function lathe(name: string, p: Profile, bw = 1, segs = 28) {
  return geo(`lathe:${name}:${bw}`, () => new LatheGeometry(p.map(([r, y]) => new Vector2(r * bw, y)), segs));
}

const G = {
  leg: () => geo("leg", () => new CapsuleGeometry(0.068, 0.13, 6, 12)),
  shoe: () => geo("shoe", () => new SphereGeometry(0.078, 16, 10)),
  sole: () => geo("sole", () => new CylinderGeometry(0.078, 0.078, 0.025, 16)),
  neck: () => geo("neck", () => new CylinderGeometry(0.052, 0.058, 0.09, 14)),
  arm: () => geo("arm", () => new CapsuleGeometry(0.048, 0.19, 6, 12)),
  sleeve: () => geo("sleeve", () => new CapsuleGeometry(0.06, 0.2, 6, 12)),
  puff: () => geo("puff", () => new SphereGeometry(0.078, 16, 12)),
  hand: () => geo("hand", () => new SphereGeometry(0.052, 14, 10)),
  thumb: () => geo("thumb", () => new SphereGeometry(0.022, 8, 6)),
  head: () => geo("head", () => new SphereGeometry(HEAD_R, 32, 24)),
  face: () => geo("face", () => new SphereGeometry(HEAD_R * 1.006, 28, 20, Math.PI / 2 - FACE.width / 2, FACE.width, Math.PI / 2 - FACE.above, FACE.height)),
  nose: () => geo("nose", () => new SphereGeometry(0.032, 12, 8)),
  ear: () => geo("ear", () => new SphereGeometry(0.05, 12, 8)),
  hairCap: () => geo("hairCap", () => new SphereGeometry(HEAD_R * 1.035, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.43)),
  ball: () => geo("ball", () => new SphereGeometry(1, 20, 14)),
  curl: () => geo("curl", () => new IcosahedronGeometry(1, 1)),
  strand: (r: number, l: number) => geo(`strand${r}:${l}`, () => new CapsuleGeometry(r, l, 4, 8)),
  ring: (r: number, t: number) => geo(`ring${r}:${t}`, () => new TorusGeometry(r, t, 10, 32)),
  cyl: (a: number, b: number, h: number) => geo(`cyl${a}:${b}:${h}`, () => new CylinderGeometry(a, b, h, 24)),
  box: (x: number, y: number, z: number) => geo(`box${x}:${y}:${z}`, () => new BoxGeometry(x, y, z)),
  dome: () => geo("dome", () => new SphereGeometry(HEAD_R * 1.05, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2)),
};

/** A flattened, scaled ball: the building block for pleats, folds, puffs and buns. */
function blobby(m: Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): Mesh {
  const b = mesh(G.ball(), m, x, y, z);
  b.scale.set(sx, sy, sz);
  return b;
}

/** Joint angles a pose asks for this frame; the rig eases toward them. */
interface Rig {
  bodyY: number; twist: number; tilt: number; lean: number; headZ: number; headX: number;
  lx: number; lz: number; rx: number; rz: number; llx: number; rlx: number; squash: number;
}
// Arm z: negative swings the left arm out, positive swings the right arm out.
const rest = (): Rig => ({ bodyY: 0, twist: 0, tilt: 0, lean: 0, headZ: 0, headX: 0, lx: 0, lz: -0.14, rx: 0, rz: 0.14, llx: 0, rlx: 0, squash: 0 });

/**
 * A toy party guest. Chibi proportions (a big head on a small body), a body lathed to the
 * outfit's shape, fabric in the guest's print, a painted face that changes with their mood, and
 * headwear that wobbles when they dance. It walks to where it's told and dances on the beat.
 */
export class Guest {
  readonly root = new Group();
  private body = new Group();
  private torso = new Group();
  private head = new Group();
  private armL = new Group();
  private armR = new Group();
  private legL = new Group();
  private legR = new Group();
  /** Things in the right hand: a wad of notes, a paddle, a fan. */
  readonly hand = new Group();
  /** Headwear that sways a beat behind the head. */
  private wobble: Group | null = null;
  private face: Mesh;
  private wad: Mesh | null = null;
  private paddle: Group | null = null;
  private shadow: Mesh;

  look!: Look;
  readonly target = new Vector3();
  facing = 0;
  speed = 2.2;
  pose: Pose = "idle";
  energy = 1;
  walking = false;
  /** Set by the scene: the loser is sad, the winners laugh. Null follows the pose. */
  mood: Mood | null = null;
  private walkPhase = 0;
  private sprayT = -99;
  private throwT = -99;
  private hitT = -99;
  private bidT = -99;
  private nextBlink = 1 + Math.random() * 3;
  private personal = Math.random() * 0.25;
  private now = 0;
  private cur = rest();

  constructor(look: Look) {
    this.root.add(this.body);
    this.shadow = blob(0.8);
    this.root.add(this.shadow);
    this.face = mesh(G.face(), faceMaterial("happy"));
    this.face.renderOrder = 2;
    this.setLook(look);
  }

  setLook(look: Look): void {
    this.look = look;
    for (const g of [this.body, this.torso, this.head, this.armL, this.armR, this.legL, this.legR, this.hand]) g.clear();
    this.wad = null;
    this.paddle = null;
    this.wobble = null;

    const bw = BODY_W[look.body] ?? 1;
    const skinHex = SKIN[look.skin] ?? SKIN[4];
    const base = ASO[look.color] ?? ASO[0];
    const acc = ASO[look.accent] ?? ASO[6];
    const outfit = look.outfit;
    const S = toon(skinHex);
    const C = toon(acc);
    const F = cloth(base, acc, look.print);
    const trim = toon(shade(acc, 0.92));
    this.shadow.scale.setScalar(0.66 + bw * 0.2);

    // ── Legs and shoes ──
    const legMat = outfit === 3 ? toon("#3d5a80") : outfit === 1 ? S : F;
    const sneakers = outfit === 3;
    const shoe = toon(sneakers ? PAPER : "#2b2a27");
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(side * 0.088 * Math.sqrt(bw), HIP, 0);
      leg.add(mesh(G.leg(), legMat, 0, -0.13, 0));
      const s = mesh(G.shoe(), shoe, 0, -0.252, 0.035);
      s.scale.set(1, 0.62, 1.42);
      leg.add(s);
      if (sneakers) {
        const sole = mesh(G.sole(), toon("#e9524a"), 0, -0.29, 0.035);
        sole.scale.set(1, 1, 1.42);
        leg.add(sole);
      }
      this.body.add(leg);
    }

    // ── Body, pivoting at the hips so it can twist ──
    this.torso.position.y = HIP;
    this.body.add(this.torso);
    const t = this.torso;
    if (outfit === 0) {
      // Agbada: one wide robe from shoulder to ankle, embroidered at the neck and chest.
      t.add(mesh(lathe("agbada", AGBADA, bw), F));
      const collar = mesh(G.ring(0.085, 0.024), trim, 0, 0.375, 0.02);
      collar.rotation.x = Math.PI / 2 - 0.22;
      t.add(collar, blobby(C, 0.075 * bw, 0.1, 0.018, 0, 0.25, 0.248 * bw + 0.004));
    } else if (outfit === 1) {
      // Buba and iro: a blouse, and a wrapper tied at the waist with the knot showing.
      t.add(mesh(lathe("top", TOP, bw), F), mesh(lathe("iro", IRO, bw), F));
      const tie = mesh(G.ring(0.198 * bw, 0.03), trim, 0, 0.06, 0);
      tie.rotation.x = Math.PI / 2;
      t.add(tie, blobby(C, 0.05, 0.045, 0.035, 0.1 * bw, 0.04, 0.18 * bw), blobby(C, 0.025, 0.08, 0.02, 0.11 * bw, -0.03, 0.19 * bw));
    } else if (outfit === 2) {
      // Kaftan: long and straight, with a trim down the front and round the collar.
      t.add(mesh(lathe("kaftan", KAFTAN, bw), F));
      const strip = mesh(G.box(0.04, 0.3, 0.012), trim, 0, 0.2, 0.205 * bw);
      strip.rotation.x = -0.05;
      const collar = mesh(G.ring(0.08, 0.02), trim, 0, 0.372, 0.02);
      collar.rotation.x = Math.PI / 2 - 0.22;
      t.add(strip, collar);
    } else {
      // Tee and jeans, with a belt.
      t.add(mesh(lathe("top", TOP, bw), F), mesh(lathe("shorts", SHORTS, bw), toon("#3d5a80")));
      const belt = mesh(G.ring(0.163 * bw, 0.018), toon("#2b2a27"), 0, 0.0, 0);
      belt.rotation.x = Math.PI / 2;
      t.add(belt, mesh(G.box(0.03, 0.028, 0.012), toon(GOLD), 0, 0, 0.17 * bw));
    }
    t.add(mesh(G.neck(), S, 0, 0.41, 0));

    // ── Arms, pivoting at the shoulders ──
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(side * (0.185 * bw + 0.035), 0.33, 0);
      if (outfit === 0) {
        arm.add(mesh(G.arm(), S, 0, -0.14, 0), mesh(lathe("bell", BELL), F, 0, 0, 0));
      } else if (outfit === 2) {
        arm.add(mesh(G.sleeve(), F, 0, -0.14, 0));
      } else {
        arm.add(mesh(G.arm(), S, 0, -0.14, 0), mesh(G.puff(), F, 0, -0.025, 0));
        arm.children.at(-1)!.scale.set(outfit === 1 ? 1.05 : 0.86, outfit === 1 ? 1.0 : 0.85, outfit === 1 ? 1.05 : 0.86);
      }
      arm.add(mesh(G.hand(), S, 0, -0.29, 0), mesh(G.thumb(), S, side * -0.035, -0.27, 0.03));
      t.add(arm);
    }
    this.hand.position.set(0, -0.32, 0.02);
    this.armR.add(this.hand);

    // ── Head: a big round head, a painted face, a small nose, ears ──
    const h = this.head;
    h.position.y = HEAD_Y;
    t.add(h);
    const skull = mesh(G.head(), S);
    h.add(skull, this.face);
    const nose = mesh(G.nose(), toon(shade(skinHex, 0.94)), 0, -0.028, HEAD_R - 0.004);
    nose.scale.set(1.15, 0.85, 0.75);
    h.add(nose);
    for (const side of [-1, 1]) {
      const ear = mesh(G.ear(), S, side * (HEAD_R - 0.01), -0.01, -0.01);
      ear.scale.set(0.55, 1, 0.8);
      h.add(ear);
    }

    // ── Hair. Under headwear, big hair is tucked in ──
    const H = toon(HAIR);
    const hair = look.head !== 0 && (look.hair === 1 || look.hair === 4) ? 0 : look.hair;
    const cap = () => {
      const c = mesh(G.hairCap(), H, 0, 0.0, -0.012);
      c.rotation.x = -0.42;
      h.add(c);
    };
    if (hair === 0) cap();
    else if (hair === 1) {
      // Afro: a soft dome with curls round its edge, so the outline reads as hair.
      // Afro: a soft dome set back from the forehead, its surface covered in small curls sunk
      // half into it, so the outline is bumpy without looking like balls stuck on.
      cap();
      const [cy, cz, rx, ry, rz] = [0.12, -0.08, 0.31, 0.28, 0.3];
      h.add(blobby(H, rx * 0.97, ry * 0.97, rz * 0.97, 0, cy, cz));
      const n = 60;
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 1.25;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const a = i * 2.39996;
        const z = Math.sin(a) * r;
        if (z > 0.35 && y < 0.35) continue; // keep the face clear
        const c = mesh(G.curl(), H, Math.cos(a) * r * rx * 0.94, cy + y * ry * 0.94, cz + z * rz * 0.94);
        c.scale.setScalar(0.042 + (i % 3) * 0.006);
        c.rotation.set(i, i * 2, 0);
        h.add(c);
      }
    } else if (hair === 2 || hair === 4) {
      // Braids with beads in the accent colour, or thicker locs.
      cap();
      const braids = hair === 2;
      const n = braids ? 9 : 13;
      const spread = braids ? 1.3 : 2.0;
      for (let i = 0; i < n; i++) {
        const a = -spread + (2 * spread * i) / (n - 1);
        const len = braids ? 0.24 : 0.2 + ((i * 7) % 5) * 0.025;
        const s = new Group();
        s.position.set(Math.sin(a) * 0.205, -0.02, -Math.cos(a) * 0.205);
        s.rotation.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
        s.add(mesh(G.strand(braids ? 0.021 : 0.03, len), H, 0, -len / 2, 0));
        if (braids) s.add(mesh(G.ball(), toon(GOLD), 0, -len - 0.025, 0)).children.at(-1)!.scale.setScalar(0.026);
        h.add(s);
      }
    } else if (hair === 3) {
      cap();
      h.add(blobby(H, 0.11, 0.1, 0.11, 0, 0.23, -0.1));
      const band = mesh(G.ring(0.075, 0.016), C, 0, 0.17, -0.07);
      band.rotation.x = Math.PI / 2 - 0.5;
      h.add(band);
    }

    // ── On the head ──
    if (look.head === 1) {
      // Gele: a stiff wrap, a band at the brow, and pleats fanning up behind like a crown.
      const gele = cloth(acc, base, look.print ? 2 : 0);
      const wrap = mesh(lathe("geleWrap", GELE_WRAP), gele, 0, 0.03, -0.02);
      wrap.rotation.x = -0.28;
      const band = mesh(G.ring(0.258, 0.038), toon(shade(acc, 0.86)), 0, 0.045, 0.0);
      band.rotation.x = Math.PI / 2 - 0.3;
      h.add(wrap, band);
      // Two rows of pleats, the back row taller, so the gele rises like a crown.
      const fan = new Group();
      fan.position.set(0, 0.24, -0.09);
      fan.rotation.x = -0.32;
      for (const [row, n, len, spread, z] of [[0, 9, 0.21, 1.3, -0.035], [1, 7, 0.15, 1.05, 0.02]] as const) {
        for (let i = 0; i < n; i++) {
          const a = -spread + (2 * spread * i) / (n - 1);
          const petal = new Group();
          petal.rotation.z = a;
          petal.rotation.x = row ? 0.25 : -0.1;
          petal.add(blobby(i % 2 === row ? toon(shade(acc, row ? 1.05 : 0.9)) : gele, 0.07, len, 0.026, 0, len * 0.8, z));
          fan.add(petal);
        }
      }
      // The knot at the back.
      fan.add(blobby(toon(shade(acc, 0.85)), 0.07, 0.06, 0.06, 0, -0.01, -0.02));
      h.add(fan);
      this.wobble = fan;
    } else if (look.head === 2) {
      // Fila: a soft cap whose top folds over to one side.
      const f = cloth(acc, base, look.print ? 2 : 0);
      const fila = new Group();
      fila.position.y = 0.09;
      fila.rotation.z = 0.08;
      fila.add(mesh(lathe("fila", FILA), f));
      fila.add(blobby(toon(shade(acc, 0.9)), 0.2, 0.065, 0.24, 0.1, 0.2, 0));
      fila.children.at(-1)!.rotation.z = -0.4;
      h.add(fila);
      this.wobble = fila;
    } else if (look.head === 3) {
      const c = mesh(G.dome(), C, 0, 0.02, -0.01);
      c.rotation.x = -0.15;
      const brim = mesh(G.cyl(0.15, 0.15, 0.018), C, 0, 0.065, 0.2);
      brim.scale.z = 1.3;
      brim.rotation.x = 0.18;
      h.add(c, brim, blobby(toon(shade(acc, 0.8)), 0.025, 0.018, 0.025, 0, 0.27, -0.02));
    }

    // ── Extras ──
    if (look.extra === 1) {
      // Round shades with a gold frame.
      const lens = toon(INK);
      const frame = toon(GOLD);
      for (const side of [-1, 1]) {
        const l = mesh(G.cyl(0.052, 0.052, 0.014), lens, side * 0.06, -0.004, HEAD_R + 0.004);
        l.rotation.x = Math.PI / 2;
        l.rotation.y = side * -0.22;
        h.add(l);
        const rim = mesh(G.ring(0.053, 0.0065), frame, side * 0.06, -0.004, HEAD_R + 0.011);
        rim.rotation.y = side * -0.22;
        h.add(rim);
      }
      h.add(mesh(G.box(0.028, 0.008, 0.008), frame, 0, 0.008, HEAD_R + 0.016));
    } else if (look.extra === 2) {
      const chain = mesh(G.ring(0.11 * bw, 0.013), toon(GOLD), 0, 0.37, 0.05);
      chain.rotation.x = 1.15;
      t.add(chain, blobby(toon(GOLD), 0.036, 0.036, 0.016, 0, 0.29, 0.19 * bw + 0.02));
    } else if (look.extra === 3) {
      const fan = new Group();
      const disc = mesh(G.cyl(0.12, 0.12, 0.012), cloth(acc, base, look.print || 1), 0, 0.1, 0);
      disc.rotation.x = Math.PI / 2;
      fan.add(disc, mesh(G.box(0.018, 0.12, 0.018), toon(GOLD), 0, -0.01, 0));
      fan.rotation.z = -0.3;
      this.hand.add(fan);
    }
  }

  /** A wad of notes in the right hand while spraying. */
  private showWad(on: boolean): void {
    if (on && !this.wad) {
      this.wad = mesh(G.box(0.14, 0.03, 0.08), toon("#efe6c8"), 0, -0.02, 0.02);
      this.hand.add(this.wad);
    } else if (!on && this.wad) {
      this.hand.remove(this.wad);
      this.wad = null;
    }
  }

  private showPaddle(on: boolean): void {
    if (on && !this.paddle) {
      const p = new Group();
      const disc = mesh(G.cyl(0.11, 0.11, 0.02), toon(PAPER), 0, 0.22, 0);
      disc.rotation.x = Math.PI / 2;
      p.add(disc, mesh(G.box(0.025, 0.24, 0.025), toon("#c9a46a"), 0, 0.08, 0));
      this.paddle = p;
      this.hand.add(p);
    } else if (!on && this.paddle) {
      this.hand.remove(this.paddle);
      this.paddle = null;
    }
  }

  sprayed(): void {
    this.sprayT = this.now;
  }
  threw(): void {
    this.throwT = this.now;
  }
  hit(): void {
    this.hitT = this.now;
  }
  bid(): void {
    this.bidT = this.now;
  }
  /** True for a moment after spraying: the guest stays close to whoever they're spraying. */
  get busy(): boolean {
    return this.now - this.sprayT < 1.6 || this.now - this.throwT < 0.9;
  }

  headPos(out: Vector3): Vector3 {
    return this.head.getWorldPosition(out);
  }
  handPos(out: Vector3): Vector3 {
    return this.hand.getWorldPosition(out);
  }
  neck(): Object3D {
    return this.head;
  }

  /** The face for this moment: a surprise when money lands, a laugh while spraying, blinks. */
  private faceFor(t: number): Mood {
    const blinking = t > this.nextBlink;
    if (t > this.nextBlink + 0.12) this.nextBlink = t + 2 + Math.random() * 3.5;
    if (t - this.hitT < 0.55) return "wow";
    if (this.mood === "sad") return "sad";
    if (this.mood) return blinking && this.mood === "happy" ? "blink" : this.mood;
    if (t - this.sprayT < 1.2 || t - this.throwT < 0.8 || this.pose === "cheer") return "joy";
    if (blinking) return "blink";
    return this.pose === "dance" && this.energy > 1.1 ? "grin" : "happy";
  }

  update(dt: number, t: number, beat: number): void {
    this.now = t;
    // Walking.
    const p = this.root.position;
    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    const dist = Math.hypot(dx, dz);
    this.walking = dist > 0.06 && this.pose !== "sit";
    if (this.walking) {
      const step = Math.min(dist, this.speed * dt);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      this.facing = Math.atan2(dx, dz);
      this.walkPhase += dt * 12;
    } else if (this.pose === "sit") {
      p.x = damp(p.x, this.target.x, 8, dt);
      p.z = damp(p.z, this.target.z, 8, dt);
    }
    let dy = this.facing - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.y += dy * (1 - Math.exp(-10 * dt));

    // The pose for this frame.
    const r = rest();
    const b = beat + this.personal;
    const on = Math.abs(Math.sin(Math.PI * b));
    const e = this.energy;
    if (this.walking) {
      const w = this.walkPhase;
      r.llx = Math.sin(w) * 0.7;
      r.rlx = -Math.sin(w) * 0.7;
      r.lx = -Math.sin(w) * 0.55;
      r.rx = Math.sin(w) * 0.55;
      r.bodyY = Math.abs(Math.sin(w)) * 0.04;
      r.squash = -Math.abs(Math.sin(w)) * 0.03;
    } else if (this.pose === "dance") {
      const odd = Math.floor(b) % 2 === 1;
      switch (this.look.dance) {
        case 0: // Shaku: knees up in turn, arms swinging across, a twist.
          if (odd) r.llx = -on * 0.7;
          else r.rlx = -on * 0.7;
          r.lx = -0.5 - on * 0.5;
          r.rx = -0.5 - (1 - on) * 0.5;
          r.lz = -0.3 - Math.sin(Math.PI * b) * 0.4;
          r.rz = 0.3 - Math.sin(Math.PI * b) * 0.4;
          r.twist = Math.sin((Math.PI * b) / 2) * 0.35;
          r.bodyY = on * 0.05;
          break;
        case 1: // Zanku: a kick forward on each beat, arms out wide.
          if (odd) r.llx = -on * 1.0;
          else r.rlx = -on * 1.0;
          r.lz = -0.7 - on * 0.35;
          r.rz = 0.7 + on * 0.35;
          r.lean = -on * 0.12;
          r.bodyY = on * 0.04;
          break;
        case 2: // Legwork: quick feet, double time.
          r.llx = Math.sin(2 * Math.PI * b) * 0.6;
          r.rlx = -Math.sin(2 * Math.PI * b) * 0.6;
          r.lx = -0.9;
          r.rx = -0.9;
          r.lz = -0.25;
          r.rz = 0.25;
          r.bodyY = Math.abs(Math.sin(2 * Math.PI * b)) * 0.04;
          break;
        default: // Gwara: shoulders pop side to side, arms rolling.
          r.tilt = Math.sin(Math.PI * b) * 0.2;
          r.lx = Math.sin(Math.PI * b) * 0.9 - 0.4;
          r.rx = Math.sin(Math.PI * b + Math.PI) * 0.9 - 0.4;
          r.lz = -0.35;
          r.rz = 0.35;
          r.bodyY = on * 0.05;
      }
      r.headZ = Math.sin(Math.PI * b) * 0.1;
      // Squash on the down beat, stretch on the way up: the bounce that sells a toy.
      r.squash = (on - 0.5) * 0.09;
      for (const k of ["llx", "rlx", "lx", "rx", "twist", "tilt", "lean", "bodyY", "squash"] as const) r[k] *= e;
    } else if (this.pose === "idle") {
      r.tilt = Math.sin(t * 1.6 + this.personal * 9) * 0.05;
      r.bodyY = on * 0.015;
      r.headZ = Math.sin(t * 1.1 + this.personal * 5) * 0.06;
      r.squash = Math.sin(t * 2.2 + this.personal * 7) * 0.012;
    } else if (this.pose === "sit" || this.pose === "slump") {
      r.bodyY = -0.17;
      r.llx = -1.45;
      r.rlx = -1.45;
      r.lx = -0.4;
      r.rx = -0.4;
      if (this.pose === "slump") {
        r.lean = 0.32;
        r.headX = 0.4;
        r.lx = 0.1;
        r.rx = 0.1;
        r.lz = -0.05;
        r.rz = 0.05;
      }
    } else if (this.pose === "cheer") {
      r.bodyY = Math.abs(Math.sin(t * 8)) * 0.14;
      r.lz = -2.7;
      r.rz = 2.7;
      r.headZ = Math.sin(t * 8) * 0.12;
      r.squash = Math.sin(t * 16) * 0.05;
    }

    // Moments on top of the pose.
    const sinceSpray = t - this.sprayT;
    if (sinceSpray < 1.6) {
      // A flick forward, then the hand stays up with the wad, ready for the next one.
      const k = clamp01(sinceSpray / 0.28);
      r.rx = k < 1 ? -2.9 + Math.sin(Math.PI * k) * 1.2 : -2.6;
      r.rz = 0.25;
      r.twist -= 0.15;
    }
    this.showWad(sinceSpray < 1.6);
    const sinceThrow = t - this.throwT;
    if (sinceThrow < 0.45) {
      const k = sinceThrow / 0.45;
      r.rx = -2.4 + k * 2.2;
      r.rz = 0.2;
    }
    const sinceHit = t - this.hitT;
    if (sinceHit < 0.4) {
      const k = Math.sin((Math.PI * sinceHit) / 0.4);
      r.bodyY += k * 0.09;
      r.lz -= 0.8;
      r.rz += 0.8;
      r.squash -= k * 0.08;
    }
    const sinceBid = t - this.bidT;
    if (sinceBid < 0.9) {
      r.rx = -2.8;
      r.rz = 0.1;
    }
    this.showPaddle(sinceBid < 0.9);

    // Ease every joint toward the pose.
    const c = this.cur;
    for (const key of Object.keys(r) as (keyof Rig)[]) c[key] = damp(c[key], r[key], 16, dt);
    // Stand on top of the dance floor (it's 6 cm thick), not in it.
    this.body.position.y = FLOOR_TOP + c.bodyY;
    this.body.scale.set(1 - c.squash * 0.5, 1 + c.squash, 1 - c.squash * 0.5);
    this.torso.rotation.set(c.lean, c.twist, c.tilt);
    this.head.rotation.set(c.headX, 0, c.headZ);
    this.armL.rotation.set(c.lx, 0, c.lz);
    this.armR.rotation.set(c.rx, 0, c.rz);
    this.legL.rotation.x = c.llx;
    this.legR.rotation.x = c.rlx;
    // Headwear follows the head a little late, so a gele sways as they dance.
    if (this.wobble) {
      const base = this.wobble.userData.base ?? (this.wobble.userData.base = { x: this.wobble.rotation.x, z: this.wobble.rotation.z });
      this.wobble.rotation.z = base.z - c.headZ * 0.6 - c.tilt * 0.5;
      this.wobble.rotation.x = base.x + c.squash * 1.5;
    }
    const mood = this.faceFor(t);
    const fm = faceMaterial(mood);
    if (this.face.material !== fm) this.face.material = fm;
  }
}
