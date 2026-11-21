import { ASO, decodeLook, type GameEvent, type Look, lookFor, type PublicRound } from "@owambe/engine";
import {
  BoxGeometry, Color, Fog, Group, type Mesh, PerspectiveCamera, Plane, Raycaster, RingGeometry, Scene, Vector2, Vector3,
} from "three";
import * as sfx from "../audio/sfx";
import { Guest } from "./guest";
import { damp, flat, GOLD, INK, mesh, PAGE, reducedMotion, toon } from "./kit";
import { Notes } from "./notes";
import { chain, Confetti, crown, danfo, duplex, jet, jollof, type Moment } from "./props";
import type { View } from "./stage";
import { FLOOR_R, Venue } from "./venue";

const RING = 2.3;
const CENTER = new Vector3(0, 0, 0.15);
const MAX_MOMENTS = 6;

export interface Anchor {
  x: number;
  y: number;
}

/**
 * The party scene. It reads the round (who's here, who leads, the phase) and acts out every
 * game event: sprays become flying notes, gifts become a plate, a chain, a danfo, a duplex or a
 * jet, bids raise a paddle, and the MC runs the auctions. It never decides anything about the
 * rules; that's the engine's job.
 */
export class Party implements View {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.1, 80);
  private venue = new Venue();
  private notes = new Notes();
  private confetti = new Confetti();
  private guests = new Map<string, Guest>();
  private homes = new Map<string, Vector3>();
  private chairs = new Map<string, Vector3>();
  private engaged = new Map<string, { to: string; until: number }>();
  private combo = new Map<string, { n: number; at: number }>();
  private moments: Moment[] = [];
  private later: { at: number; fn: () => void }[] = [];
  private dj: Guest;
  private mc: Guest;
  private mcHome = new Vector3(2.5, 0, -3.2);
  private crown = crown();
  private targetRing: Mesh;
  private voteRing: Mesh;
  private throne = new Group();
  private round: PublicRound | null = null;
  private me = "";
  private lead: string | null = null;
  private leadSince = 0;
  private shownLead: string | null = null;
  private t = 0;
  private shake = 0;
  private portrait = true;
  private camPos = new Vector3(0, 9, 10.5);
  private camLook = new Vector3(0, 0.4, -0.6);
  private ray = new Raycaster();
  private floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private still = reducedMotion();
  /** Seat the player has picked to spray; shown with a ring on the floor. */
  target: string | null = null;
  voteFor: string | null = null;
  /** Where the player tapped to stand (practice only), instead of their spot on the ring. */
  myHome: Vector3 | null = null;
  energy = 1;

  constructor(private beat: () => number) {
    this.scene.background = new Color(PAGE);
    this.scene.fog = new Fog(PAGE, 13, 30);
    this.scene.add(this.venue.group, this.notes.mesh, this.confetti.mesh, this.crown);
    this.crown.visible = false;

    this.dj = new Guest({ skin: 6, body: 2, hair: 5, head: 3, outfit: 3, color: 11, accent: 0, extra: 1, dance: 3, print: 0 });
    this.dj.root.position.set(0, 0, -4.75);
    this.dj.target.copy(this.dj.root.position);
    this.dj.pose = "dance";
    this.dj.energy = 0.55;
    this.mc = new Guest({ skin: 3, body: 1, hair: 0, head: 2, outfit: 0, color: 10, accent: 7, extra: 2, dance: 1, print: 2 });
    this.mc.root.position.copy(this.mcHome);
    this.mc.target.copy(this.mcHome);
    this.mc.pose = "idle";
    this.mc.facing = -0.5;
    this.mc.hand.add(mesh(new BoxGeometry(0.035, 0.035, 0.16), toon(INK), 0, 0, 0.06));
    this.scene.add(this.dj.root, this.mc.root);

    this.targetRing = mesh(new RingGeometry(0.42, 0.5, 40), flat(INK, 0.55));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.07;
    this.targetRing.visible = false;
    this.voteRing = mesh(new RingGeometry(0.42, 0.52, 40), flat(GOLD, 0.95));
    this.voteRing.rotation.x = -Math.PI / 2;
    this.voteRing.position.y = 0.072;
    this.voteRing.visible = false;
    this.scene.add(this.targetRing, this.voteRing);

    // The loser's throne for the results: gold, tall, ridiculous.
    this.throne.add(mesh(new BoxGeometry(0.62, 0.42, 0.55), toon(GOLD), 0, 0.21, 0));
    this.throne.add(mesh(new BoxGeometry(0.62, 0.9, 0.1), toon(GOLD), 0, 0.85, -0.25));
    this.throne.add(mesh(new BoxGeometry(0.66, 0.06, 0.6), toon("#c8553d"), 0, 0.44, 0));
    this.throne.visible = false;
    this.throne.position.copy(CENTER).setZ(CENTER.z - 0.15);
    this.scene.add(this.throne);
  }

  resize(w: number, h: number): void {
    this.portrait = w / h < 0.85;
    this.camera.fov = this.portrait ? 44 : 34;
    this.camera.updateProjectionMatrix();
  }

  // ── State from the round ──────────────────────────────────────────────

  sync(round: PublicRound, me: string): void {
    this.round = round;
    this.me = me;
    const ids = round.seats.map((s) => s.id);
    // Me at the front, closest to the camera; everyone else round the ring.
    const order = [me, ...ids.filter((id) => id !== me)].filter((id) => ids.includes(id));
    order.forEach((id, i) => {
      const a = (i / order.length) * Math.PI * 2;
      this.homes.set(id, new Vector3(Math.sin(a) * RING, 0, Math.cos(a) * RING + 0.1));
      const ca = a + Math.PI / order.length;
      this.chairs.set(id, new Vector3(Math.sin(ca) * (FLOOR_R + 0.9), 0, Math.cos(ca) * (FLOOR_R + 0.9)));
    });
    for (const s of round.seats) {
      let g = this.guests.get(s.id);
      const look: Look = decodeLook(s.look) ?? lookFor(s.id);
      if (!g) {
        g = new Guest(look);
        const home = this.homes.get(s.id)!;
        g.root.position.copy(home);
        g.target.copy(home);
        this.guests.set(s.id, g);
        this.scene.add(g.root);
      } else if (s.look && decodeLook(s.look) && JSON.stringify(g.look) !== JSON.stringify(look)) g.setLook(look);
    }
    for (const [id, g] of this.guests) {
      if (!ids.includes(id)) {
        this.scene.remove(g.root);
        this.guests.delete(id);
      }
    }
    this.venue.setColours(round.seats.map((s) => ASO[(decodeLook(s.look) ?? lookFor(s.id)).color]!));
    if (round.lead !== this.lead) {
      this.lead = round.lead;
      this.leadSince = this.t;
    }
  }

  // ── Events ────────────────────────────────────────────────────────────

  private after(secs: number, fn: () => void): void {
    this.later.push({ at: this.t + secs, fn });
  }

  private pan(g: Guest): number {
    return Math.max(-1, Math.min(1, g.root.position.x / 4));
  }

  play(ev: GameEvent[]): void {
    for (const e of ev) {
      switch (e.k) {
        case "spray": {
          const from = this.guests.get(e.from);
          const to = this.guests.get(e.to);
          if (!from || !to) break;
          this.engaged.set(e.from, { to: e.to, until: this.t + 1.8 });
          const c = this.combo.get(e.from);
          const n = c && this.t - c.at < 0.9 ? c.n + 1 : 1;
          this.combo.set(e.from, { n, at: this.t });
          from.sprayed();
          from.facing = Math.atan2(to.root.position.x - from.root.position.x, to.root.position.z - from.root.position.z);
          const mine = e.from === this.me || e.to === this.me;
          this.notes.burst(from.handPos(this.tmp), to.headPos(this.tmp2).setY(this.tmp2.y - 0.25), Math.min(8 + n, 16), 0.4);
          sfx.spray(n, this.pan(from), mine ? 1 : 0.35);
          this.after(0.4, () => {
            to.hit();
            sfx.patter(this.pan(to), mine ? 1 : 0.4);
          });
          break;
        }
        case "gift": {
          const from = this.guests.get(e.from);
          const to = this.guests.get(e.to);
          if (!from || !to) break;
          from.threw();
          from.facing = Math.atan2(to.root.position.x - from.root.position.x, to.root.position.z - from.root.position.z);
          sfx.cash();
          if (this.moments.length >= MAX_MOMENTS) {
            this.notes.burst(from.handPos(this.tmp), to.headPos(this.tmp2), 12, 0.5);
            break;
          }
          if (e.item === "jollof") this.moments.push(jollof(this.scene, from, to));
          else if (e.item === "chain") this.moments.push(chain(this.scene, from, to));
          else if (e.item === "danfo") this.moments.push(danfo(this.scene, from, to));
          else if (e.item === "duplex") {
            this.moments.push(duplex(this.scene, to));
            this.after(0.45, () => (this.shake = Math.max(this.shake, 0.18)));
          } else if (e.item === "jet") {
            this.moments.push(jet(this.scene, to, this.notes));
            this.after(1.2, () => (this.shake = Math.max(this.shake, 0.12)));
          }
          this.after(0.6, () => to.hit());
          break;
        }
        case "bid":
          this.guests.get(e.seat)?.bid();
          sfx.tap();
          break;
        case "auction":
          if (e.state === "open") {
            sfx.mic();
            this.mc.target.set(0, 0, -2.85);
            this.mc.pose = "dance";
          } else {
            const w = e.winner ? this.guests.get(e.winner) : undefined;
            sfx.gavel();
            if (w) {
              // The winning bid flies to the MC and is gone.
              this.notes.burst(w.handPos(this.tmp), this.mc.headPos(this.tmp2), 40, 0.7, true);
              this.after(0.7, () => {
                this.confetti.burst(this.mc.headPos(this.tmp).setY(1.6), 70, 3.5);
                sfx.cheer(1);
              });
            }
            this.after(1.6, () => {
              this.mc.target.copy(this.mcHome);
              this.mc.pose = "idle";
            });
          }
          break;
        case "lost": {
          sfx.trombone();
          break;
        }
        case "phase":
          if (e.phase === "results") this.ceremony();
          break;
        default:
          break;
      }
    }
  }

  private ceremony(): void {
    const res = this.round?.results;
    if (!res) return;
    const loser = this.guests.get(res.loserId);
    this.throne.visible = true;
    if (loser) {
      loser.root.position.copy(this.throne.position).setZ(this.throne.position.z + 0.05);
      this.notes.rain(this.throne.position, 140, 0.55, 3.2, 600);
    }
    sfx.airhorn();
    for (const id of res.funniestIds) {
      const g = this.guests.get(id);
      if (g) this.after(0.8, () => this.confetti.burst(g.headPos(this.tmp).setY(2.2), 110, 3));
    }
  }

  // ── Picking and screen positions ─────────────────────────────────────

  /** The guest under a screen point (CSS pixels within the canvas), or null. */
  pick(x: number, y: number, w: number, h: number, exclude?: string): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, g] of this.guests) {
      if (id === exclude) continue;
      const p = this.toScreen(g.root.position.clone().setY(0.62), w, h);
      const d = Math.hypot(p.x - x, (p.y - y) * 0.8);
      const reach = Math.max(38, h * 0.06);
      if (d < reach && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  /** Where a screen point lands on the floor, if it's on the dance floor. */
  floorAt(x: number, y: number, w: number, h: number): Vector3 | null {
    this.ray.setFromCamera(new Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
    const hit = this.ray.ray.intersectPlane(this.floorPlane, new Vector3());
    return hit && Math.hypot(hit.x, hit.z) < FLOOR_R - 0.3 ? hit : null;
  }

  private toScreen(p: Vector3, w: number, h: number): Anchor {
    const v = p.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  /** Screen spot just above each guest's head, for the name tags. */
  anchors(w: number, h: number): Map<string, Anchor> {
    const out = new Map<string, Anchor>();
    for (const [id, g] of this.guests) out.set(id, this.toScreen(g.headPos(this.tmp).setY(this.tmp.y + 0.42), w, h));
    return out;
  }

  // ── Frame ─────────────────────────────────────────────────────────────

  update(dt: number, t: number): void {
    this.t = t;
    const beat = this.beat();
    const r = this.round;
    const phase = r?.phase ?? "ready";

    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.later[i]!.at <= t) {
        const job = this.later[i]!;
        this.later.splice(i, 1);
        job.fn();
      }
    }

    // Who stands where.
    const leadStable = this.lead && t - this.leadSince > 1.2 ? this.lead : this.shownLead;
    if (phase === "playing" || phase === "ready") this.shownLead = leadStable;
    const res = r?.results ?? null;
    for (const s of r?.seats ?? []) {
      const g = this.guests.get(s.id);
      if (!g) continue;
      const home = (s.id === this.me && this.myHome) || this.homes.get(s.id)!;
      const eng = this.engaged.get(s.id);
      if (phase === "results" || phase === "done") {
        g.mood = res && s.id === res.loserId ? "sad" : res?.funniestIds.includes(s.id) || res?.generousId === s.id ? "joy" : "grin";
        if (res && s.id === res.loserId) {
          g.pose = "slump";
          g.target.copy(this.throne.position).setZ(this.throne.position.z + 0.05);
          g.facing = 0;
        } else {
          g.pose = res?.funniestIds.includes(s.id) || res?.generousId === s.id ? "cheer" : "dance";
          g.target.copy(home).multiplyScalar(0.9);
          g.facing = Math.atan2(-g.root.position.x, CENTER.z - g.root.position.z);
        }
        g.energy = 1;
        continue;
      }
      g.mood = phase === "voting" ? "happy" : null;
      if (s.away) {
        g.pose = "sit";
        g.target.copy(this.chairs.get(s.id)!);
        g.facing = Math.atan2(-g.target.x, -g.target.z);
        continue;
      }
      g.pose = phase === "playing" ? "dance" : "idle";
      g.energy = this.energy;
      if (phase === "playing" && eng && eng.until > t) {
        const to = this.guests.get(eng.to);
        if (to) {
          // Step toward whoever they're spraying, but not so far that the whole room piles up
          // on one person: at most 1.1 from their own spot.
          const dir = this.tmp.copy(home).sub(to.root.position).setY(0);
          if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
          dir.normalize();
          g.target.copy(to.root.position).addScaledVector(dir, 0.9);
          const off = this.tmp2.copy(g.target).sub(home);
          if (off.length() > 1.1) g.target.copy(home).add(off.setLength(1.1));
          if (!g.walking) g.facing = Math.atan2(to.root.position.x - g.root.position.x, to.root.position.z - g.root.position.z);
          continue;
        }
      }
      // The biggest bag steps a little into the light; everyone else keeps their spot.
      if (phase === "playing" && s.id === this.shownLead) g.target.copy(home).lerp(CENTER, 0.3);
      else g.target.copy(home);
      if (!g.walking && !g.busy) {
        // Face the middle of the room, turned a little toward the camera.
        const p = g.root.position;
        const cx = -p.x;
        const cz = CENTER.z - p.z;
        const len = Math.hypot(cx, cz) || 1;
        g.facing = Math.atan2(cx / len, cz / len + 0.9);
      }
    }
    // Keep people from standing inside each other.
    const list = [...this.guests.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!.root.position;
        const b = list[j]!.root.position;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.5) {
          const push = (0.5 - d) * 0.5;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
    }

    for (const g of this.guests.values()) g.update(dt, t, beat);
    this.dj.update(dt, t, beat);
    this.mc.update(dt, t, beat);
    if (!this.mc.walking) this.mc.facing = this.mc.target.z > -3 ? 0 : -0.5;

    // Crown and spotlight on the biggest bag.
    const leader = this.shownLead ? this.guests.get(this.shownLead) : undefined;
    const showCrown = Boolean(leader) && (phase === "playing" || phase === "ready");
    this.crown.visible = showCrown;
    if (leader && showCrown) {
      leader.headPos(this.tmp);
      this.crown.position.set(this.tmp.x, this.tmp.y + 0.36 + Math.sin(t * 3) * 0.03, this.tmp.z);
      this.crown.rotation.y = t * 1.2;
    }
    const spotOn = phase === "results" || phase === "done" ? this.guests.get(res?.loserId ?? "") : leader;
    if (spotOn) {
      const sp = this.venue.spot.position;
      sp.x = damp(sp.x, spotOn.root.position.x, 5, dt);
      sp.z = damp(sp.z, spotOn.root.position.z, 5, dt);
    }
    this.venue.spot.visible = Boolean(spotOn);

    // Floor rings: who I'm spraying, who I voted for.
    const tg = this.target ? this.guests.get(this.target) : undefined;
    this.targetRing.visible = Boolean(tg) && phase === "playing";
    if (tg) {
      this.targetRing.position.x = tg.root.position.x;
      this.targetRing.position.z = tg.root.position.z;
      this.targetRing.scale.setScalar(1 + Math.abs(Math.sin(Math.PI * beat)) * 0.08);
    }
    const vg = this.voteFor ? this.guests.get(this.voteFor) : undefined;
    this.voteRing.visible = Boolean(vg) && phase === "voting";
    if (vg) {
      this.voteRing.position.x = vg.root.position.x;
      this.voteRing.position.z = vg.root.position.z;
    }

    this.venue.update(t, beat, this.energy);
    this.notes.update(dt, t);
    this.confetti.update(dt, t);
    this.moments = this.moments.filter((m) => m.update(dt));
    this.updateCamera(dt, t, phase);
  }

  private updateCamera(dt: number, t: number, phase: string): void {
    const p = this.portrait;
    const want = new Vector3(0, p ? 9.6 : 6.6, p ? 10.2 : 8.4);
    const look = new Vector3(0, p ? 0.2 : 0.5, p ? -0.9 : -0.8);
    if (phase === "results" || phase === "done") {
      want.set(0, p ? 5.2 : 4.2, p ? 7.4 : 6.4);
      look.set(0, 0.7, 0);
    } else if (phase === "voting") {
      want.multiplyScalar(0.94);
    } else if (this.energy > 1.05) {
      want.multiplyScalar(0.9);
    }
    if (!this.still) {
      want.x += Math.sin(t * 0.17) * 0.5;
      want.y += Math.sin(t * 0.23) * 0.15;
    }
    const k = 1 - Math.exp(-2.2 * dt);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0 && !this.still) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.5);
    }
    this.camera.lookAt(this.camLook);
  }

  /** The guest objects, for the wardrobe preview. */
  guest(id: string): Guest | undefined {
    return this.guests.get(id);
  }
}
