import { Color, type PerspectiveCamera, type Scene, SRGBColorSpace, WebGLRenderer } from "three";
import { PAGE } from "./kit";

/** What the stage draws: a scene, a camera, and a per-frame update. */
export interface View {
  scene: Scene;
  camera: PerspectiveCamera;
  update(dt: number, t: number): void;
  resize?(w: number, h: number): void;
}

export function webglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    // three.js needs WebGL 2 (every Android phone with OpenGL ES 3, so nearly all since 2016).
    return Boolean(c.getContext("webgl2"));
  } catch {
    return false;
  }
}

/**
 * One WebGL canvas for the whole page (phones allow only a few contexts). Screens mount it and
 * hand it a view. It caps the pixel ratio, drops it further when frames run slow, pauses when the
 * page is hidden, and survives the GPU dropping the context.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  private view: View | null = null;
  private host: HTMLElement | null = null;
  private ro: ResizeObserver;
  private last = 0;
  private t = 0;
  private dpr: number;
  private slow = 0;
  private fast = 0;
  lost = false;
  onLost: (() => void) | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "stage";
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      // MSAA is cheap on phone GPUs, and toy shapes look broken without it.
      antialias: true,
      powerPreference: "default",
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color(PAGE), 1);
    this.renderer.setPixelRatio(this.dpr);
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.onLost?.();
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
    });
    this.ro = new ResizeObserver(() => this.resize());
    document.addEventListener("visibilitychange", () => this.loop());
  }

  mount(host: HTMLElement, view: View): void {
    this.host = host;
    this.view = view;
    host.prepend(this.canvas);
    this.ro.disconnect();
    this.ro.observe(host);
    this.resize();
    this.last = performance.now();
    this.loop();
  }

  unmount(view: View): void {
    if (this.view !== view) return;
    this.view = null;
    this.ro.disconnect();
    this.canvas.remove();
    this.host = null;
    this.renderer.setAnimationLoop(null);
  }

  private loop(): void {
    const on = Boolean(this.view) && !document.hidden;
    this.renderer.setAnimationLoop(on ? (now) => this.frame(now) : null);
    this.last = performance.now();
  }

  private resize(): void {
    if (!this.host || !this.view) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.view.camera.aspect = w / h;
    this.view.camera.updateProjectionMatrix();
    this.view.resize?.(w, h);
  }

  private frame(now: number): void {
    const view = this.view;
    if (!view || this.lost) return;
    // The frame's timestamp can be a little earlier than when the loop started: never step backwards,
    // or every eased value overshoots and the camera flies off.
    const raw = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(raw, 0.05);
    this.t += dt;
    this.adapt(raw);
    view.update(dt, this.t);
    this.renderer.render(view.scene, view.camera);
  }

  /** Slow phones get fewer pixels: under ~28 fps for 2 s drops the ratio, smooth for 8 s raises it. */
  private adapt(raw: number): void {
    if (raw > 0.036) {
      this.slow += raw;
      this.fast = 0;
    } else {
      this.fast += raw;
      this.slow = Math.max(0, this.slow - raw * 0.5);
    }
    if (this.slow > 2 && this.dpr > 0.75) {
      this.dpr = Math.max(0.75, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.resize();
      this.slow = 0;
    } else if (this.fast > 8 && this.dpr < Math.min(devicePixelRatio || 1, 1.5)) {
      this.dpr = Math.min(Math.min(devicePixelRatio || 1, 1.5), this.dpr + 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.resize();
      this.fast = 0;
    }
  }
}

let stage: Stage | null = null;
export const getStage = () => (stage ??= new Stage());
