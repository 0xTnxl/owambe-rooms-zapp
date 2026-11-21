import { ASO } from "@owambe/engine";
import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group,
  HemisphereLight, DirectionalLight, InstancedMesh, Line, LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Object3D, SphereGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { canvasTexture, flat, INK, mesh, PAGE2, PAPER, shade, toon } from "./kit";

export const FLOOR_R = 3.3;

/**
 * The owambe: a dance floor on Zend's paper, a white canopy at the back with the DJ, plastic
 * chairs round the edge, balloons and string lights. Colour comes from the guests: the canopy
 * trim and balloons take their aso-ebi.
 */
export class Venue {
  readonly group = new Group();
  readonly spot = new Group();
  readonly booth = new Vector3(0, 0.9, -4.3);
  private bulbs: InstancedMesh;
  private bulbBase: Color[] = [];
  private trim: Mesh[] = [];
  private balloons: Mesh[] = [];
  private spotCone: Mesh;
  private spotDisc: Mesh;

  constructor() {
    const g = this.group;
    g.add(new HemisphereLight("#fffdf8", "#d6cfbf", 2.1));
    const sun = new DirectionalLight("#fff4e2", 1.5);
    sun.position.set(3, 9, 6);
    g.add(sun);

    // Ground: the page itself, a step darker, fading into the fog.
    const ground = mesh(new CircleGeometry(40, 48), new MeshLambertMaterial({ color: PAGE2 }));
    ground.rotation.x = -Math.PI / 2;
    g.add(ground);

    // The dance floor: warm paper wedges, like a printed tarp.
    const floorTex = canvasTexture(512, 512, (c) => {
      c.fillStyle = "#efe8d6";
      c.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 16; i++) {
        c.beginPath();
        c.moveTo(256, 256);
        c.arc(256, 256, 260, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2);
        c.closePath();
        c.fillStyle = i % 2 ? "#f7f2e6" : "#ebe3cf";
        c.fill();
      }
      c.strokeStyle = "rgba(15,15,14,0.12)";
      c.lineWidth = 3;
      c.setLineDash([10, 14]);
      for (const r of [90, 175]) {
        c.beginPath();
        c.arc(256, 256, r, 0, Math.PI * 2);
        c.stroke();
      }
      c.setLineDash([]);
      c.lineWidth = 10;
      c.strokeStyle = "#e0d6bf";
      c.beginPath();
      c.arc(256, 256, 250, 0, Math.PI * 2);
      c.stroke();
    });
    const edge = new MeshLambertMaterial({ color: "#e0d6bf" });
    const floor = new Mesh(new CylinderGeometry(FLOOR_R, FLOOR_R, 0.06, 64), [edge, new MeshLambertMaterial({ map: floorTex }), edge]);
    floor.position.y = 0.03;
    g.add(floor);

    // Canopy at the back.
    const canopy = new Group();
    canopy.position.set(0, 0, -4.4);
    const pole = new CylinderGeometry(0.045, 0.045, 2.5, 8);
    const poleMat = toon("#d8d2c2");
    for (const [x, z] of [[-3.4, 1.1], [3.4, 1.1], [-3.4, -1.1], [3.4, -1.1]] as const) canopy.add(mesh(pole, poleMat, x, 1.25, z));
    // Turn the 4-sided cone in its geometry first, so scaling stretches a rectangle, not a diamond.
    const roof = mesh(new ConeGeometry(2.6, 1.0, 4, 1).rotateY(Math.PI / 4), toon(PAPER), 0, 3.0, 0);
    roof.scale.set(1.85, 1, 0.6);
    canopy.add(roof);
    // Scalloped trim along the front edge, in the room's colours.
    const scallop = new CircleGeometry(0.29, 14, 0, Math.PI);
    for (let i = 0; i < 12; i++) {
      const m = mesh(scallop, toon(ASO[i % ASO.length]!), -3.3 + i * 0.6, 2.5, 1.12);
      m.rotation.z = Math.PI;
      this.trim.push(m);
      canopy.add(m);
    }
    // DJ booth and speakers.
    canopy.add(mesh(new BoxGeometry(1.6, 0.75, 0.6), toon("#2b2a27"), 0, 0.375, 0.2));
    canopy.add(mesh(new BoxGeometry(1.7, 0.05, 0.7), toon("#3a3935"), 0, 0.77, 0.2));
    const spk = new BoxGeometry(0.55, 1.15, 0.5);
    const cone = new CylinderGeometry(0.17, 0.17, 0.03, 18);
    for (const x of [-1.6, 1.6]) {
      canopy.add(mesh(spk, toon("#2b2a27"), x, 0.575, 0.2));
      for (const y of [0.85, 0.4]) {
        const c = mesh(cone, toon("#55534d"), x, y, 0.46);
        c.rotation.x = Math.PI / 2;
        canopy.add(c);
      }
    }
    // A banner over the booth.
    const banner = mesh(
      new BoxGeometry(2.4, 0.42, 0.02),
      new MeshBasicMaterial({
        map: canvasTexture(512, 90, (c) => {
          c.fillStyle = PAPER;
          c.fillRect(0, 0, 512, 90);
          c.fillStyle = INK;
          c.font = "600 46px 'Geist Sans', ui-sans-serif, system-ui, sans-serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText("OWAMBE ROOMS", 256, 47);
          c.fillStyle = "#ff4d1a";
          c.beginPath();
          c.arc(52, 47, 7, 0, Math.PI * 2);
          c.arc(460, 47, 7, 0, Math.PI * 2);
          c.fill();
        }),
      }),
      0, 1.9, 1.05,
    );
    canopy.add(banner);
    g.add(canopy);

