// Shared SVG coordinate rounding for the report's hand-rolled charts.
//
// Node and the browser can disagree on the LAST ULP of Math.cos/sin/sqrt. Any trigonometric coordinate
// emitted straight into an SVG attribute therefore serialises differently on the server and on the
// client, and React reports a hydration mismatch — on the report permalink, which is server-rendered,
// that fires on essentially every load. Rounding to 2 decimal places kills the mismatch and is far
// sub-pixel at every viewBox scale these charts use (RadarChart 340, the passport seals 150).
//
// Introduced by RadarChart (which had the fix inline); PassportHero's credential seals hit the same
// bug at 416 float attributes per render and now share this helper rather than re-deriving it.

/** Round an SVG coordinate to 2dp so server and client serialise it identically. */
export const r2 = (v: number): number => Math.round(v * 100) / 100;
