// The Guidance Coherence card's read model (moonshot #15) — one row per repo, projected from the
// arbiter's verdict cached on `Repository.guidanceGraphJson`.
//
// HONESTY RULES this model exists to enforce, all of them the same rule:
//   · `coherence: null` = the latest scan PREDATES rubric r11, or the repo has no guidance document
//     at all. Both render "not assessed" / "no guidance" and are EXCLUDED from the fleet denominator.
//     A repo nobody assessed is not a repo scoring zero, and painting one as 0 is a fabricated verdict.
//   · a repo with contradictions is COUNTED, never flagged as failing: the whole design is that a
//     contradiction withholds points and is never a penalty, an alert or a gate failure (G4/G5).
//   · every penalty carries the paths it was read from, so the number on the card re-traces to the
//     two files that produced it.

import type { GuidanceContradiction, GuidanceGraph } from "@/lib/types";
import type { OrgRepoRow } from "@/lib/db/org-rollup";

/** How a vendor guidance file relates to the canonical one, for the per-format chip row. */
export interface ProjectionChip {
  path: string;
  agent: string;
  state: "canonical" | "in-sync" | "stale" | "independent" | "unsampled";
}

export interface RepoCoherenceRow {
  fullName: string;
  name: string;
  /** The latest scan produced a guidance graph (r11+). False renders "not assessed — re-scan". */
  assessed: boolean;
  /** 0..100, or null: no guidance document (or not assessed). NEVER rendered as 0. */
  coherence: number | null;
  documents: number;
  canonical: string | null;
  canonicalBasis: GuidanceGraph["canonicalBasis"];
  projections: ProjectionChip[];
  contradictions: GuidanceContradiction[];
  penalties: GuidanceGraph["penalties"];
  /** One sentence a reader can act on. */
  verdict: string;
}

export const BASIS_LABEL: Record<NonNullable<GuidanceGraph["canonicalBasis"]>, string> = {
  manifest: "declared in .ai/manifest.yaml",
  pointer: "every other file points at it",
  "projection-header": "named by a generated-from header",
  rank: "the only guidance document",
};

/** The human sentence for one row. Deliberately never a grade — it says what is true and what to do. */
function verdictFor(graph: GuidanceGraph | null): string {
  if (!graph) return "Not assessed by this scan — re-scan to read the guidance layer.";
  if (graph.nodes.length === 0) return "No agent guidance document found.";
  if (graph.nodes.length === 1) return "One guidance document — nothing to disagree with it.";
  if (graph.contradictions.length > 0)
    return `${graph.contradictions.length} contradiction(s): an agent gets a different answer depending on which file it opened.`;
  if (!graph.canonical) return "No canonical source is nominated — declare `guidance.canonical` in .ai/manifest.yaml.";
  return `${graph.nodes.length} documents, all consistent with ${graph.canonical}.`;
}

function chipsFor(graph: GuidanceGraph): ProjectionChip[] {
  const projectsFrom = new Map(graph.edges.filter((e) => e.kind === "projects-from").map((e) => [e.from, e.detail]));
  return graph.nodes.map((n) => {
    const state: ProjectionChip["state"] =
      n.path === graph.canonical
        ? "canonical"
        : !n.contentSampled
          ? "unsampled"
          : projectsFrom.has(n.path)
            ? projectsFrom.get(n.path) === "in-sync"
              ? "in-sync"
              : "stale"
            : "independent";
    return { path: n.path, agent: n.agent, state };
  });
}

export function buildCoherenceRows(repos: readonly OrgRepoRow[]): RepoCoherenceRow[] {
  return repos.map((r) => {
    const g = r.guidanceGraph;
    return {
      fullName: r.fullName,
      name: r.name,
      assessed: g != null,
      coherence: g?.coherence ?? null,
      documents: g?.nodes.length ?? 0,
      canonical: g?.canonical ?? null,
      canonicalBasis: g?.canonicalBasis ?? null,
      projections: g ? chipsFor(g) : [],
      contradictions: g?.contradictions ?? [],
      penalties: g?.penalties ?? [],
      verdict: verdictFor(g),
    };
  });
}

export interface CoherenceFleetSummary {
  /** Repos whose latest scan produced a coherence number — the ONLY denominator any share uses. */
  measured: number;
  /** Repos excluded from that denominator: not assessed, or no guidance document to assess. */
  unmeasured: number;
  contradicting: number;
  /** Mean coherence over `measured`, or null when nothing was measured. */
  meanCoherence: number | null;
  /** The fleet-count sentence, which NAMES its own denominator. */
  headline: string;
}

export function coherenceFleetSummary(rows: readonly RepoCoherenceRow[]): CoherenceFleetSummary {
  const measured = rows.filter((r) => r.coherence != null);
  const contradicting = measured.filter((r) => r.contradictions.length > 0).length;
  const mean = measured.length
    ? Math.round(measured.reduce((a, r) => a + (r.coherence ?? 0), 0) / measured.length)
    : null;
  const unmeasured = rows.length - measured.length;
  // The denominator is part of the claim. "3 repos have contradicting guidance" out of an unstated
  // population is the shape of statement that gets quoted back without its caveat.
  const headline = measured.length
    ? `${contradicting} of ${measured.length} assessed repositor${measured.length === 1 ? "y" : "ies"} have contradicting agent guidance` +
      (unmeasured ? ` (${unmeasured} not assessed or carrying no guidance document — excluded)` : "")
    : "No repository has been assessed for guidance coherence yet — re-scan to read it.";
  return { measured: measured.length, unmeasured, contradicting, meanCoherence: mean, headline };
}

/** Worst first: the repos where an agent is most likely to be reading the wrong instructions. */
export function orderByIncoherence(rows: readonly RepoCoherenceRow[]): RepoCoherenceRow[] {
  return [...rows].sort((a, b) => {
    if ((a.coherence == null) !== (b.coherence == null)) return a.coherence == null ? 1 : -1;
    return (a.coherence ?? 0) - (b.coherence ?? 0) || a.fullName.localeCompare(b.fullName);
  });
}