    // Plastic chairs round the front and sides: one merged shape, drawn once for all.
    const parts: BufferGeometry[] = [];
    const add = (geom: BufferGeometry, x: number, y: number, z: number) => parts.push(geom.translate(x, y, z));
    add(new BoxGeometry(0.42, 0.05, 0.4), 0, 0.42, 0);
    add(new BoxGeometry(0.42, 0.42, 0.05), 0, 0.66, -0.18);
    for (const [x, z] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]] as const) add(new CylinderGeometry(0.02, 0.02, 0.42, 5), x, 0.21, z);
    const chair = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    const seats = [-2.3, -1.85, -1.4, 1.4, 1.85, 2.3, -0.4, 0.4];
    const chairs = new InstancedMesh(chair, toon(PAPER), seats.length);
    const m4 = new Matrix4();
    const dummy = new Object3D();
    seats.forEach((a, i) => {
      const r = a === -0.4 || a === 0.4 ? 5.6 : 4.6;
      dummy.position.set(Math.sin(a) * r, 0, Math.cos(a) * r - (r > 5 ? 0 : 0.6));
      dummy.rotation.y = a + Math.PI;
      dummy.updateMatrix();
      chairs.setMatrixAt(i, m4.copy(dummy.matrix));
    });
    g.add(chairs);

    // Balloons on the canopy's front poles and two posts at the front.
    const balloon = new SphereGeometry(0.2, 14, 10);
    const posts: [number, number, number][] = [[-3.4, 2.5, -3.3], [3.4, 2.5, -3.3], [-4.3, 2.0, 2.6], [4.3, 2.0, 2.6]];
    for (const [x, y, z] of posts) {
      if (z > 0) g.add(mesh(new CylinderGeometry(0.04, 0.04, 2.0, 8), poleMat, x, 1.0, z));
      for (const [dx, dy, dz] of [[-0.16, 0.18, 0], [0.16, 0.2, 0.04], [0, 0.42, -0.04]] as const) {
        const b = mesh(balloon, toon(ASO[(this.balloons.length * 5) % ASO.length]!), x + dx, y + dy, z + dz);
        b.scale.y = 1.15;
        this.balloons.push(b);
        g.add(b);
      }
    }

    // String lights in an X over the floor.
    const wire = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.3 });
    const strands: [Vector3, Vector3][] = [
      [new Vector3(-3.4, 2.5, -3.3), new Vector3(4.3, 2.0, 2.6)],
      [new Vector3(3.4, 2.5, -3.3), new Vector3(-4.3, 2.0, 2.6)],
      [new Vector3(-4.3, 2.0, 2.6), new Vector3(4.3, 2.0, 2.6)],
    ];
    const points: Vector3[] = [];
    for (const [a, b] of strands) {
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= 0.55;
      const curve = new CatmullRomCurve3([a, mid, b]);
      g.add(new Line(new BufferGeometry().setFromPoints(curve.getPoints(24)), wire));
      for (let i = 1; i < 14; i++) points.push(curve.getPoint(i / 14));
    }
    this.bulbs = new InstancedMesh(new SphereGeometry(0.06, 8, 6), new MeshBasicMaterial({ color: "#ffffff" }), points.length);
    const warm = ["#ffd66b", "#fff1c2", "#ffb86b", "#fff7e0"];
    points.forEach((p, i) => {
      dummy.position.copy(p);
      dummy.position.y -= 0.06;
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.bulbs.setMatrixAt(i, dummy.matrix);
      const c = new Color(warm[i % warm.length]);
      this.bulbBase.push(c);
      this.bulbs.setColorAt(i, c);
    });
    g.add(this.bulbs);

    // The DJ's spotlight: a soft beam and a bright disc on the floor. It follows the biggest bag.
    this.spotCone = mesh(
      new ConeGeometry(0.85, 5.6, 28, 1, true),
      new MeshBasicMaterial({ color: "#fffaf0", transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide }),
      0, 2.85, 0,
    );
    this.spotDisc = mesh(new CircleGeometry(0.78, 32), flat("#fffef8", 0.85), 0, 0.064, 0);
    this.spotDisc.rotation.x = -Math.PI / 2;
    this.spotDisc.renderOrder = 1;
    this.spot.add(this.spotCone, this.spotDisc);
    g.add(this.spot);
  }

  /** The room's aso-ebi colours on the trim and balloons. */
  setColours(colours: string[]): void {
    if (!colours.length) return;
    this.trim.forEach((m, i) => (m.material = toon(colours[i % colours.length]!)));
    this.balloons.forEach((m, i) => (m.material = toon(shade(colours[(i * 5) % colours.length]!, 1))));
  }

  update(t: number, beat: number, energy: number): void {
    // Bulbs breathe on the beat; brighter as the party heats up.
    const pulse = Math.abs(Math.sin(Math.PI * beat));
    const c = new Color();
    for (let i = 0; i < this.bulbBase.length; i++) {
      const k = 0.82 + 0.18 * (((i + Math.floor(beat)) % 3 === 0 ? pulse : 0.4) * energy);
      this.bulbs.setColorAt(i, c.copy(this.bulbBase[i]!).multiplyScalar(k));
    }
    this.bulbs.instanceColor!.needsUpdate = true;
    for (const [i, b] of this.balloons.entries()) b.position.y += Math.sin(t * 1.3 + i) * 0.0008;
    (this.spotCone.material as MeshBasicMaterial).opacity = 0.12 + 0.06 * pulse * energy;
  }
}
