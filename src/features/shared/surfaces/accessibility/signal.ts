// preference-respect: the ONE preference signal every region of the desk derives from. `reduced`
// arrives from the frame (OS preference OR the simulate toggle — the scene never reads a media query);
// text scale and forced colors are the scene's own in-app settings, read at one boundary (the Scene)
// and passed down, so no region re-detects anything. No React.

export type TextScale = 100 | 150 | 200;
export type PrefSignal = { reduced: boolean; scale: TextScale; forced: boolean };
export const SCALES: readonly TextScale[] = [100, 150, 200];

/** What honoring each preference must PRESERVE — the contract, beside the signal. */
export const PRESERVES: Record<keyof PrefSignal, string> = {
  reduced: "feedback replaced, never removed: the drawer settles instantly, the deleted row leaves without a fade",
  scale: "content reflows: the table wraps and grows; nothing truncates or overlaps",
  forced: "meaning survives the palette: status keeps a glyph and a word beside its color",
};
