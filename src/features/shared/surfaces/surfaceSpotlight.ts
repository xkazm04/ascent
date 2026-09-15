// The spotlight: given the scene canvas and the selected technique, ring the region(s) carrying
// `data-technique="<selected>"` and dim every other region. Pure DOM, no React — the frame calls it
// from an effect after every selection change and after the scene body mounts.
//
// Why classes toggled on the DOM rather than a prop threaded through every region: a scene is
// authored as ordinary markup with `data-technique` attributes, and the spotlight is the FRAME's
// concern, not the scene's. Threading a `selected` prop into every region would make each scene
// re-implement the same ring, and forget it once. Tailwind classes are used verbatim so the
// stylesheet already contains them.

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

/** Every technique slug the scene actually marked — what the rail can point at. */
export function regionSlugs(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${SPOTLIGHT_ATTR}]`))
    .map((el) => el.getAttribute(SPOTLIGHT_ATTR) ?? "")
    .filter(Boolean);
}
