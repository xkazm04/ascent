// Source excerpts for the mechanism drawer — verbatim from the scene's own files (metrics.ts,
// chartMath.ts, MiniLine.tsx and the regions). String constants so the drawer needs no build step;
// when the code moves, these move with it in the same commit.

export const SRC_METRIC = `// metrics.ts — a metric is a name with a contract; ONE derivation, registered variants
export const METRICS = {
  "success-rate.fleet.7d":  { id, label: "Scan success rate", unit: "%", precision: 1,
                              polarity: "higher-better", windowDays: 7, source: "scan_runs (raw)", derive: successRate },
  "success-rate.fleet.14d": { …windowDays: 14, derive: successRate },        // same door, declared window
  "failed-scans.fleet.7d":  { …polarity: "lower-better", derive: (w) => sum(w, "failed") },
} as const satisfies Record<string, MetricDef>;
const successRate = (w) => { const scans = sum(w, "scans"); return scans === 0 ? null : (1 - sum(w, "failed") / scans) * 100; };
export function fmtMetric(def, v) { if (v === null) return "—"; … }          // the shared formatter
export function favourable(def, delta) { return def.polarity === "lower-better" ? -delta : delta; }
// MetricRegion.tsx — the tile, the strip, the cell and the tooltip all read readMetric(def, totals)
const { current, delta } = readMetric(def, totals);
<Stat value={fmtMetric(def, current)} color={delta === null ? undefined : deltaHex(favourable(def, delta))} />
<td data-metric-cell={id}>{fmtMetric(def, current)}</td>`;

export const SRC_SCALE = `// chartMath.ts — the projection DEMANDS a domain; the defect must be spelled as a policy to exist
export function project(series, domain: Domain, box) { const [lo, hi] = domain; … }
export function domainFor(policy, series) {
  const vals = complete(series);                       // the partial bucket never sets a ceiling
  if (policy === "shared" || vals.length === 0) return SCORE_DOMAIN;   // [0, 100]
  if (policy === "auto") return [0, niceCeil(Math.max(...vals))];      // zero floor, round ceiling
  const lo = Math.min(...vals), hi = Math.max(...vals);                // "sample-floor": THE defect
  return [lo, hi === lo ? lo + 1 : hi];
}
// ScaleRegion.tsx — four siblings, one policy chip, the flat series' span in the readout
{shown.map((r) => { const domain = domainFor(policy, r.score);
  return <MiniLine series={r.score} domain={domain} chrome … />; })}
<Readout label="steady" value={\`\${flatDomain[1] - flatDomain[0]} points fill the box\`} tone={policy === "sample-floor" ? "text-danger" : …} />`;

export const SRC_LOADING = `// LoadingRegion.tsx — height reserved first; one placeholder for both waits; a boundary per slot
{engine === "ready" ? (
  <ChartBoundary id={r.id} resetKey={resets} onReport={report}>
    <div className={SLOT_H}><SlotChart repo={r} poisoned={poisoned === r.id} /></div>
  </ChartBoundary>
) : (
  <div className={\`\${SLOT_H} rounded-md bg-surface/40\`}
       style={engine === "loading" && !reduced ? { animation: "surface-quiet 700ms ease-out 150ms both" } : undefined} />
)}
useEffect(() => { if (engine !== "loading") return;
  const id = setTimeout(() => setEngine("ready"), ENGINE_MS); return () => clearTimeout(id); }, [engine]);
class ChartBoundary extends React.Component {
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onReport(this.props.id, error.message); }   // identity + trigger
  render() { return this.state.error ? <div data-slot-state="failed" role="alert">…</div> : this.props.children; }
}`;

export const SRC_MICRO = `// MicroRegion.tsx — one domain for the column; the number beside the glyph; no line under 3 points
const domain = scale === "shared" ? SCORE_DOMAIN : domainFor("sample-floor", r.score);
<th>overall · daily · 14d</th>                          // the header carries the chrome
<td style={{ color: scoreHex(value) }}>{value ?? "—"}</td>
<td>{n < MIN_POINTS_FOR_SHAPE
  ? <span data-cell="collecting">collecting · {n} of {MIN_POINTS_FOR_SHAPE}</span>
  : <MiniLine series={r.score} domain={domain} color={scoreHex(value)} w={112} h={20} pad={2} />}</td>
<td style={{ color: tone.color }}>{delta === null ? "—" : fmtDelta(delta)}</td>
// chartMath.ts
export const MIN_POINTS_FOR_SHAPE = 3;
export function shapeDelta(s) { const v = complete(s); return v.length < MIN_POINTS_FOR_SHAPE ? null : v.at(-1) - v[0]; }`;

export const SRC_ENCODING = `// chartMath.ts — colour bound to the id minted at creation, never the row's position
export const PALETTE_CAPACITY = STACK_COLORS.length;
export function seriesColor(id) { const n = Number(id.replace(/\\D/g, "")); return STACK_COLORS[(n - 1) % PALETTE_CAPACITY]; }
export const aliases = (a, b) => a !== b && seriesColor(a) === seriesColor(b);   // the modulo wrap
// EncodingRegion.tsx — one question per chart; identity survives re-sort; status uses the badge ramp
const colorOf = (r) => (mode === "identity" ? seriesColor(r.id) : scoreHex(latest(r.score) ?? 0));
const shown = order === "id" ? base : [...base].sort((a, b) => latest(b.score) - latest(a.score));
<MiniLine color={colorOf(r)} marker={markerOf(r)} endLabel={r.name} … />   // shape + label: the non-hue channels
<div style={gray ? { filter: "grayscale(1)" } : undefined}>                 // the audit`;

export const SRC_STATES = `// StatesRegion.tsx — chrome only around data; four empties, four sentences; failure keeps the window
const drawn = fact === "measured" || fact === "gap" || fact === "two-points";
{drawn ? <MiniLine series={series.score} domain={SCORE_DOMAIN} chrome … />
       : <Empty fact={fact} onWiden={…} onRetry={…} />}          // data-chrome="none": no axis, no zero line
case "not-measured": <p className="text-warn">Not being measured.</p> <p>… turn the watch on.</p>
case "failed":       <div role="alert"><p className="text-danger">Could not load the trend.</p> <button>retry</button></div>
// chartMath.ts / MiniLine.tsx — a gap breaks the line; two points draw no line
export function runs(points) { /* consecutive measured runs; a null ends one */ }
{gaps(series).map(([a, b]) => <rect data-gap … fill="var(--color-divider)" opacity={0.35} />)}
{solid.length >= 2 ? <motion.path d={pathOf(solid)} … /> : null}
{run.length < 2 || solid.length < 2 ? run.map((p) => <circle … />) : null}`;
