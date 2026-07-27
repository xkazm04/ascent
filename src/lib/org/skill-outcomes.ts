// Adoption → outcome loop (ported from the Personas outcome pattern): did adopting a skill actually move
// the repo's readiness score? For every OrgSkillAdoption (skill, repo, adoptedAt) we pair the LATEST scan
// strictly BEFORE the adoption with the LATEST scan at-or-after it and report the overall-score delta
// (plus per-dimension deltas, which ride along free on the history read).
//
// The honesty rule is the whole design: when either side of the pair is missing, the result is an
// explicit `no-before-scan` / `no-after-scan` with NULL deltas. A skill adopted into a never-scanned repo,
// or adopted five minutes ago, has no measurable effect yet — inventing one (comparing to the org mean,
// to the first scan, to zero) would turn the library into a lie generator. Even a real delta is
// CORRELATION, not proof: other work lands in the same window. Label it as movement since adoption.
//
// Pairing is pure (pairScansAroundAdoption / skillOutcomesFor) and unit-tested; the DB half just feeds it
// getRepositoryHistory (src/lib/db/scans-read.ts) once per distinct repo.

import { getRepositoryHistory, listOrgSkillAdoptionRows, type HistoryPoint } from "@/lib/db";

/** `measured` = both sides exist. The other two are honest gaps, never a fabricated 0. */
export type OutcomeStatus = "measured" | "no-before-scan" | "no-after-scan";

/** The minimum a paired scan contributes — `HistoryPoint` satisfies it structurally. */
export interface OutcomeScan {
  id: string;
  scannedAt: string;
  overallScore: number;
  dimensions?: { dimId: string; score: number }[];
}

export interface DimensionDelta {
  dimId: string;
  before: number;
  after: number;
  delta: number;
}

export interface SkillOutcome {
  skillId: string;
  repoFullName: string;
  adoptedAt: string;
  status: OutcomeStatus;
  before: { id: string; scannedAt: string; overallScore: number } | null;
  after: { id: string; scannedAt: string; overallScore: number } | null;
  /** after − before overall score. Null unless `status === "measured"`. */
  overallDelta: number | null;
  /** Per-dimension movement for dimensions present on BOTH scans, biggest mover first. */
  dimensionDeltas: DimensionDelta[];
}

/** Why a delta is missing, in one line for the UI. */
export function outcomeStatusLabel(status: OutcomeStatus): string {
  return status === "measured"
    ? "Scored before and after adoption"
    : status === "no-before-scan"
      ? "No scan before adoption — nothing to compare against"
      : "No scan since adoption yet";
}

const scanTime = (s: { scannedAt: string }) => Date.parse(s.scannedAt);

/**
 * Latest scan strictly before `adoptedAt`, and the latest scan at-or-after it. Input order does not
 * matter (history comes back newest-first; tests feed either). A scan taken at the exact adoption
 * instant counts as AFTER — the adoption is the boundary, and the "before" side must be a state the
 * skill provably could not have influenced.
 */
export function pairScansAroundAdoption<T extends OutcomeScan>(
  scans: T[],
  adoptedAt: string,
): { before: T | null; after: T | null } {
  const at = Date.parse(adoptedAt);
  if (!Number.isFinite(at)) return { before: null, after: null };
  let before: T | null = null;
  let after: T | null = null;
  for (const s of scans) {
    const t = scanTime(s);
    if (!Number.isFinite(t)) continue;
    if (t < at) {
      if (!before || scanTime(before) < t) before = s;
    } else if (!after || scanTime(after) < t) after = s;
  }
  return { before, after };
}

/** Per-dimension movement for dimensions scored on both sides, largest absolute move first. */
function dimensionDeltas(before: OutcomeScan, after: OutcomeScan): DimensionDelta[] {
  const b = new Map((before.dimensions ?? []).map((d) => [d.dimId, d.score]));
  const out: DimensionDelta[] = [];
  for (const d of after.dimensions ?? []) {
    const prev = b.get(d.dimId);
    if (prev === undefined) continue; // a dimension only one side scored isn't a movement
    out.push({ dimId: d.dimId, before: prev, after: d.score, delta: d.score - prev });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

const lite = (s: OutcomeScan) => ({ id: s.id, scannedAt: s.scannedAt, overallScore: s.overallScore });

/** The pure core: one adoption + that repo's scan history → an outcome (or an honest gap). */
export function skillOutcomeFor(
  adoption: { skillId: string; repoFullName: string; adoptedAt: string },
  scans: OutcomeScan[],
): SkillOutcome {
  const { before, after } = pairScansAroundAdoption(scans, adoption.adoptedAt);
  const status: OutcomeStatus = !before ? "no-before-scan" : !after ? "no-after-scan" : "measured";
  return {
    ...adoption,
    status,
    before: before ? lite(before) : null,
    after: after ? lite(after) : null,
    overallDelta: before && after ? after.overallScore - before.overallScore : null,
    dimensionDeltas: before && after ? dimensionDeltas(before, after) : [],
  };
}

/** Fold a whole org's adoptions against a repo→scans lookup. Pure — the fetching is the caller's. */
export function skillOutcomesFor(
  adoptions: { skillId: string; repoFullName: string; adoptedAt: string }[],
  scansByRepo: Map<string, OutcomeScan[]>,
): Record<string, SkillOutcome[]> {
  const out: Record<string, SkillOutcome[]> = {};
  for (const a of adoptions) {
    const outcome = skillOutcomeFor(a, scansByRepo.get(a.repoFullName) ?? []);
    (out[a.skillId] ??= []).push(outcome);
  }
  return out;
}

/** How many scans back we look per repo when hunting the before/after pair. */
const HISTORY_LIMIT = 100;

/**
 * Server entry point: outcomes per skill id for an org. One history read per DISTINCT adopted repo (a
 * skill adopted by 20 repos, and 20 skills adopted by one repo, both cost one read per repo). {} when
 * persistence is off or nothing has been adopted.
 */
export async function getOrgSkillOutcomes(orgSlug: string): Promise<Record<string, SkillOutcome[]>> {
  const adoptions = await listOrgSkillAdoptionRows(orgSlug);
  if (!adoptions.length) return {};
  const repos = Array.from(new Set(adoptions.map((a) => a.repoFullName)));
  const scansByRepo = new Map<string, OutcomeScan[]>();
  await Promise.all(
    repos.map(async (fullName) => {
      const [owner, name] = fullName.split("/");
      if (!owner || !name) return;
      const history = await getRepositoryHistory(owner, name, { orgSlug, limit: HISTORY_LIMIT }).catch(() => null);
      scansByRepo.set(fullName, (history?.scans ?? []).map(toOutcomeScan));
    }),
  );
  return skillOutcomesFor(adoptions, scansByRepo);
}

const toOutcomeScan = (p: HistoryPoint): OutcomeScan => ({
  id: p.id,
  scannedAt: p.scannedAt,
  overallScore: p.overallScore,
  dimensions: p.dimensions,
});

/** The single headline an org card wants: the measured outcomes for a skill, best movement first. */
export function measuredOutcomes(outcomes: SkillOutcome[] | undefined): SkillOutcome[] {
  return (outcomes ?? [])
    .filter((o) => o.status === "measured" && o.overallDelta !== null)
    .sort((a, b) => (b.overallDelta ?? 0) - (a.overallDelta ?? 0));
}
