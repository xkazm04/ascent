// The spotlight: given the scene canvas and the selected technique, ring the region(s) carrying
// `data-technique="<selected>"` and dim every other region. Pure DOM, no React — the frame calls it
// from an effect after every selection change and after the scene body mounts.
//
// Why classes toggled on the DOM rather than a prop threaded through every region: a scene is
// authored as ordinary markup with `data-technique` attributes, and the spotlight is the FRAME's
// concern, not the scene's. Threading a `selected` prop into every region would make each scene
// re-implement the same ring, and forget it once. Tailwind classes are used verbatim so the
// stylesheet already contains them.

// NOTE (2026-09-06): the shipped frame renders ONE region at a time (`applySoloRegion` below), so
// `applySpotlight` is no longer a frame path. It stays because it is the region-marking CONTRACT
// every scene is tested against — each scene's `Scene.dom.test.tsx` calls it to prove that every
// technique it declares has a region the frame can point at, and that clearing puts the scene back.

export const SPOTLIGHT_ATTR = "data-technique";

export const SPOT_CLASSES = ["ring-1", "ring-accent", "ring-offset-2", "ring-offset-ink", "rounded-xl"] as const;
export const DIM_CLASSES = ["opacity-40"] as const;
const TRANSITION = ["transition-opacity", "duration-300"] as const;

/** Apply the spotlight to `root`. With `selected` null every region is plain (no ring, no dim). */
export function applySpotlight(root: ParentNode, selected: string | null): void {
  const regions = root.querySelectorAll<HTMLElement>(`[${SPOTLIGHT_ATTR}]`);
  for (const el of regions) {
    el.classList.add(...TRANSITION);
    const mine = selected !== null && el.getAttribute(SPOTLIGHT_ATTR) === selected;
    const dim = selected !== null && !mine;
    for (const c of SPOT_CLASSES) el.classList.toggle(c, mine);
    for (const c of DIM_CLASSES) el.classList.toggle(c, dim);
    if (mine) el.setAttribute("data-spotlit", "true");
    else el.removeAttribute("data-spotlit");
  }
}

// ── Solo mode (prototype 2026-09-06) ─────────────────────────────────────────────────────────────
// The spotlight above keeps every region on screen and dims the unselected ones, which is why a
// scene with ten regions is a very tall page. Solo mode renders ONE region's worth of page instead:
// the selected region stays, everything that holds only other regions is display:none'd, and the
// survivor spans whatever grid it sat in. The scene stays MOUNTED — its instruments keep running,
// its state survives switching — so this is a layout mode, not an unmount.
//
// Why it also hides ancestors: a region is usually a cell in the scene's own grid. Hiding its
// siblings alone leaves the survivor at half width beside an empty column, so any ancestor branch
// that contains regions but not the selected one is hidden too. Scene chrome that holds no region
// (headings, the fixture note) is never touched — it belongs to the whole scene.

const SOLO_HIDDEN_ATTR = "data-solo-hidden";
/** Written verbatim so Tailwind's scanner emits them; they are applied from script. */
const HIDE_CLASS = "hidden";
const SPAN_CLASS = "col-span-full";

function clearSolo(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>(`[${SOLO_HIDDEN_ATTR}]`)) {
    el.classList.remove(HIDE_CLASS);
    el.removeAttribute(SOLO_HIDDEN_ATTR);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-solo]")) {
    el.classList.remove(SPAN_CLASS);
    el.removeAttribute("data-solo");
  }
}

/**
 * Show only `selected`'s region inside `root`. `null` restores the whole composed scene.
 * Idempotent: the frame calls it after every commit, and it clears its own previous work first.
 */
export function applySoloRegion(root: HTMLElement, selected: string | null): void {
  clearSolo(root);
  if (selected === null) return;
  const target = root.querySelector<HTMLElement>(`[${SPOTLIGHT_ATTR}="${selected}"]`);
  if (!target) return;

  const hide = (el: HTMLElement) => {
    el.classList.add(HIDE_CLASS);
    el.setAttribute(SOLO_HIDDEN_ATTR, "true");
  };
  for (const el of root.querySelectorAll<HTMLElement>(`[${SPOTLIGHT_ATTR}]`)) {
    if (el !== target && !el.contains(target)) hide(el);
  }
  // Walk up to the canvas, hiding sibling branches that carry regions the reader did not pick.
  for (let node: HTMLElement = target; node !== root && node.parentElement; node = node.parentElement) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib === node) continue;
      const el = sib as HTMLElement;
      if (el.querySelector(`[${SPOTLIGHT_ATTR}]`)) hide(el);
    }
  }
  target.classList.add(SPAN_CLASS);
  target.setAttribute("data-solo", "true");
}

/** Every technique slug the scene actually marked — what the rail can point at. */
export function regionSlugs(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${SPOTLIGHT_ATTR}]`))
    .map((el) => el.getAttribute(SPOTLIGHT_ATTR) ?? "")
    .filter(Boolean);
}
