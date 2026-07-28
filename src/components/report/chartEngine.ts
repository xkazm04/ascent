// Engine provenance for the time-series charts.
//
// A scan whose `engine.provider` is "mock" was scored by the keyless deterministic rubric — no model
// contributed to it. The report view already treats that as a first-class caveat ("Demo · deterministic
// rubric" in ReportHeader), but the trend charts drew a mock point identically to an LLM-scored one, so
// a keyless scan sitting between two model scans read as a real jump or drop in maturity. The two are
// not comparable, and a line that connects them implies they are.
//
// The chosen treatment changes the MARK, not the hue: a mock point is drawn hollow (surface fill, score-
// colored stroke), so the red→green value ramp is untouched and the caveat survives colour-blindness and
// greyscale printing. Whenever a chart contains any mock point it also renders the footnote below —
// shape alone is a legend-less encoding otherwise.

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
  "Hollow points are demo scans — scored by the deterministic rubric with no model, so their values are not comparable to model-scored points.";

/** Suffix appended to a mock point's screen-reader label, so the caveat isn't pointer-only. */
export const MOCK_SR_SUFFIX = " (demo scan — deterministic rubric, no model)";
