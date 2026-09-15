// Source excerpts for the drawer — real lines of this folder's code, copied after the scene was final
// (grep any line to find it). One constant per technique, in rail order.

export const SRC_PAIR = `// PairRegion.tsx — the pair is resolved from the QUESTION; the degenerate pairs are labelled
export function resolvePair(p: PairState) {
  const species = p.pruned ? DEFAULT_SPECIES : p.species;
  const entry = SPECIES.find((s) => s.id === species)!;
  if (p.self) return { baseline: p.candidate, candidate: p.candidate, label: \`\${p.candidate} → \${p.candidate}\`,
    notice: \`Comparing \${p.candidate} with itself — an empty result here is not "no changes"; it is the pair (X, X).\` };
  if (entry.baseline === null) return { baseline: null, candidate: p.candidate, label: \`passport v3 (declared) → \${p.candidate}\`,
    notice: "Declared baseline: the left side is a promise, not a past state. ..." };
  const notice = p.pruned
    ? \`Remembered baseline (...) was retired — fell back to the default "\${DEFAULT_SPECIES}" baseline \${entry.baseline}. Pick again if that is not your question.\`
    : null;
  return { baseline: entry.baseline, candidate: p.candidate, label: \`\${entry.baseline} → \${p.candidate}\`, notice };
}
// fixtures.ts — each species names the baseline; the data never does
export const SPECIES = [
  { id: "temporal", baseline: "scan-1191", question: "what just changed?" },
  { id: "lifecycle", baseline: "scan-1180", question: "what would shipping this change?" },
  { id: "sibling", baseline: "scan-1204-alt", question: "how do the alternatives differ?" },
  { id: "declared", baseline: null, question: "does reality match the promise?" },
];`;

export const SRC_LEVEL = `// kernel.ts — keyed alignment: identity survives the insertions at the head; a move is a move
const baseById = new Map(base.map((s, i) => [s.id, { s, i }]));
const candIds = new Set(cand.map((s) => s.id));
// Shared ids in each side's order: a move is a shared id whose rank moved by more than one slot.
const baseRank = new Map<string, number>();
let r = 0;
for (const s of base) if (candIds.has(s.id)) baseRank.set(s.id, r++);
let candRank = 0;
for (const c of cand) {
  const hit = baseById.get(c.id);
  if (!hit) { push({ key: c.id, kind: "added", name: c.name, before: null, after: c.value }); continue; }
  const reason = notCompared(c);
  const displacement = Math.abs((baseRank.get(c.id) ?? 0) - candRank++);
  if (reason) push({ key: c.id, kind: "not-compared", ..., reason });
  else if (displacement > 1) push({ key: c.id, kind: "moved", ..., inferred: \`inferred from a displacement of \${displacement} slots\` });
  else if (normalize(hit.s.value) === normalize(c.value)) push({ key: c.id, kind: "unchanged", ... });
  else push({ key: c.id, kind: "changed", ... });
}
// The normalization ledger — every standing assertion "this is not a difference", with its reason.
export const LEDGER_VERSION = 2;
export function normalize(value: string): string {
  return value.replace(/\\r\\n?/g, "\\n").replace(/[ \\t]+$/gm, "");
}`;

