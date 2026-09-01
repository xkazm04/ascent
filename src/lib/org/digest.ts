// Weekly digest — assembly over the existing org aggregates for the trailing 7 calendar days.
//
// This module adds NO queries of its own. Every number comes from an aggregate that already exists
// and is already tested (`getOrgRollup`, `getOrgMovers`, `getOrgRecommendations`, `getOrgEngineMix`)
// plus the one week-shaped read the digest genuinely needed (`org-followups-week.ts`). The job here is
// composition and, more than that, HONEST DEGRADATION.
//
// The window is fixed, not selectable: `weekRangeParams(now)` → `resolveWindow`, i.e. the trailing 7
// CALENDAR days in the org's canonical zone, half-open `[start, endExclusive)`. A digest whose period
// depended on a cookie or a query string would mean two people reading "this week" saw two weeks.
//
// DEGRADATION IS THE DESIGN. Seven reads fan out in parallel and each is wrapped `.catch(() => null)`,
// because one unavailable aggregate must not blank a leadership update that six healthy aggregates
// could still fill. What a failure must never do is disappear: every degraded read appends one
// sentence to `provenance.notes`, which the markdown prints in the footer. The alternative — a section
// silently missing — is the failure mode that makes a report untrustworthy, because a reader cannot
// tell "nothing happened" from "we could not look".
//
// The one read that is NOT optional is the rollup: with no fleet standing there is no digest, so a
// null rollup (or a fleet with nothing scanned) returns null and the caller renders an empty state.

import { getOrgRollup, type OrgWindow } from "@/lib/db/org-rollup";
import { getOrgMovers, getOrgRecommendations, type OrgMovers, type OrgRec, type RepoMove } from "@/lib/db/org-insights";
import { getOrgEngineMix } from "@/lib/db/org";
import {
  countScansInWindow,
  getFollowupsClosedInWindow,
  getFollowupsOpenedInWindow,
  type ClosedInWindow,
  type OpenedInWindow,
} from "@/lib/db/org-followups-week";
import { engineMixCaveat, nextMoveLine } from "@/lib/org/briefing";
import { DIMENSION_BY_ID, levelForScore } from "@/lib/maturity/model";
import { isWithinNoise } from "@/lib/maturity/noise";
import { resolveWindow, weekRangeParams } from "@/lib/window";
import type { DimensionId } from "@/lib/types";
import type {
  DigestAction,
  DigestBand,
  DigestDimDelta,
  DigestFollowups,
  DigestMover,
  DigestMovement,
  WeeklyDigest,
} from "./digest-types";

export type { WeeklyDigest } from "./digest-types";

const dimLabel = (dimId: string): string => DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId;

const repositories = (n: number): string => `${n} repositor${n === 1 ? "y" : "ies"}`;

/** The presentation verdict on a delta, fixed HERE so the page and the markdown print the same word
 *  for the same number. `null` is "unmeasured", which is emphatically not 0; a delta inside the
 *  canonical noise band is "flat", because a +1 must not wear the same arrow as a +8. */
function bandFor(delta: number | null): DigestBand {
  if (delta == null) return "unmeasured";
  if (isWithinNoise(delta)) return "flat";
  return delta > 0 ? "up" : "down";
}

/** The shorter one-line form for ranks 2 and 3 — rank 1 gets `nextMoveLine`, the sentence the
 *  executive briefing and the board PDF already share, so the fleet's top move reads identically
 *  wherever it is printed. */
function supportingLine(rec: OrgRec): string {
  const gain = rec.projectedPoints != null ? `, ≈ +${rec.projectedPoints} pts each` : "";
  return `${rec.title} (${rec.dimId} ${dimLabel(rec.dimId)}, ${rec.impact} impact, ${repositories(rec.repoCount)}${gain})`;
}

function toAction(rec: OrgRec, rank: 1 | 2 | 3, scanned: number): DigestAction {
  return {
    rank,
    title: rec.title,
    dimId: rec.dimId,
    dimLabel: dimLabel(rec.dimId),
    impact: rec.impact,
    repoCount: rec.repoCount,
    projectedPoints: rec.projectedPoints,
    liftsRepos: rec.liftsRepos,
    line: rank === 1 ? nextMoveLine(rec, scanned) : supportingLine(rec),
  };
}

function toMover(m: RepoMove): DigestMover {
  return { name: m.name, fullName: m.fullName, dOverall: m.dOverall, levelFrom: m.levelFrom, levelTo: m.levelTo };
}

