// The declared side of the desk (a passport contract with an author and a version) and the drift
// evaluation over it; plus the invisible-difference fixture rows and their classifier. Pure.

export type ClauseKind = "exists" | "exact" | "threshold" | "unchecked";
export type Clause = { id: string; label: string; kind: ClauseKind; declared: string; tolerance?: number; unit?: string };
export type Observation = { clauseId: string; value: string | null; evaluable: boolean };

export type Contract = { name: string; author: string; version: number; clauses: Clause[] };

export const CONTRACT_V3: Contract = {
  name: "readiness passport",
  author: "platform team",
  version: 3,
  clauses: [
    { id: "ci.gate", label: "CI gate workflow", kind: "exists", declared: "present" },
    { id: "coverage.min", label: "line coverage", kind: "threshold", declared: "80", tolerance: 2, unit: "%" },
    { id: "secrets.scanner", label: "secrets scanner", kind: "exists", declared: "present" },
    { id: "guidance.canonical", label: "canonical guidance file", kind: "exact", declared: "AGENTS.md" },
    { id: "latency.p95", label: "p95 latency", kind: "threshold", declared: "300", tolerance: 30, unit: "ms" },
    { id: "sbom.published", label: "SBOM published", kind: "exists", declared: "present" },
    { id: "license.header", label: "license header", kind: "unchecked", declared: "free" },
  ],
};

/** What the live system reported. `evaluable: false` is an instrument failure, never a pass. */
export const OBSERVED: Observation[] = [
  { clauseId: "ci.gate", value: "present", evaluable: true },
  { clauseId: "coverage.min", value: "74", evaluable: true },
  { clauseId: "secrets.scanner", value: null, evaluable: true },
  { clauseId: "guidance.canonical", value: "AGENTS.md", evaluable: true },
  { clauseId: "latency.p95", value: "342", evaluable: true },
  { clauseId: "sbom.published", value: null, evaluable: false },
  { clauseId: "telemetry.export", value: "present", evaluable: true },
];

export type DriftKind = "undeclared" | "unfulfilled" | "deviating" | "fulfilled" | "unevaluated" | "unchecked";
export type DriftFinding = { id: string; clauseId: string; label: string; kind: DriftKind; declared: string | null; actual: string | null; detail: string };

/** Drift vocabulary: the diff skeleton with the words the responder needs. Glyphs beside colour. */
export const DRIFT_KINDS: Record<DriftKind, { glyph: string; tone: string; verb: string }> = {
  undeclared: { glyph: "+", tone: "text-tone-rising", verb: "present, not promised" },
  unfulfilled: { glyph: "−", tone: "text-tone-falling", verb: "promised, not present" },
  deviating: { glyph: "~", tone: "text-accent-soft", verb: "present, out of tolerance" },
  fulfilled: { glyph: "=", tone: "text-slate-500", verb: "as promised" },
  unevaluated: { glyph: "?", tone: "text-warn", verb: "could not be evaluated — not passing" },
  unchecked: { glyph: "·", tone: "text-slate-600", verb: "deliberately free" },
};

/** Evaluate every clause and every observation. Finding identity is `(clause, entity)`, stable
 *  across runs — never a timestamp — so run N+1 updates a standing finding instead of minting one. */
export function evaluateDrift(contract: Contract, observed: readonly Observation[], entity: string): DriftFinding[] {
  const byClause = new Map(observed.map((o) => [o.clauseId, o]));
  const out: DriftFinding[] = [];
  for (const c of contract.clauses) {
    const o = byClause.get(c.id);
    const base = { id: `${c.id}@${entity}`, clauseId: c.id, label: c.label, declared: c.declared };
    if (c.kind === "unchecked") out.push({ ...base, kind: "unchecked", actual: o?.value ?? null, detail: "the declaration leaves this field free" });
    else if (!o || !o.evaluable) out.push({ ...base, kind: "unevaluated", actual: null, detail: "instrument could not read the value" });
    else if (c.kind === "exists") out.push(o.value ? { ...base, kind: "fulfilled", actual: o.value, detail: "present" } : { ...base, kind: "unfulfilled", actual: null, detail: "declared present, observed absent" });
    else if (c.kind === "exact") out.push(o.value === c.declared ? { ...base, kind: "fulfilled", actual: o.value, detail: "exact match" } : { ...base, kind: "deviating", actual: o.value, detail: `declared ${c.declared}, observed ${o.value ?? "nothing"}` });
    else {
      const want = Number(c.declared);
      const got = Number(o.value);
      const tol = c.tolerance ?? 0;
      const short = c.id === "coverage.min" ? got < want - tol : got > want + tol;
      out.push(short ? { ...base, kind: "deviating", actual: o.value, detail: `${got}${c.unit} vs ${want}${c.unit} ±${tol} — a near-miss window, not a tripwire` } : { ...base, kind: "fulfilled", actual: o.value, detail: `${got}${c.unit} within ${want}${c.unit} ±${tol}` });
    }
  }
  const declared = new Set(contract.clauses.map((c) => c.id));
  for (const o of observed) {
    if (!declared.has(o.clauseId) && o.value) out.push({ id: `${o.clauseId}@${entity}`, clauseId: o.clauseId, label: o.clauseId, kind: "undeclared", declared: null, actual: o.value, detail: "present in reality, absent from the promise" });
  }
  return out;
}