export const SRC_OFFLOAD = `// useComparison.ts — identity, supersession, failure shape, bounded cache, named reaper
useEffect(() => {
  const seq = ++seqRef.current;
  const cached = cacheRef.current.get(key);
  if (cached && !killed) { setHits((h) => h + 1); setState({ status: "ready", seq, result: cached, fromCache: true, path: "sync" }); return; }
  const settle = () => {
    // Supersession: a response for a request the surface has moved past is dropped, never applied.
    if (seq !== seqRef.current) { setDropped((d) => d + 1); return; }
    if (killed) {
      // Failure is spelled as failure — a distinct shape, not an empty result.
      setState({ status: "failed", seq, message: "kernel terminated before it answered (simulated crash)" });
      return;
    }
    const result = runKernel(req);
    const cache = cacheRef.current;
    cache.set(key, result);
    // The cache names its reaper: past the cap the oldest entry leaves.
    while (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
    setState({ status: "ready", seq, result, fromCache: false, path: delay === 0 ? "sync" : "scheduled" });
  };
  if (delay === 0) { settle(); return; }
  setState({ status: "computing", seq, path: "scheduled" });
  const timer = setTimeout(settle, delay);
  // The reaper: pair change, level change or surface teardown terminates in-flight work.
  return () => clearTimeout(timer);
}, [key, killed, delay, retries]);
// kernel.ts — the ladder: the budget picks the rung; the surface discloses it
export function rungFor(level: Level, n: number): Rung {
  if (level === "bytes") return "full";
  if (level === "lines") return n * 3 > BUDGET.lineCap ? "too-large" : "full";
  if (n <= BUDGET.fullRows) return "full";
  if (n <= BUDGET.detailRows) return "capped";
  return "summary";
}`;

export const SRC_MODES = `// kernel.ts — THE vocabulary: glyph + label beside colour, defined once, read by every region
export const CHANGE_KINDS: Record<ChangeKind, { glyph: string; label: string; tone: string }> = {
  added: { glyph: "+", label: "added", tone: "text-tone-rising" },
  removed: { glyph: "−", label: "removed", tone: "text-tone-falling" },
  changed: { glyph: "~", label: "changed", tone: "text-accent-soft" },
  moved: { glyph: "↕", label: "moved", tone: "text-warn" },
  unchanged: { glyph: "=", label: "unchanged", tone: "text-slate-500" },
  "not-compared": { glyph: "?", label: "not compared", tone: "text-slate-400" },
};
// ModesRegion.tsx — remembered preference, transient override, hard switch below the effective width
const chosen = override ?? remembered;
const narrow = width !== null && width < NARROW_PX;
const mode: Mode = chosen === "side-by-side" && narrow ? "inline" : chosen;
// DiffView.tsx — summary: the count carries its predicate and escalates to the same pair
<p data-summary-count={result.remainderKnown ? result.differences : "unknown"}>
  {result.remainderKnown ? \`\${result.differences.toLocaleString("en-US")}\${partial ? "+" : ""}\` : "?"} differences
  <span className="type-caption text-slate-500"> · {result.predicate}</span>
</p>
<button type="button" className={BTN} onClick={onOpenDetail}>open detail — same pair, same level, same predicate</button>`;

export const SRC_DRIFT = `// contract.ts — finding identity is (clause, entity), never a timestamp
const base = { id: \`\${c.id}@\${entity}\`, clauseId: c.id, label: c.label, declared: c.declared };
if (c.kind === "unchecked") out.push({ ...base, kind: "unchecked", ... });
else if (!o || !o.evaluable) out.push({ ...base, kind: "unevaluated", actual: null, detail: "instrument could not read the value" });
else if (c.kind === "exists") out.push(o.value ? { ...base, kind: "fulfilled", ... } : { ...base, kind: "unfulfilled", ... });
else {
  const tol = c.tolerance ?? 0;
  const short = c.id === "coverage.min" ? got < want - tol : got > want + tol;
  out.push(short ? { ...base, kind: "deviating", detail: \`\${got}\${c.unit} vs \${want}\${c.unit} ±\${tol} — a near-miss window, not a tripwire\` } : { ...base, kind: "fulfilled", ... });
}
// DriftRegion.tsx — the standing ledger derives from the SAME identity on every run
if (open) next[f.id] = prev ? { ...prev, observations: prev.resolved ? prev.observations : run - prev.firstRun + 1 } : { firstRun: run, observations: 1, resolved: null };
else if (prev && !prev.resolved) next[f.id] = { ...prev, resolved: "no longer observed" };
// the governed verb: attributed, logged before/after, and it bumps the version
const amendPromise = (f: DriftFinding) => {
  const version = contract.version + 1;
  setLog((l) => [...l, { clauseId: f.clauseId, before: f.declared, after: f.actual, version }]);
  setStanding({ ...ledger, [f.id]: { ...(ledger[f.id] ?? { firstRun: run, observations: 1 }), resolved: "promise amended" } });
  setContract((c) => ({ ...c, version, clauses: ... }));
};`;

