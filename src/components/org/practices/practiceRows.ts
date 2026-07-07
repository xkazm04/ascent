// Unified row model for the redesigned Practice Library table (prototype). Both the MINED practices
// (derived from scans — read-only, with an exemplar / gap repos / reusable "starter" shape) and the
// AUTHORED company playbooks (user-written standards) collapse into one `PracticeRow`, so a single
// dense table can list every practice — categorized by scoring dimension — with the heavy detail
// deferred to a shared modal (layer 2). Pure module: no JSX, no hooks.

import type { OrgPractice, PlaybookRow, PlaybookAdoption } from "@/lib/db";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";

export type PracticeSource = "mined" | "authored";

export interface PracticeRow {
  /** Stable React key + selection id: `${source}:${id}`. */
  key: string;
  source: PracticeSource;
  id: string;
  label: string;
  dimId: string;
  /** One-line description — the mined `what` or the authored `summary`. */
  what: string;
  /** Adoption as 0..100 for the meter, or null when not measurable. */
  adoptionPct: number | null;
  /** Compact mono readout for the adoption column ("6/12", "3 repos", "—"). */
  adoptionLabel: string;
  /** Secondary reach line ("8 could adopt" / "▲ +4 avg since"), or null. */
  reachLabel: string | null;
  /** Sort weight — biggest reuse opportunity / widest adoption first. */
  opportunity: number;
  /** Raw payload for the detail modal (exactly one is set). */
  mined?: OrgPractice;
  authored?: { playbook: PlaybookRow; adoption?: PlaybookAdoption };
}

/** "D1 · AI Tooling" — the category label used in the table + modal header. */
export function categoryLabel(dimId: string): string {
  return `${dimId} · ${DIMENSION_SHORT[dimId as DimensionId] ?? dimId}`;
}

function minedRow(p: OrgPractice): PracticeRow {
  const measured = p.total > 0;
  const pct = measured ? Math.round((p.strongCount / p.total) * 100) : null;
  return {
    key: `mined:${p.id}`,
    source: "mined",
    id: p.id,
    label: p.label,
    dimId: p.dimId,
    what: p.what,
    adoptionPct: pct,
    adoptionLabel: measured ? `${p.strongCount}/${p.total}` : "—",
    reachLabel:
      p.gapRepos.length > 0
        ? `${p.gapRepos.length} could adopt`
        : p.exemplar
          ? "well adopted"
          : null,
    // Reuse opportunity = an exemplar to copy AND repos lacking it (matches getOrgPractices' own sort).
    opportunity: (p.exemplar ? 1 : 0) * p.gapRepos.length + p.gapRepos.length / 100,
    mined: p,
  };
}

function authoredRow(pb: PlaybookRow, adoption: PlaybookAdoption | undefined, fleetSize: number): PracticeRow {
  const adopted = adoption?.repos ?? 0;
  const pct = fleetSize > 0 ? Math.round((adopted / fleetSize) * 100) : null;
  const lift = adoption?.lift ?? null;
  const reach =
    lift != null && lift !== 0 ? `${lift > 0 ? "▲ +" : "▼ "}${lift} avg ${pb.dimId} since` : null;
  return {
    key: `authored:${pb.id}`,
    source: "authored",
    id: pb.id,
    label: pb.title,
    dimId: pb.dimId,
    what: pb.summary || "Org-authored standard.",
    adoptionPct: adopted > 0 ? pct : null,
    adoptionLabel: `${adopted} repo${adopted === 1 ? "" : "s"}`,
    reachLabel: reach,
    opportunity: adopted,
    authored: { playbook: pb, adoption },
  };
}

/**
 * Merge authored playbooks + mined practices into one row list. `fleetSize` (the org's scannable repo
 * count) gives authored practices a reach denominator. Order: the org's OWN standards first (authored),
 * then mined practices by biggest reuse opportunity — so a lead sees "what we've committed to" above
 * "what the fleet could still adopt".
 */
export function buildPracticeRows(
  practices: OrgPractice[],
  playbooks: PlaybookRow[],
  adoption: Record<string, PlaybookAdoption>,
  fleetSize: number,
): PracticeRow[] {
  const authored = playbooks
    .map((pb) => authoredRow(pb, adoption[pb.id], fleetSize))
    .sort((a, b) => b.opportunity - a.opportunity || a.label.localeCompare(b.label));
  const mined = practices.map(minedRow).sort((a, b) => b.opportunity - a.opportunity);
  return [...authored, ...mined];
}
