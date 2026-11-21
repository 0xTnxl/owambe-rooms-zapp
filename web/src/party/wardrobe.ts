import type { Look } from "@owambe/engine";
import { Color, CylinderGeometry, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene } from "three";
import { Guest } from "./guest";
import { damp, mesh, PAGE, PAPER, toon } from "./kit";
import type { View } from "./stage";

/** Dress-up preview: one guest on a paper disc, turning slowly; drag to spin them. */
export class Wardrobe implements View {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 30);
  private guest: Guest;
  private spin = 0;
  private vel = 0.35;
  private dragging = false;

  constructor(look: Look, private beat: () => number) {
    this.scene.background = new Color(PAGE);
    this.scene.add(new HemisphereLight("#fffdf8", "#d6cfbf", 2.2));
    const sun = new DirectionalLight("#fff4e2", 1.5);
    sun.position.set(2, 5, 4);
    this.scene.add(sun);
    const disc = mesh(new CylinderGeometry(0.75, 0.75, 0.06, 48), toon(PAPER));
    disc.position.y = 0.03;
    this.scene.add(disc);
    this.guest = new Guest(look);
    this.guest.pose = "dance";
    this.guest.energy = 0.7;
    this.scene.add(this.guest.root);
    this.camera.position.set(0, 1.25, 3.6);
    this.camera.lookAt(0, 0.62, 0);
  }

  setLook(look: Look): void {
    this.guest.setLook(look);
  }

  /** Drag deltas in pixels. */
  drag(dx: number): void {
    this.dragging = true;
    this.spin += dx * 0.012;
    this.vel = dx * 0.6;
  }
  release(): void {
    this.dragging = false;
  }

  resize(w: number, h: number): void {
    // Keep the whole guest in view on narrow and wide screens.
    this.camera.position.z = w / h < 0.8 ? 4.2 : 3.4;
  }

  update(dt: number, t: number): void {
    if (!this.dragging) {
      this.vel = damp(this.vel, 0.35, 1.5, dt);
      this.spin += this.vel * dt;
    }
    this.guest.root.rotation.y = this.spin;
    this.guest.facing = this.spin;
    this.guest.update(dt, t, this.beat());
  }
}