export const SRC_HONESTY = `// DiffView.tsx — the cut marker sits at the cut, quantified only when the remainder was counted
function CutMarker({ result, shown }: { result: DiffResult; shown: number }) {
  const remainder = result.differences - shown;
  if (result.rung === "too-large") return <p className={NOTICE.cut} data-cut="uncounted">… further differences not computed — the line budget stopped the alignment before counting</p>;
  if (result.rung === "summary") return <p className={NOTICE.cut} data-cut="summary">… row detail not computed at this budget; the counts above are the ceiling the budget allowed</p>;
  if (remainder <= 0) return null;
  return <p className={NOTICE.cut} data-cut="counted">… and {remainder.toLocaleString("en-US")} more {remainder === 1 ? "difference" : "differences"} — cut here, not at the end</p>;
}
// kernel.ts — the undiffable is a third state with its reason
function notCompared(s: Signal): string | null {
  if (s.kind === "blob") return "binary — nothing to align";
  if (s.kind === "volatile") return "excluded by the ledger (volatile)";
  return null;
}
// ModesRegion.tsx — failure is failure; zero is a scoped claim
state.status === "failed" ? (
  <p className={NOTICE.failure} role="alert" data-diff-state="failed">Comparison unavailable — {state.message}. This is not an empty diff.</p>
) : state.status === "ready" ? (
  state.result.differences === 0 && state.result.remainderKnown ? (
    <p className={NOTICE.info} data-diff-state="zero">No differences at {state.result.predicate} — compared, none found.</p>
  ) : ( <DiffView ... /> )
) : ( <p data-diff-state="computing">Comparing… (request in flight; nothing here is a finding yet)</p> )`;

export const SRC_INVISIBLE = `// contract.ts — whitespace carries its magnitude; no-extent and impersonating characters are named
export function invisibleMarks(row: InvisibleRow, expectCyrillic: boolean): InvisibleMark[] {
  const marks: InvisibleMark[] = [];
  const indent = (s: string) => (/^[ \\t]*/.exec(s)?.[0] ?? "").replace(/\\t/g, "    ").length;
  const di = indent(row.after) - indent(row.before);
  if (row.before.includes("\\t") !== row.after.includes("\\t")) marks.push({ klass: "whitespace", text: "tab ↔ spaces" });
  else if (di !== 0) marks.push({ klass: "whitespace", text: \`indent \${di > 0 ? "+" : ""}\${di}\` });
  if (row.before.includes("\\r\\n") !== row.after.includes("\\r\\n")) marks.push({ klass: "whitespace", text: row.after.includes("\\r\\n") ? "LF → CRLF" : "CRLF → LF" });
  if (/\\u00a0/.test(row.after)) marks.push({ klass: "no-extent", text: "NBSP U+00A0" });
  if (/\\u200b/.test(row.after)) marks.push({ klass: "no-extent", text: "ZWSP U+200B" });
  if (/[\\u0400-\\u04ff]/.test(row.after) && !expectCyrillic) marks.push({ klass: "impersonating", text: "Cyrillic \\u0430 U+0430 for Latin a" });
  return marks;
}
// InvisibleRegion.tsx — the reader's suppression is a view: visibly on, counted, carried by the reference
const suppressed = rows.filter((r) => r.wsOnly).length;
const visible = ignoreWs ? rows.filter((r) => !r.wsOnly) : rows;
const reference = \`#compare?pair=\${encodeURIComponent(pairLabel)}&ws=\${ignoreWs ? "ignore" : "exact"}&repertoire=\${cyrillic ? "latin+cyrillic" : "latin"}\`;`;
