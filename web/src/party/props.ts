import { ASO } from "@owambe/engine";
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, MeshLambertMaterial, Object3D, PlaneGeometry,
  type Scene, SphereGeometry, TorusGeometry, Vector3,
} from "three";
import * as sfx from "../audio/sfx";
import type { Guest } from "./guest";
import { blob, clamp01, geo, GOLD, mesh, PAPER, toon } from "./kit";
import type { Notes } from "./notes";

/** A short animated thing in the scene. `update` returns false when it's finished. */
export interface Moment {
  update(dt: number): boolean;
}

const v = () => new Vector3();
const arc = (a: Vector3, b: Vector3, k: number, h: number, out: Vector3) => out.lerpVectors(a, b, k).setY(a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * h);

function plate(): Group {
  const g = new Group();
  g.add(mesh(geo("plate", () => new CylinderGeometry(0.17, 0.12, 0.035, 20)), toon(PAPER)));
  const rice = mesh(geo("rice", () => new SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), toon("#e2702b"), 0, 0.015, 0);
  rice.scale.y = 0.7;
  g.add(rice);
  const leaf = mesh(geo("leaf", () => new SphereGeometry(0.03, 8, 6)), toon("#3f8f4a"), 0.04, 0.09, 0.02);
  g.add(leaf);
  const plantain = mesh(geo("plantain", () => new BoxGeometry(0.08, 0.025, 0.04)), toon("#f2b33d"), -0.07, 0.03, 0.08);
  g.add(plantain);
  return g;
}

/** A plate of jollof flies from the giver's hand into the other person's hands. */
export function jollof(scene: Scene, from: Guest, to: Guest): Moment {
  const g = plate();
  const a = from.handPos(v());
  const b = v();
  const p = v();
  scene.add(g);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      to.handPos(b).y += 0.12;
      const k = clamp01(t / 0.6);
      arc(a, b, k, 0.9, p);
      g.position.copy(p);
      g.rotation.y += dt * 6;
      if (t > 0.6 && t < 0.62) sfx.pop();
      if (t > 1.8) g.scale.setScalar(Math.max(0, 1 - (t - 1.8) / 0.25));
      if (t > 2.05) {
        scene.remove(g);
        return false;
      }
      return true;
    },
  };
}

/** A gold chain flies over and settles round the other person's neck for a few seconds. */
export function chain(scene: Scene, from: Guest, to: Guest): Moment {
  const g = new Group();
  const ring = mesh(geo("bigchain", () => new TorusGeometry(0.16, 0.022, 8, 28)), toon(GOLD));
  g.add(ring);
  const a = from.handPos(v());
  const b = v();
  const p = v();
  scene.add(g);
  let t = 0;
  let rang = false;
  return {
    update(dt) {
      t += dt;
      to.headPos(b).y -= 0.2;
      const k = clamp01(t / 0.55);
      arc(a, b, k, 0.8, p);
      g.position.copy(p);
      ring.rotation.x = k < 1 ? t * 10 : Math.PI / 2 - 0.3;
      if (k >= 1 && !rang) {
        rang = true;
        sfx.sparkle();
      }
      if (t > 3) g.scale.setScalar(Math.max(0, 1 - (t - 3) / 0.3));
      if (t > 3.3) {
        scene.remove(g);
        return false;
      }
      return true;
    },
  };
}

