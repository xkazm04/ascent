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
  /**
   * What this practice has actually PUT IN MOTION: starter PRs in flight, landed, and the measured
   * average dimension lift of the landed-and-verified ones. Mined practices only (an authored playbook
   * has no starter artifact to open a PR for), and absent until the practice has been applied once.
   */
  rollout?: { open: number; merged: number; lift: number | null };
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
    ...(p.prs ? { rollout: p.prs } : {}),
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
 * G7-20 — the FLEET-LEVEL rollout rollup the per-row chrome never added up to.
 *
 * The per-practice loop was already complete before this: applying opens a real draft PR, the PR is
 * recorded onto the shared ImprovementPr lifecycle, `refreshOps` advances it open→merged, and
 * `verifyMergedPrs` stamps the measured dimension impact from the first post-merge scan — all of it
 * surfaced per row (`rollout`) and per playbook (`adoption.lift` / `.measured`). What was missing was
 * the number a leader actually asks for: across the whole library, what did this put in motion and
 * what did it move. This folds the rows that are already on screen; it adds no query and no schema.
 *
 * The two lift figures are kept SEPARATE on purpose. They are measured on different bases — a
 * playbook's lift is the dimension delta in adopting repos since the adoption mark, a practice's is
 * the delta bookended by a specific merged PR — so averaging them into one headline would invent a
 * number neither layer supports. Each carries its own sample count for the same reason.
 */
export interface PracticeRollout {
  /** Authored playbooks with at least one adopting repo. */
  playbooksAdopted: number;
  /** Distinct repos that have adopted at least one authored playbook. */
  adoptingRepos: number;
  /** Sample-weighted average dimension lift across adopting repos with a before/after scan. */
  playbookLift: number | null;
  /** Adoptions backing `playbookLift` (repos with a scan on both sides of the adoption). */
  playbookMeasured: number;
  /** Starter PRs the mined practices have in flight / landed. */
  prsOpen: number;
  prsMerged: number;
  /** Average measured dimension lift of merged+verified starter PRs, across the practices that have
   *  one. `practiceLiftSources` is how many practices back it — a one-practice average is not a fleet
   *  result, and the strip must be able to say so. */
  practiceLift: number | null;
  practiceLiftSources: number;
}

/** Fold the library's rows into {@link PracticeRollout}. Pure. */
export function summarizeRollout(rows: readonly PracticeRow[]): PracticeRollout {
  const repos = new Set<string>();
  let playbooksAdopted = 0;
  let liftWeighted = 0;
  let playbookMeasured = 0;
  let prsOpen = 0;
  let prsMerged = 0;
  let practiceLiftSum = 0;
  let practiceLiftSources = 0;

  for (const r of rows) {
    const a = r.authored?.adoption;
    if (a) {
      if (a.repos > 0) playbooksAdopted += 1;
      for (const repo of a.appliedRepos) repos.add(repo);
      // `lift` is itself a mean over `measured` applications, so weighting by `measured` recovers the
      // true pooled average instead of letting a 1-repo playbook count as much as a 12-repo one.
      if (a.lift != null && a.measured > 0) {
        liftWeighted += a.lift * a.measured;
        playbookMeasured += a.measured;
      }
    }
    if (r.rollout) {
      prsOpen += r.rollout.open;
      prsMerged += r.rollout.merged;
      if (r.rollout.lift != null) {
        practiceLiftSum += r.rollout.lift;
        practiceLiftSources += 1;
      }
    }
  }

  return {
    playbooksAdopted,
    adoptingRepos: repos.size,
    playbookLift: playbookMeasured > 0 ? Math.round(liftWeighted / playbookMeasured) : null,
    playbookMeasured,
    prsOpen,
    prsMerged,
    practiceLift: practiceLiftSources > 0 ? Math.round(practiceLiftSum / practiceLiftSources) : null,
    practiceLiftSources,
  };
}

/** True when the rollup has anything to report — a library nobody has applied yet must render no
 *  strip at all rather than a row of confident zeros. */
export function rolloutIsMeaningful(r: PracticeRollout): boolean {
  return r.adoptingRepos > 0 || r.prsOpen > 0 || r.prsMerged > 0;
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