/** Assemble the weekly digest for an org. Null when nothing has been scanned. */
export async function buildWeeklyDigest(orgSlug: string, now: Date = new Date()): Promise<WeeklyDigest | null> {
  const params = weekRangeParams(now);
  const resolved = resolveWindow(params, now);
  // One window value, one closure convention, handed to every read — so no two sections of the same
  // digest can disagree about a boundary row.
  const window: OrgWindow = { start: resolved.start, endExclusive: resolved.endExclusive };

  const notes: string[] = [];
  const degraded = (note: string) => (): null => {
    notes.push(note);
    return null;
  };

  const [rollup, movers, recs, mix, closed, opened, scansInWindow] = await Promise.all([
    getOrgRollup(orgSlug, window).catch(degraded("The fleet rollup could not be read.")),
    getOrgMovers(orgSlug, window).catch(degraded("Repository movement could not be read.")),
    getOrgRecommendations(orgSlug, 3).catch(degraded("The recommendation ranking could not be read.")),
    getOrgEngineMix(orgSlug, window).catch(degraded("The scoring-engine mix could not be read.")),
    // No note here: `buildFollowups` owns the one sentence for this failure, so a dead closed-read
    // reports itself once rather than twice.
    getFollowupsClosedInWindow(orgSlug, window).catch((): ClosedInWindow | null => null),
    // A null here is AMBIGUOUS on purpose: it is both "the read failed" and the legitimate verdict
    // "unmeasurable — no repository has a pre-window scan". Neither gets a note, because
    // `openedMeasurable: false` already says the honest thing on the page, and a note claiming a
    // failure where the answer is simply not knowable would be its own small lie.
    getFollowupsOpenedInWindow(orgSlug, window).catch((): OpenedInWindow | null => null),
    countScansInWindow(orgSlug, window).catch(degraded("The scan count for the week could not be read.")),
  ]);

  // The rollup is load-bearing: no standing, no digest.
  if (!rollup || rollup.scannedCount === 0) return null;

  const scanned = rollup.scannedCount;
  const level = levelForScore(rollup.avgOverall);
  const movement = rollup.movement;

  const deltaByDim = new Map((rollup.dimDeltas ?? []).map((d) => [d.dimId, d.delta] as const));
  const dims: DigestDimDelta[] = [...rollup.dimAverages]
    .sort((a, b) => a.dimId.localeCompare(b.dimId))
    .map((d) => {
      const delta = deltaByDim.has(d.dimId) ? (deltaByDim.get(d.dimId) as number) : null;
      return { dimId: d.dimId, label: dimLabel(d.dimId), now: d.avg, delta, band: bandFor(delta) };
    });

  const followups = buildFollowups(closed, opened, scanned, notes);

  const actions: DigestAction[] = (recs ?? [])
    .slice(0, 3)
    .map((rec, i) => toAction(rec, (i + 1) as 1 | 2 | 3, scanned));

  const digestMovement = movers ? buildMovement(movers) : null;

  const startIso = resolved.start ? resolved.start.toISOString() : now.toISOString();
  const endIso = resolved.endExclusive ? resolved.endExclusive.toISOString() : now.toISOString();

  return {
    org: orgSlug,
    generatedOn: now.toISOString().slice(0, 10),
    window: { from: params.from, to: params.to, start: startIso, endExclusive: endIso, title: resolved.title },
    headline: {
      overall: rollup.avgOverall,
      adoption: rollup.avgAdoption,
      rigor: rollup.avgRigor,
      levelId: level.id,
      levelName: level.name,
      // The four fields below are null/zero TOGETHER: a cohort-matched delta without its denominator
      // cannot be read (see CohortMovement in org-rollup.ts), so the digest never carries one alone.
      dOverall: movement ? movement.overall : null,
      dAdoption: movement ? movement.adoption : null,
      dRigor: movement ? movement.rigor : null,
      cohortSize: movement ? movement.cohortSize : null,
      onboarded: movement?.onboarded ?? 0,
      departed: movement?.departed ?? 0,
      scanned,
      total: rollup.repoCount,
    },
    dims,
    followups,
    actions,
    movement: digestMovement,
    provenance: {
      scansInWindow,
      // Empty mix is not a degradation — it is an org that was not scanned this week, which the
      // coverage line already states. Only a mix WITH mock scores in it earns a caveat.
      engineCaveat: mix && mix.length ? engineMixCaveat(mix) : null,
      notes,
    },
  };
}

/** Compose the follow-up block from the two independent reads, preserving what each one could and
 *  could not answer. Mutates `notes` when the closed read — the only half whose zero would be a
 *  fabrication the reader cannot detect — is unavailable. */
function buildFollowups(
  closed: ClosedInWindow | null,
  opened: OpenedInWindow | null,
  scanned: number,
  notes: string[],
): DigestFollowups | null {
  if (!closed) {
    notes.push("Follow-up activity could not be read.");
    return null;
  }
  return {
    closed: closed.closed,
    dismissed: closed.dismissed,
    closedRows: closed.rows,
    opened: opened ? opened.opened : 0,
    openedRows: opened ? opened.rows : [],
    openedMeasurable: opened != null,
    // With no measurable diff at all, EVERY scanned repository is one the diff could not speak for —
    // reporting 0 there would imply the exclusion was empty.
    unmeasuredRepos: opened ? opened.unmeasuredRepos : scanned,
  };
}

/** Top 3 climbers and top 3 sliders, with the count of repositories that had a real comparison.
 *  `comparedRepos` deliberately excludes repos onboarded mid-window (G4-06) — their move is a lifetime
 *  delta, not a week's. */
function buildMovement(movers: OrgMovers): DigestMovement {
  return {
    gainers: movers.gainers.slice(0, 3).map(toMover),
    regressers: movers.regressers.slice(0, 3).map(toMover),
    compared: movers.comparedRepos,
  };
}
