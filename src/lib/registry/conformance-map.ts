// `.ai/registry-map.json` — the generated join between a managed repo's contexts and the registry's
// subjects, with a per-pair verdict written by that repo's own `/conform` runs (#18).
//
// PURE. The read is `conformance-read.ts` (an App-token side channel), the persistence is
// `@/lib/db/org-registry-conformance`, and this is the parse in between — the highest-risk logic in
// the item, so it lands testable and alone.
//
// WHAT THIS FILE REFUSES TO DO: judge. Every field here is carried verbatim from the document. The
// `state`, the `confidence`, the `evidence`, the `governance` word — all of them are the repo's own
// assertions about itself, and re-deriving any of them here would make ascent a second authority for
// a verdict it did not produce. (It is derivable-looking: 34 of this repo's 52 contexts would be
// classified correctly by "does any subject match at `strong` confidence". The other 18 would not,
// which is exactly why the field is read rather than inferred.)

/** The closed verdict vocabulary. The generator writes `unknown` for a pair nobody has judged. */
export type ConformanceState = "conformant" | "deviation" | "not-applicable" | "unjudged";

const STATES: ConformanceState[] = ["conformant", "deviation", "not-applicable", "unjudged"];

/**
 * Map the document's word onto the closed set.
 *
 * `unknown` becomes `unjudged` and RENDERS AS "—". It must never fall through to `conformant`:
 * "nobody has looked at this pair" and "this code follows the standard" are opposite facts, and only
 * one of them is an achievement.
 */
export function toConformanceState(raw: unknown): ConformanceState {
  if (typeof raw !== "string") return "unjudged";
  const v = raw.trim().toLowerCase();
  if (v === "unknown" || v === "unevaluated" || v === "") return "unjudged";
  if (v === "not_applicable" || v === "n/a" || v === "na") return "not-applicable";
  return (STATES as string[]).includes(v) ? (v as ConformanceState) : "unjudged";
}

/** One (context × subject) pair, exactly as the map states it. */
export interface ConformancePair {
  contextName: string;
  contextGroup: string | null;
  bundle: string;
  subjectSlug: string;
  state: ConformanceState;
  /** The matcher's own confidence word (`strong` / `probable` / …). Null when unstated. */
  confidence: string | null;
  /** The matcher's score. Null when unstated — never 0, which would read as "no match". */
  score: number | null;
  /** `file:line` evidence for the verdict. Org-internal: it never leaves this deployment. */
  evidence: string | null;
  evaluatedAt: string | null;
  /** The bundle digest the verdict was written against — how a reader knows it is stale. */
  evaluatedAgainst: string | null;
}

/** The map's own header: provenance and the counts it asserts about itself. */
export interface MapHeader {
  schema: string;
  project: string | null;
  generatedAt: string;
  projectSha: string | null;
  contextMapRevision: string | null;
  domains: string[];
  bundleDigests: Record<string, string>;
  contexts: number;
  pairs: number;
  judged: number;
  deviations: number;
  /** Count of contexts the map itself calls weakly governed. */
  weaklyGoverned: number;
  /** WHICH contexts those are — the registry's backlog, authored by evidence. */
  weaklyGovernedContexts: string[];
  unmatched: number;
}

export const MAP_SCHEMA = "rkb-registry-map/1";

/** Evidence is stored for the org's own UI and capped; a runaway paragraph is not more evidence. */
export const MAX_EVIDENCE = 2000;

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const intOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

export type ParsedMap =
  | { ok: true; header: MapHeader; pairs: ConformancePair[] }
  | { ok: false; reason: string };

/**
 * Parse one repo's map. NEVER throws — a truncated or foreign document comes back as
 * `{ ok: false, reason }` so the sweep can degrade that repo into a warning and carry on.
 */
