export type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> | null;
type Handlers = Record<string, EventListener>;
type WithHandlers = HTMLElement & { __on?: Handlers };

/** Listeners read the element's current handlers, so `paint` can swap them without re-adding. */
function listen(el: WithHandlers, type: string): void {
  el.addEventListener(type, (e) => el.__on?.[type]?.(e));
}

/** Tiny DOM builder: `h("button", { class: "x", onclick }, "Go")`. No virtual DOM. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      const w = el as WithHandlers;
      (w.__on ??= {})[k.slice(2)] = v as EventListener;
      listen(w, k.slice(2));
    } else if (k === "class") el.className = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value") (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

/**
 * Updates `a` in place to look like `b`: attributes, text and handlers. Elements that stay keep
 * their identity, so a tap that starts before a re-render still lands on the same button.
 */
function patch(a: Node, b: Node): void {
  if (a.nodeType !== b.nodeType || (a instanceof Element && a.tagName !== (b as Element).tagName)) {
    a.parentNode?.replaceChild(b, a);
    return;
  }
  if (!(a instanceof HTMLElement)) {
    if (a.textContent !== b.textContent) a.textContent = b.textContent;
    return;
  }
  const eb = b as WithHandlers;
  const ea = a as WithHandlers;
  for (const { name } of [...ea.attributes]) if (!eb.hasAttribute(name)) ea.removeAttribute(name);
  for (const { name, value } of [...eb.attributes]) if (ea.getAttribute(name) !== value) ea.setAttribute(name, value);
  if (a instanceof HTMLInputElement && document.activeElement !== a) a.value = (b as HTMLInputElement).value;
  if (a instanceof HTMLButtonElement) a.disabled = (b as HTMLButtonElement).disabled;
  for (const type of Object.keys(eb.__on ?? {})) if (!ea.__on?.[type]) listen(ea, type);
  ea.__on = eb.__on;
  const ac = [...ea.childNodes];
  const bc = [...eb.childNodes];
  bc.forEach((n, i) => (ac[i] ? patch(ac[i]!, n) : ea.appendChild(n)));
  for (let i = bc.length; i < ac.length; i++) ac[i]!.remove();
}

/** Draws `el` into `root`, patching what's already there. */
export function paint(root: HTMLElement, el: HTMLElement): void {
  const cur = root.firstElementChild;
  if (root.childNodes.length === 1 && cur) patch(cur, el);
  else root.replaceChildren(el);
}

/** Round avatar: the Zend photo, or initials on a colour picked from the id. */
export function avatar(p: { id: string; name: string; avatar: string | null }, size = 48): HTMLElement {
  // FNV-1a over id and name, spread round the colour wheel so "bot_0" and "bot_1" look different.
  let x = 2166136261;
  for (const c of p.id + p.name) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  const hue = ((x >>> 0) * 137) % 360;
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px`, background: `hsl(${hue} 70% 45%)` };
  const initials = p.name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
  const el = h("span", { class: "av", style }, initials || "?");
  if (p.avatar?.startsWith("https://")) {
    const img = h("img", { src: p.avatar, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.onerror = () => img.remove();
    el.appendChild(img);
  }
  return el;
}

export const first = (name: string) => name.split(/\s+/)[0] ?? name;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** One short line at the bottom of the screen. */
export function toast(text: string): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove("show"), 2600);
}

/** A bottom sheet with a title and buttons. Resolves the chosen value, or null. */
export function sheet<T>(title: string, options: { label: string; value: T; danger?: boolean }[]): Promise<T | null> {
  return new Promise((resolve) => {
    const close = (v: T | null) => {
      wrap.remove();
      resolve(v);
    };
    const wrap = h(
      "div",
      { class: "scrim", onclick: (e: Event) => e.target === wrap && close(null) },
      h(
        "div",
        { class: "sheet", role: "dialog", "aria-label": title },
        h("h3", null, title),
        options.map((o) => h("button", { class: o.danger ? "btn ghost danger" : "btn ghost", onclick: () => close(o.value) }, o.label)),
        h("button", { class: "btn ghost", onclick: () => close(null) }, "Cancel"),
      ),
    );
    document.body.appendChild(wrap);
  });
}