// ---- invisible differences --------------------------------------------------------------------

export type InvisibleRow = { id: string; name: string; before: string; after: string };

/** Pairs whose difference has no visible extent, or impersonates a visible character. */
export const INVISIBLE_ROWS: readonly InvisibleRow[] = [
  { id: "inv-1", name: "trailing space", before: "retries: 3", after: "retries: 3  " },
  { id: "inv-2", name: "tab vs spaces", before: "\tenabled: true", after: "    enabled: true" },
  { id: "inv-3", name: "indentation +4", before: "  - name: gate", after: "      - name: gate" },
  { id: "inv-4", name: "line terminator", before: "region: eu\r\n", after: "region: eu\n" },
  { id: "inv-5", name: "no-break space", before: "owner: harbor team", after: "owner: harbor\u00a0team" },
  { id: "inv-6", name: "zero-width space", before: "token: lumen", after: "token: lu\u200bmen" },
  { id: "inv-7", name: "homoglyph", before: "user: admin", after: "user: \u0430dmin" },
];

export type InvisibleMark = { klass: "no-extent" | "impersonating" | "whitespace"; text: string };

/** Classify what the eye cannot see: whitespace with its magnitude, no-extent characters, and
 *  impersonators. `expectCyrillic` is the declared repertoire — without it the homoglyph is a finding. */
export function invisibleMarks(row: InvisibleRow, expectCyrillic: boolean): InvisibleMark[] {
  const marks: InvisibleMark[] = [];
  const indent = (s: string) => (/^[ \t]*/.exec(s)?.[0] ?? "").replace(/\t/g, "    ").length;
  const di = indent(row.after) - indent(row.before);
  if (row.before.includes("\t") !== row.after.includes("\t")) marks.push({ klass: "whitespace", text: "tab ↔ spaces" });
  else if (di !== 0) marks.push({ klass: "whitespace", text: `indent ${di > 0 ? "+" : ""}${di}` });
  const trail = (s: string) => (/[ \t]+$/.exec(s)?.[0].length ?? 0);
  if (trail(row.after) !== trail(row.before)) marks.push({ klass: "whitespace", text: `trailing space +${trail(row.after) - trail(row.before)}` });
  if (row.before.includes("\r\n") !== row.after.includes("\r\n")) marks.push({ klass: "whitespace", text: row.after.includes("\r\n") ? "LF → CRLF" : "CRLF → LF" });
  if (/\u00a0/.test(row.after)) marks.push({ klass: "no-extent", text: "NBSP U+00A0" });
  if (/\u200b/.test(row.after)) marks.push({ klass: "no-extent", text: "ZWSP U+200B" });
  if (/[\u0400-\u04ff]/.test(row.after) && !expectCyrillic) marks.push({ klass: "impersonating", text: "Cyrillic \u0430 U+0430 for Latin a" });
  return marks;
}

/** Every suppressed row is counted, never deleted: whitespace-only rows under "ignore whitespace". */
export function isWhitespaceOnly(row: InvisibleRow): boolean {
  const strip = (s: string) => s.replace(/[ \t\r\n]/g, "");
  return strip(row.before) === strip(row.after);
}

/** Render invisible characters with a visible stand-in so a changed row can show its cause. */
export function revealInvisible(s: string): string {
  return s.replace(/\t/g, "→").replace(/\r\n/g, "␍␊").replace(/\n$/g, "␊").replace(/\u00a0/g, "⍽").replace(/\u200b/g, "⟨ZW⟩").replace(/ (?= |$)/g, "·");
}