function bus(): Group {
  const g = new Group();
  const yellow = toon("#f2b705");
  const black = toon("#1e1a17");
  const glass = toon("#bcd7e8");
  g.add(mesh(geo("busbody", () => new BoxGeometry(0.46, 0.4, 1.0)), yellow, 0, 0.3, 0));
  g.add(mesh(geo("busroof", () => new BoxGeometry(0.44, 0.06, 0.96)), toon("#e0a800"), 0, 0.53, 0));
  for (const x of [-0.232, 0.232]) {
    g.add(mesh(geo("busstripe", () => new BoxGeometry(0.01, 0.05, 0.98)), black, x, 0.22, 0));
    g.add(mesh(geo("buswin", () => new BoxGeometry(0.01, 0.13, 0.78)), glass, x, 0.4, -0.04));
  }
  g.add(mesh(geo("buswind", () => new BoxGeometry(0.4, 0.16, 0.01)), glass, 0, 0.4, 0.505));
  const wheel = geo("wheel", () => new CylinderGeometry(0.09, 0.09, 0.07, 14));
  for (const [x, z] of [[-0.22, 0.32], [0.22, 0.32], [-0.22, -0.32], [0.22, -0.32]] as const) {
    const w = mesh(wheel, black, x, 0.09, z);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  const sh = blob(1.1);
  sh.scale.set(0.7, 1.3, 1);
  g.add(sh);
  return g;
}

/** A danfo bus drives across the floor from behind the giver, honks at the other person, and leaves. */
export function danfo(scene: Scene, from: Guest, to: Guest): Moment {
  const g = bus();
  const a = from.root.position.clone();
  const b = to.root.position.clone();
  const dir = b.clone().sub(a).setY(0);
  if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
  dir.normalize();
  // Pass beside them, not through them.
  const side = new Vector3(-dir.z, 0, dir.x).multiplyScalar(0.55);
  const start = a.clone().addScaledVector(dir, -3).add(side);
  const stop = b.clone().addScaledVector(dir, -0.2).add(side);
  const end = b.clone().addScaledVector(dir, 6).add(side);
  g.rotation.y = Math.atan2(dir.x, dir.z);
  scene.add(g);
  let t = 0;
  let honked = false;
  return {
    update(dt) {
      t += dt;
      if (t < 1.0) g.position.lerpVectors(start, stop, 1 - (1 - t) ** 2);
      else if (t < 1.6) {
        g.position.copy(stop);
        if (!honked) {
          honked = true;
          sfx.honk(Math.max(-1, Math.min(1, stop.x / 4)));
        }
      } else g.position.lerpVectors(stop, end, ((t - 1.6) / 1.2) ** 2);
      g.position.y = Math.abs(Math.sin(t * 22)) * 0.012;
      if (t > 2.8) {
        scene.remove(g);
        return false;
      }
      return true;
    },
  };
}

function house(): Group {
  const g = new Group();
  g.add(mesh(geo("house", () => new BoxGeometry(0.7, 0.5, 0.6)), toon(PAPER), 0, 0.25, 0));
  const roof = mesh(geo("houseroof", () => new ConeGeometry(0.58, 0.36, 4)), toon("#c8553d"), 0, 0.68, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  g.add(mesh(geo("door", () => new BoxGeometry(0.14, 0.24, 0.01)), toon("#7a4b2a"), 0, 0.12, 0.305));
  for (const x of [-0.22, 0.22]) g.add(mesh(geo("hwin", () => new BoxGeometry(0.12, 0.12, 0.01)), toon("#bcd7e8"), x, 0.3, 0.305));
  g.add(blob(1.1));
  return g;
}

/** A Lekki duplex drops out of the sky next to the other person. */
export function duplex(scene: Scene, to: Guest): Moment {
  const g = house();
  const side = new Vector3(0.75, 0, 0.1).applyAxisAngle(new Vector3(0, 1, 0), to.root.rotation.y);
  const at = to.root.position.clone().add(side);
  g.position.copy(at);
  g.rotation.y = to.root.rotation.y + 0.3;
  scene.add(g);
  let t = 0;
  let landed = false;
  return {
    update(dt) {
      t += dt;
      const fall = clamp01(t / 0.45);
      g.position.y = (1 - fall * fall) * 5;
      if (fall >= 1 && !landed) {
        landed = true;
        sfx.thud();
        sfx.cheer(0.7);
        to.hit();
      }
      // Squash on landing, then settle.
      const s = landed ? 1 + Math.sin(clamp01((t - 0.45) / 0.3) * Math.PI) * 0.15 : 1;
      g.scale.set(1 + (s - 1), 1 - (s - 1), 1 + (s - 1));
      if (t > 2.4) g.scale.multiplyScalar(Math.max(0.001, 1 - (t - 2.4) / 0.3));
      if (t > 2.7) {
        scene.remove(g);
        return false;
      }
      return true;
    },
  };
}

function plane(): Group {
  const g = new Group();
  const white = toon(PAPER);
  const body = mesh(geo("fuselage", () => new CylinderGeometry(0.14, 0.1, 1.5, 14)), white);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = mesh(geo("nose", () => new SphereGeometry(0.14, 12, 8)), white, 0, 0, 0.75);
  g.add(nose);
  g.add(mesh(geo("wing", () => new BoxGeometry(1.6, 0.03, 0.34)), white, 0, -0.02, 0.05));
  g.add(mesh(geo("tail", () => new BoxGeometry(0.03, 0.34, 0.24)), toon("#1f3a93"), 0, 0.18, -0.66));
  g.add(mesh(geo("tailw", () => new BoxGeometry(0.6, 0.03, 0.2)), white, 0, 0.02, -0.66));
  g.add(mesh(geo("stripe", () => new BoxGeometry(0.01, 0.04, 1.2)), toon("#1f3a93"), 0.14, 0, 0));
  return g;
}

/** A private jet flies over the room and rains notes on the other person as it passes. */
export function jet(scene: Scene, to: Guest, notes: Notes): Moment {
  const g = plane();
  const z = to.root.position.z;
  const start = new Vector3(-11, 4.2, z + 1);
  const end = new Vector3(11, 4.6, z - 1);
  g.rotation.y = Math.PI / 2;
  scene.add(g);
  sfx.flyby(2.6);
  let t = 0;
  let dropped = false;
  return {
    update(dt) {
      t += dt;
      const k = clamp01(t / 2.6);
      g.position.lerpVectors(start, end, k);
      g.rotation.z = Math.sin(k * Math.PI) * -0.25;
      if (!dropped && g.position.x > to.root.position.x - 0.6) {
        dropped = true;
        notes.rain(to.root.position, 60, 0.8, 2.6, 9);
        sfx.airhorn();
      }
      if (t > 2.6) {
        scene.remove(g);
        return false;
      }
      return true;
    },
  };
}

/** Confetti in the room's colours, for the funniest and for a sold lot. */
export class Confetti {
  readonly mesh: InstancedMesh;
  private n = 260;
  private p: Float32Array;
  private vel: Float32Array;
  private r: Float32Array;
  private live: Float32Array;
  private next = 0;
  private dummy = new Object3D();

  constructor() {
    this.mesh = new InstancedMesh(new PlaneGeometry(0.06, 0.035), new MeshLambertMaterial({ side: DoubleSide }), this.n);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.r = new Float32Array(this.n * 3);
    this.live = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.mesh.setColorAt(i, toon(ASO[i % ASO.length]!).color);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  burst(at: Vector3, count = 90, up = 4): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const j = i * 3;
      this.p[j] = at.x;
      this.p[j + 1] = at.y;
      this.p[j + 2] = at.z;
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 1.6;
      this.vel[j] = Math.cos(a) * s;
      this.vel[j + 1] = up * (0.6 + Math.random() * 0.6);
      this.vel[j + 2] = Math.sin(a) * s;
      this.r[j] = Math.random() * 6;
      this.r[j + 1] = Math.random() * 6;
      this.r[j + 2] = Math.random() * 6;
      this.live[i] = 3 + Math.random();
    }
  }

  update(dt: number, t: number): void {
    const d = this.dummy;
    for (let i = 0; i < this.n; i++) {
      if (this.live[i]! <= 0) continue;
      this.live[i]! -= dt;
      const j = i * 3;
      this.vel[j + 1] = Math.max(this.vel[j + 1]! - 7 * dt, -0.9);
      this.vel[j]! *= 1 - 1.5 * dt;
      this.vel[j + 2]! *= 1 - 1.5 * dt;
      this.p[j]! += (this.vel[j]! + Math.sin(t * 7 + i) * 0.3) * dt;
      this.p[j + 1] = Math.max(0.07, this.p[j + 1]! + this.vel[j + 1]! * dt);
      this.p[j + 2]! += this.vel[j + 2]! * dt;
      d.position.set(this.p[j]!, this.p[j + 1]!, this.p[j + 2]!);
      d.rotation.set(this.r[j]! + t * 6, this.r[j + 1]! + t * 4, this.r[j + 2]!);
      d.scale.setScalar(this.live[i]! > 0 ? Math.min(1, this.live[i]! * 2) : 0);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** The crown that floats over whoever holds the biggest bag. */
export function crown(): Group {
  const g = new Group();
  const gold = toon(GOLD);
  g.add(mesh(new CylinderGeometry(0.13, 0.12, 0.08, 18), gold));
  const spike = new ConeGeometry(0.035, 0.1, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(spike, gold, Math.sin(a) * 0.125, 0.08, Math.cos(a) * 0.125));
  }
  const gem = mesh(new SphereGeometry(0.025, 8, 6), toon("#ff4d1a"), 0, 0, 0.13);
  g.add(gem);
  return g;
}
