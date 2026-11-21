import { DoubleSide, Euler, InstancedMesh, MeshLambertMaterial, Object3D, PlaneGeometry, Quaternion, Vector3 } from "three";
import { canvasTexture } from "./kit";

const MAX = 720;
const G = 9;

/** Paper play-money notes: a ₦1M face, Zend's warm paper, a green engraved frame. */
function noteTexture() {
  return canvasTexture(128, 64, (c) => {
    c.fillStyle = "#f3ecd6";
    c.fillRect(0, 0, 128, 64);
    c.strokeStyle = "#2f6b57";
    c.lineWidth = 3;
    c.strokeRect(4, 4, 120, 56);
    c.globalAlpha = 0.35;
    c.lineWidth = 1;
    for (let k = 0; k < 6; k++) {
      c.beginPath();
      for (let x = 6; x <= 122; x += 4) c.lineTo(x, 32 + Math.sin(x / 9 + k) * (6 + k * 3));
      c.stroke();
    }
    c.globalAlpha = 1;
    c.fillStyle = "#e3d6ad";
    c.beginPath();
    c.arc(30, 32, 15, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#1f4d3f";
    c.font = "700 26px 'Geist Sans', ui-sans-serif, system-ui, sans-serif";
    c.textAlign = "right";
    c.textBaseline = "middle";
    c.fillText("₦1M", 118, 34);
  });
}

/**
 * Every sprayed note in the room, drawn as one instanced mesh. A spray throws a handful in an arc
 * from the hand to the person; they flutter down round them and lie on the floor for a while, so
 * whoever's being sprayed ends up standing in their money.
 */
export class Notes {
  readonly mesh: InstancedMesh;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private rot = new Float32Array(MAX * 3);
  private spin = new Float32Array(MAX * 3);
  /** 0 free, 1 flying, 2 fluttering, 3 lying, 4 vanishing (burned). */
  private state = new Uint8Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private next = 0;
  private dummy = new Object3D();
  private e = new Euler();
  private q = new Quaternion();
  private anyAlive = false;

  constructor() {
    this.mesh = new InstancedMesh(
      new PlaneGeometry(0.17, 0.085),
      new MeshLambertMaterial({ map: noteTexture(), side: DoubleSide }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  private take(): number {
    // Oldest first once full: notes on the floor quietly make way for new ones.
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    return i;
  }

  /** `n` notes from `from` landing round `to` after about `flight` seconds. */
  burst(from: Vector3, to: Vector3, n: number, flight = 0.42, burn = false): void {
    for (let k = 0; k < n; k++) {
      const i = this.take();
      const T = flight * (0.8 + Math.random() * 0.45);
      const tx = to.x + (Math.random() - 0.5) * 0.5;
      const ty = to.y + (Math.random() - 0.2) * 0.4;
      const tz = to.z + (Math.random() - 0.5) * 0.5;
      const j = i * 3;
      this.pos[j] = from.x + (Math.random() - 0.5) * 0.08;
      this.pos[j + 1] = from.y + (Math.random() - 0.5) * 0.08;
      this.pos[j + 2] = from.z + (Math.random() - 0.5) * 0.08;
      this.vel[j] = (tx - this.pos[j]!) / T;
      this.vel[j + 1] = (ty - this.pos[j + 1]!) / T + 0.5 * G * T;
      this.vel[j + 2] = (tz - this.pos[j + 2]!) / T;
      for (let a = 0; a < 3; a++) {
        this.rot[j + a] = Math.random() * 6.28;
        this.spin[j + a] = (Math.random() - 0.5) * 18;
      }
      this.state[i] = 1;
      this.age[i] = 0;
      this.life[i] = burn ? T : 7 + Math.random() * 6;
      if (burn) this.state[i] = 4;
    }
    this.anyAlive = true;
  }

  /** Notes raining straight down round a point (the jet, the loser's throne). */
  rain(at: Vector3, n: number, radius = 0.7, height = 3, stay = 12): void {
    for (let k = 0; k < n; k++) {
      const i = this.take();
      const j = i * 3;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      this.pos[j] = at.x + Math.cos(a) * r;
      this.pos[j + 1] = at.y + height * (0.6 + Math.random() * 0.8);
      this.pos[j + 2] = at.z + Math.sin(a) * r;
      this.vel[j] = 0;
      this.vel[j + 1] = -0.4;
      this.vel[j + 2] = 0;
      for (let b = 0; b < 3; b++) {
        this.rot[j + b] = Math.random() * 6.28;
        this.spin[j + b] = (Math.random() - 0.5) * 10;
      }
      this.state[i] = 2;
      this.age[i] = 0;
      this.life[i] = stay;
    }
    this.anyAlive = true;
  }

  update(dt: number, t: number): void {
    if (!this.anyAlive) return;
    let alive = false;
    const d = this.dummy;
    for (let i = 0; i < this.mesh.count; i++) {
      const s = this.state[i]!;
      if (s === 0) continue;
      alive = true;
      const j = i * 3;
      this.age[i]! += dt;
      let scale = 1;
      if (s === 1 || s === 4) {
        this.vel[j + 1]! -= G * dt;
        if (s === 1 && this.vel[j + 1]! < -0.5) this.state[i] = 2;
        if (s === 4 && this.age[i]! > this.life[i]!) this.state[i] = 0;
        if (s === 4) scale = Math.max(0, 1 - this.age[i]! / this.life[i]!) * 1.2;
      } else if (s === 2) {
        // Flutter: slow fall, side to side.
        this.vel[j + 1] = Math.max(this.vel[j + 1]! - G * 0.12 * dt, -0.75);
        this.vel[j]! *= 1 - 2.5 * dt;
        this.vel[j + 2]! *= 1 - 2.5 * dt;
        this.vel[j]! += Math.sin(t * 6 + i) * 0.9 * dt;
        this.vel[j + 2]! += Math.cos(t * 5 + i * 1.7) * 0.9 * dt;
        if (this.pos[j + 1]! <= 0.075) {
          this.state[i] = 3;
          this.pos[j + 1] = 0.068 + (i % 7) * 0.0012;
          this.rot[j] = -Math.PI / 2;
          this.rot[j + 1] = 0;
          this.age[i] = 0;
        }
      } else if (s === 3) {
        const left = this.life[i]! - this.age[i]!;
        if (left <= 0) this.state[i] = 0;
        scale = Math.min(1, left / 0.6);
      }
      if (s === 1 || s === 2 || s === 4) {
        this.pos[j]! += this.vel[j]! * dt;
        this.pos[j + 1]! += this.vel[j + 1]! * dt;
        this.pos[j + 2]! += this.vel[j + 2]! * dt;
        for (let a = 0; a < 3; a++) this.rot[j + a]! += this.spin[j + a]! * dt * (s === 2 ? 0.5 : 1);
      }
      if (this.state[i] === 0) scale = 0;
      d.position.set(this.pos[j]!, this.pos[j + 1]!, this.pos[j + 2]!);
      if (this.state[i] === 3) this.e.set(-Math.PI / 2, 0, this.rot[j + 2]!);
      else this.e.set(this.rot[j]!, this.rot[j + 1]!, this.rot[j + 2]!);
      d.quaternion.copy(this.q.setFromEuler(this.e));
      d.scale.setScalar(scale);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anyAlive = alive;
  }
}