export function parseConformanceMap(text: string): ParsedMap {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON (truncated or not a registry map)" };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, reason: "not an object" };
  }
  const d = doc as Record<string, unknown>;
  const schema = strOrNull(d.schema);
  if (schema !== MAP_SCHEMA) {
    return { ok: false, reason: `schema is ${schema ?? "absent"}, expected ${MAP_SCHEMA}` };
  }
  const contexts = Array.isArray(d.contexts) ? d.contexts : null;
  if (!contexts) return { ok: false, reason: "no contexts array" };

  const pairs: ConformancePair[] = [];
  const weaklyGovernedContexts: string[] = [];
  for (const raw of contexts) {
    const c = raw as Record<string, unknown>;
    const contextName = strOrNull(c?.context);
    if (!contextName) continue;
    if (strOrNull(c?.governance) === "weak") weaklyGovernedContexts.push(contextName);
    const contextGroup = strOrNull(c?.group);
    const subjects = Array.isArray(c?.subjects) ? c.subjects : [];
    for (const s of subjects) {
      const sub = s as Record<string, unknown>;
      const subjectSlug = strOrNull(sub?.subject);
      const bundle = strOrNull(sub?.bundle);
      // A pair with no subject or no bundle cannot be joined to anything in the corpus; keeping it
      // would put a row in the matrix that names nothing.
      if (!subjectSlug || !bundle) continue;
      const evidence = strOrNull(sub?.evidence);
      pairs.push({
        contextName,
        contextGroup,
        bundle,
        subjectSlug,
        state: toConformanceState(sub?.state),
        confidence: strOrNull(sub?.confidence),
        score: numOrNull(sub?.score),
        evidence: evidence ? evidence.slice(0, MAX_EVIDENCE) : null,
        evaluatedAt: strOrNull(sub?.evaluatedAt),
        evaluatedAgainst: strOrNull(sub?.evaluatedAgainst),
      });
    }
  }

  // The header's `stats` are the GENERATOR's counts. Where a stat is absent we count what we parsed
  // rather than reporting zero, but we never overwrite a stat the generator asserted — the two
  // disagreeing is itself information a reader may want.
  const stats = (d.stats ?? {}) as Record<string, unknown>;
  const digests = d.bundleDigests;
  const header: MapHeader = {
    schema,
    project: strOrNull(d.project),
    generatedAt: strOrNull(d.generatedAt) ?? new Date().toISOString(),
    projectSha: strOrNull(d.projectSha),
    contextMapRevision: strOrNull(d.contextMapRevision),
    domains: Array.isArray(d.domains) ? d.domains.filter((x): x is string => typeof x === "string") : [],
    bundleDigests:
      digests && typeof digests === "object" && !Array.isArray(digests)
        ? Object.fromEntries(
            Object.entries(digests as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"),
          )
        : {},
    contexts: intOr(stats.contexts, contexts.length),
    pairs: intOr(stats.pairs, pairs.length),
    judged: intOr(stats.judged, pairs.filter((p) => p.state !== "unjudged").length),
    deviations: intOr(stats.deviations, pairs.filter((p) => p.state === "deviation").length),
    weaklyGoverned: intOr(stats.weaklyGoverned, weaklyGovernedContexts.length),
    weaklyGovernedContexts,
    unmatched: intOr(stats.unmatched, 0),
  };
  return { ok: true, header, pairs };
}

/**
 * Count consults from `.ai/consults.jsonl` inside a window.
 *
 * One malformed line is skipped, never fatal: the file is append-only and a process killed
 * mid-write leaves a torn last line, which is not a reason to report a repo as having no consults.
 * A line with no parseable `ts` is counted in the total but cannot be windowed, so it is dropped —
 * including it would make the window mean nothing.
 */
export function countConsults(
  jsonl: string,
  windowDays: number,
  now: Date = new Date(),
): { total: number; bySubject: Record<string, number> } {
  const floor = now.getTime() - windowDays * 86_400_000;
  const bySubject: Record<string, number> = {};
  let total = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let e: { ts?: unknown; subjects?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const t = typeof e?.ts === "string" ? Date.parse(e.ts) : NaN;
    if (!Number.isFinite(t) || t < floor || t > now.getTime()) continue;
    total += 1;
    if (!Array.isArray(e?.subjects)) continue;
    for (const s of e.subjects) {
      if (typeof s !== "string" || !s.trim()) continue;
      bySubject[s] = (bySubject[s] ?? 0) + 1;
    }
  }
  return { total, bySubject };
}
