import { ASO, BODIES, DANCES, EXTRAS, HAIRS, HEADS, type Look, mulberry32, OUTFITS, PRINTS, randomLook, SKIN } from "@owambe/engine";
import { audio } from "../audio/audio";
import { music } from "../audio/music";
import * as sfx from "../audio/sfx";
import type { Ctx, Screen } from "../ctx";
import { h, paint } from "../h";
import { myLook, saveLook } from "../outfit";
import { getStage } from "./stage";
import { Wardrobe } from "./wardrobe";

type Key = keyof Look;

/** Dress up: pick skin, body, hair, headwear, outfit, aso-ebi, extras and a signature dance. */
export function dressUp(ctx: Ctx, then: Screen): () => void {
  let look: Look = { ...myLook() };
  const wardrobe = new Wardrobe(look, () => music.beat());
  const stage = getStage();
  const preview = h("div", { class: "d-preview" }, h("p", { class: "d-turn" }, "Drag to turn"));
  const panel = h("div", { class: "d-panel" });
  const root = h("section", { class: "dress" },
    h("header", { class: "d-head" },
      h("p", { class: "kicker" }, "Dress up"),
      h("h1", { class: "d-title" }, h("span", null, "This is you"), h("span", { class: "soft" }, "at the party."))),
    preview,
    panel);
  ctx.root.replaceChildren(root);
  document.body.classList.add("in-dress");
  music.play("lobby");

  const set = (k: Key, v: number) => {
    audio.unlock();
    look = { ...look, [k]: v };
    wardrobe.setLook(look);
    sfx.tap();
    render();
  };

  const swatches = (k: Key, colours: readonly string[], label: string) =>
    h("div", { class: "d-row" },
      h("p", { class: "d-label" }, label),
      h("div", { class: "d-swatches" },
        colours.map((c, i) => h("button", {
          class: `d-swatch${look[k] === i ? " on" : ""}`, style: { background: c }, "aria-label": `${label} ${i + 1}`,
          "aria-pressed": look[k] === i ? "true" : "false", onclick: () => set(k, i),
        }))));

  const chips = (k: Key, names: readonly string[], label: string) =>
    h("div", { class: "d-row" },
      h("p", { class: "d-label" }, label),
      h("div", { class: "d-chips" },
        names.map((n, i) => h("button", {
          class: `d-chip${look[k] === i ? " on" : ""}`, "aria-pressed": look[k] === i ? "true" : "false", onclick: () => set(k, i),
        }, n))));

  function render() {
    paint(panel, h("div", { class: "d-inner" },
      swatches("skin", SKIN, "Skin"),
      chips("body", BODIES, "Body"),
      chips("outfit", OUTFITS, "Outfit"),
      swatches("color", ASO, "Aso-ebi"),
      chips("print", PRINTS, "Fabric"),
      chips("head", HEADS, "On your head"),
      swatches("accent", ASO, look.head === 1 ? "Gele and print colour" : look.head ? "Cap and print colour" : "Second colour"),
      chips("hair", HAIRS, "Hair"),
      chips("extra", EXTRAS, "Extras"),
      chips("dance", DANCES, "Your dance"),
      h("div", { class: "d-done" },
        h("button", {
          class: "pill ghost",
          onclick: () => {
            const l = randomLook(mulberry32((Math.random() * 2 ** 31) | 0));
            look = { ...l, skin: look.skin };
            wardrobe.setLook(look);
            sfx.pop();
            render();
          },
        }, "Surprise me"),
        h("button", {
          class: "pill ink",
          onclick: () => {
            saveLook(look);
            sfx.cash();
            ctx.go(then);
          },
        }, "Let's party"))));
  }

  // Drag the preview to spin the guest.
  let lastX: number | null = null;
  const down = (e: PointerEvent) => {
    audio.unlock();
    lastX = e.clientX;
    preview.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (lastX === null) return;
    wardrobe.drag(e.clientX - lastX);
    lastX = e.clientX;
  };
  const up = () => {
    lastX = null;
    wardrobe.release();
  };
  preview.addEventListener("pointerdown", down);
  preview.addEventListener("pointermove", move);
  preview.addEventListener("pointerup", up);
  preview.addEventListener("pointercancel", up);

  stage.mount(preview, wardrobe);
  render();
  return () => {
    stage.unmount(wardrobe);
    document.body.classList.remove("in-dress");
  };
}
