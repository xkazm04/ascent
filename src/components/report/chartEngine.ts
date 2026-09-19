// Engine provenance for the time-series charts, the snapshot charts (ScoreRing, waterfall, radar,
// quadrant), and the What Changed pair.
//
// A scan whose `engine.provider` is "mock" was scored by the keyless deterministic rubric — no model
// contributed to it. The report view already treats that as a first-class caveat ("Demo · deterministic
// rubric" in ReportHeader), but the trend charts drew a mock point identically to an LLM-scored one, so
// a keyless scan sitting between two model scans read as a real jump or drop in maturity. The two are
// not comparable, and a line that connects them implies they are. The same lie on What Changed is a
// green/red delta between a demo scan and a live-model scan with no label that the instruments differ.
// The same lie on the snapshot charts is a filled ScoreRing / waterfall that reads as a graded scan.
//
// The chosen treatment changes the MARK, not the hue: a mock point is drawn hollow (surface fill, score-
// colored stroke), so the red→green value ramp is untouched and the caveat survives colour-blindness and
// greyscale printing. Whenever a chart contains any mock point it also renders the footnote below —
// shape alone is a legend-less encoding otherwise.
//
// D9 (Security) is signal-only on every live scan: the check battery IS the score and the model only
// narrates it. That is provenance, not a demo. Never paint D9 hollow on a live report, and never treat
// a mock report as if it were D9 (a real measurement). Mock is an engine identity.

/** The provider string the scan pipeline records for a keyless deterministic run. */
export const MOCK_ENGINE = "mock";

/** True when a point's recorded engine provider is the deterministic mock. Undefined (e.g. an org
 *  rollup point, which averages several scans and has no single engine) is NOT mock. */
export function isMockEngine(engine: string | undefined | null): boolean {
  return engine === MOCK_ENGINE;
}

/** True when any point in the series was mock-scored — the trigger for the footnote/legend. */
export function hasMockPoint(engines: readonly (string | undefined | null)[]): boolean {
  return engines.some(isMockEngine);
}

/** True when the series MIXES a mock point with a model-scored one — the case where the line
 *  actively misleads, because a segment of it spans two incomparable scoring methods. */
export function mixesEngines(engines: readonly (string | undefined | null)[]): boolean {
  return hasMockPoint(engines) && engines.some((e) => e != null && e !== MOCK_ENGINE);
}

/** The footnote shown whenever a plotted series contains a mock point. */
export const MOCK_POINT_NOTE =
  "Hollow points are demo scans, scored by the deterministic rubric with no model, so their values are not comparable to model-scored points.";

/** Suffix appended to a mock point's screen-reader label, so the caveat isn't pointer-only. */
export const MOCK_SR_SUFFIX = " (demo scan: deterministic rubric, no model)";

/** Chip on a What Changed pair that spans mock and a live model. */
export const MIXED_ENGINE_PAIR_LABEL = "Mixed engines";

/** Caveat on a mock-vs-live What Changed pair. The delta still draws — this is a label, not a hard
 *  block — because hiding the numbers would be another kind of lie. Two live providers (or two mock
 *  scans) are the same *kind* of instrument and stay quiet; only mock mixed with a live model fires. */
export const MIXED_ENGINE_PAIR_NOTE =
  "One scan is a demo (deterministic rubric, no model) and the other is live-model scored, so this delta is not a comparable measurement of the same instrument.";

/** Surface fill of a hollow (mock) mark — the score hue rides on the stroke, not the fill. */
export const MOCK_HOLLOW_FILL = "var(--color-surface-strong)";

/** Repeating dash on a mock ScoreRing arc. Score length is applied with a mask so the dash pattern
 *  is free to mean "hollow" without fighting the arc's stroke-dashoffset encoding. */
export const MOCK_RING_DASH = "6 6";

/** Footnote on a mock-scored snapshot chart (ring, waterfall, radar, quadrant). Distinct from
 *  MOCK_POINT_NOTE (time-series points) so the legend names the mark it explains. */
export const MOCK_SNAPSHOT_NOTE =
  "Hollow marks are a demo scan, scored by the deterministic rubric with no model, so these values are not comparable to a model-scored report.";

/** Inset stroke for a hollow waterfall segment — surface fill, score-coloured edge. */
export function mockHollowInset(strokeColor: string): string {
  return `inset 0 0 0 1.5px ${strokeColor}`;
}
