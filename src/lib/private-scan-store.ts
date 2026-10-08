// What Ascent may STORE from a private repository's scan — one pure rule, applied by the persist path.
//
// The promise (src/app/privacy/page.tsx, and the private-repo-scan feature's own summary) is that a
// private repo's source is never persisted, only derived scores. Four stores used to break it: a
// verified model claim is rendered into `ScanDimension.evidence` with its verbatim quote (up to
// CLAIM_QUOTE_MAX chars), the guidance arbiter keeps the rule lines and literal commands it compared,
// the manifest readout keeps `repo.purpose` prose and the capability commands, and the `.ai/memory`
// mirror copies whole entry bodies. The operator's decision (2026-10-08) was to change the STORES, not
// the claim. The first three are scrubbed here; the mirror refuses a private repo at its own gate
// (src/lib/memory/repo-memory-mirror.ts).
//
// What stays: paths, vendors, facets, points, counts, scores, capability names, and the fixed
// vocabulary the analyzers themselves generate. What goes: any string that was copied out of a file.
// The report RETURNED to the caller who ran the scan is untouched; only what is written changes.
//
// A public report passes through by identity, so nothing about the public corpus moves.

import type { GuidanceContradiction, GuidanceEdge, GuidanceGraph, ScanReport } from "@/lib/types";
import type { ManifestReadout } from "@/lib/standard/readout";

/** Stands in for an elided quote. Renders as `path: "…"` on the readers that print a quote, which
 *  reads as elided rather than as a sentence the file contains. */
export const ELIDED_QUOTE = "…";

/** A capability key the arbiter derives from a fixed list of runner verbs ("test", "build", …). */
const DERIVED_KEY = /^[a-z][a-z0-9-]*$/;

/** The report as it may be stored. Identity for anything not explicitly private. */
export function storableScanReport(report: ScanReport): ScanReport {
  if (report.repo.isPrivate !== true) return report;
  return {
    ...report,
    dimensions: report.dimensions.map((d) => ({ ...d, evidence: d.evidence.map(storableEvidenceLine) })),
    ...(report.guidanceGraph ? { guidanceGraph: storableGuidanceGraph(report.guidanceGraph) } : {}),
    ...(report.manifest ? { manifest: storableManifest(report.manifest) } : {}),
  };
}

// engine.ts renderClaim: `Model cited <facet> (+n) — <path>: "<quote>"[ · <path2>: "<quote2>"]`,
// `Model reported <facet> (evidence only, scores 0) — …` and `Model confirmed <facet> — …`.
const CLAIM_LINE = /^(Model (?:cited|reported|confirmed) [^—"]*?) — ([^"]+?): "/;
const SECOND_CITATION = /" · ([^"\s]+): "/g;

/**
 * One evidence line, without the quote. A claim line keeps its facet, its points and its path(s); the
 * second path survives only when it can be located unambiguously, because a quote may itself contain
 * the separator. Any other line is analyzer-generated and passes unchanged.
 */
export function storableEvidenceLine(line: string): string {
  const m = CLAIM_LINE.exec(line);
  if (!m) return line;
  const [, head, path] = m;
  const rest = line.slice(m[0].length);
  const seconds = [...rest.matchAll(SECOND_CITATION)];
  const second = seconds.length === 1 && seconds[0]?.[1] ? ` · ${seconds[0][1]}` : "";
  return `${head} — ${path}${second}`;
}

/**
 * The guidance graph without copied text: no rule lines, no literal commands, no quoted contradiction
 * sides. The structure the coherence card reads (nodes, canonical, projection states, contradiction
 * COUNT and paths, penalties, coherence) is kept, so a private repo still has a coherence reading.
 */
export function storableGuidanceGraph(graph: GuidanceGraph): GuidanceGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({ ...n, commands: [], rules: [] })),
    edges: graph.edges.map(storableEdge),
    contradictions: graph.contradictions.map(storableContradiction),
  };
}

function storableEdge(e: GuidanceEdge): GuidanceEdge {
  if (e.kind !== "diverges") return e; // the other kinds carry generated vocabulary only
  if (e.detail.startsWith("rule ")) return { ...e, detail: "rule: never vs always" };
  const key = e.detail.split(":")[0] ?? "";
  return { ...e, detail: DERIVED_KEY.test(key) ? `${key}: commands differ` : "commands differ" };
}

function storableContradiction(c: GuidanceContradiction, i: number): GuidanceContradiction {
  // A rule subject is up to four words lifted from the line itself; a command subject is the derived
  // key. A numbered subject keeps the reader's per-row key unique.
  const subject = c.kind === "command" && DERIVED_KEY.test(c.subject) ? c.subject : `${c.kind} ${i + 1}`;
  return {
    ...c,
    subject,
    a: { path: c.a.path, quote: ELIDED_QUOTE },
    b: { path: c.b.path, quote: ELIDED_QUOTE },
  };
}

/**
 * The manifest readout without its prose: capability commands are emptied, `purpose` and
 * `secretsFrom` are nulled, the raw `generatedFrom` placeholders are dropped, and a parse note that
 * quotes the file is dropped. Capability names, their verified/placeholder/wiredAt facts, the control
 * placement, the declared paths and the agent entrypoints are structure and are kept.
 */
export function storableManifest(m: ManifestReadout): ManifestReadout {
  return {
    ...m,
    capabilities: m.capabilities.map((c) => ({ ...c, command: "" })),
    purpose: null,
    boundaries: { neverTouch: m.boundaries.neverTouch, secretsFrom: null },
    placeholders: [],
    notes: m.notes.filter((n) => !n.includes('"')),
  };
}
