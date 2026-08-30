// MOONSHOT #33 — the practice adoption ledger.
//
// Before this, "adoption" was a PR fact: `ImprovementPr` knew a starter PR had been opened and, after
// a rescan, roughly what dimension points it bought. Nothing knew whether the artifact was STILL THERE
// a month later, whether someone had gutted it, or which version of the org's own house pattern it came
// from. So a fleet that adopted a practice in March and let it rot in June looked identical to one that
// still lives by it, and an org whose pattern moved v1 → v3 had no way to see who was behind.
//
// This module makes adoption a stateful per-repo projection: proposed → adopted → drifted / removed,
// with self-healing back to adopted. Three rules hold it honest, and each is enforced somewhere:
//
//   · THE BASELINE IS WHAT LANDED (`adoptedHash`, stamped from the first post-merge scan), never the
//     body ascent proposed — see src/lib/practices/reconcile.ts, where the whole transition table lives
//     as a pure function precisely so it is testable without a database.
//   · MERGE DETECTION IS READ-ONLY. `ImprovementPr` belongs to the improvement ledger (#9/#26); this
//     module reads `state: "merged"` rows and never writes that table.
//   · DRIFT IS A FINDING, NOT A TRIGGER. Nothing here re-applies anything. A transition becomes a
//     decidable row in the Follow-ups worklist (src/lib/org/findings.ts) and stops there; "we looked
//     and chose to leave it" is a valid outcome, and an auto-reapply would take that choice away.
//
// ORG-INTERNAL. Adoption rows never reach a public report, the leaderboard, the shared corpus or
// another tenant. The census they are reconciled against carries digests and paths, never bodies.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { getLatestHousePattern, getLatestHousePatterns } from "@/lib/db/house-pattern-versions";
import { reconcileAdoption, tallyTransitions, type LedgerRow } from "@/lib/practices/reconcile";
import type { RepoPracticeShape } from "@/lib/analyze/practice-shape";

/** Where an adoption came from. `house` is the only source that is version-tracked. */
export type AdoptionSource = "generic" | "house" | "registry" | "playbook";

export const ADOPTION_STATES = ["proposed", "adopted", "drifted", "removed", "superseded"] as const;
export type AdoptionState = (typeof ADOPTION_STATES)[number];

/** One ledger row on the wire. Every timestamp is a `string` (wire-safe-dates). */
export interface PracticeAdoptionRow {
  id: string;
  repoFullName: string;
  /** Catalog id, `registry:<slug>` or `playbook:<uuid>`. */
  practiceId: string;
  source: AdoptionSource;
  /** `HousePatternVersion.version` when `source === "house"`; null means NOT VERSION-TRACKED, not v0. */
  patternVersion: number | null;
  artifactPath: string;
  state: AdoptionState;
  prNumber: number | null;
  adoptedAt: string | null;
  driftedAt: string | null;
  lastCheckedAt: string | null;
}

/** Per-practice adoption counts for the ledger table's column. */
export interface PracticeAdoptionCounts {
  adopted: number;
  behind: number;
  drifted: number;
}

export interface PracticeAdoptionSummary {
  /** Distinct repos with at least one `adopted` row. */
  adoptedRepos: number;
  /** Distinct repos carrying a house adoption older than the org's latest pattern for that practice. */
  behindRepos: number;
  /** Distinct repos with at least one `drifted` or `removed` row. */
  driftedRepos: number;
  /** The practice with the widest version gap, for the Behind tile's sub-line. Null when none is behind. */
  widestGap: { practiceId: string; fromVersion: number; toVersion: number; repos: number } | null;
  /** Per-practice counts, keyed by practiceId — display only. */
  perPractice: Record<string, PracticeAdoptionCounts>;
  /** Rows in the ledger at all. Zero means the strip renders NOTHING (the lift strip's rule). */
  total: number;
}

const EMPTY_SUMMARY: PracticeAdoptionSummary = {
  adoptedRepos: 0,
  behindRepos: 0,
  driftedRepos: 0,
  widestGap: null,
  perPractice: {},
  total: 0,
};

const asSource = (v: string): AdoptionSource =>
  v === "house" || v === "registry" || v === "playbook" ? v : "generic";
const asState = (v: string): AdoptionState =>
  (ADOPTION_STATES as readonly string[]).includes(v) ? (v as AdoptionState) : "proposed";

interface AdoptionRecord {
  id: string;
  repoFullName: string;
  practiceId: string;
  source: string;
  patternVersion: number | null;
  artifactPath: string;
  state: string;
  prNumber: number | null;
  adoptedAt: Date | null;
  driftedAt: Date | null;
  lastCheckedAt: Date | null;
}

function toRow(r: AdoptionRecord): PracticeAdoptionRow {
  return {
    id: r.id,
    repoFullName: r.repoFullName,
    practiceId: r.practiceId,
    source: asSource(r.source),
    patternVersion: r.patternVersion,
    artifactPath: r.artifactPath,
    state: asState(r.state),
    prNumber: r.prNumber,
    adoptedAt: r.adoptedAt?.toISOString() ?? null,
    driftedAt: r.driftedAt?.toISOString() ?? null,
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
  };
}

const ROW_SELECT = {
  id: true,
  repoFullName: true,
  practiceId: true,
  source: true,
  patternVersion: true,
  artifactPath: true,
  state: true,
  prNumber: true,
  adoptedAt: true,
  driftedAt: true,
  lastCheckedAt: true,
} as const;

/**
 * Stamp a `proposed` adoption beside the PR that carries it. Upserted on the 4-tuple
 * (org, repo, practice, artifactPath) — the identity of "this file, in this repo, for this practice".
 *
 * NEVER THROWS, and deliberately: by the time this runs the draft PR EXISTS on GitHub. Surfacing a
 * bookkeeping failure as an error sends the caller to retry and open a duplicate, so "PR opened but a
 * follow-up step failed" must never look like "PR not opened" — the same contract `recordPracticePr`
 * and `applyPlaybookToRepo`'s bookkeeping block already hold.
 *
 * A re-apply refreshes `proposedHash`/`patternVersion` and resets state to `proposed` ONLY from
 * `removed`: re-proposing over a live `adopted` row would throw away the landed baseline that drift is
 * measured against, and re-proposing over `drifted` would silently answer a finding the user has not
 * decided.
 */
export async function recordProposedAdoption(input: {
  orgId: string;
  repoFullName: string;
  practiceId: string;
  source: AdoptionSource;
  patternVersion: number | null;
  artifactPath: string;
  proposedHash: string;
  prNumber: number | null;
  improvementPrId?: string | null;
}): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    const prisma = getPrisma();
    const key = {
      orgId_repoFullName_practiceId_artifactPath: {
        orgId: input.orgId,
        repoFullName: input.repoFullName,
        practiceId: input.practiceId,
        artifactPath: input.artifactPath,
      },
    };
    const existing = await prisma.practiceAdoption.findUnique({ where: key, select: { state: true } });
    const data = {
      source: input.source,
      patternVersion: input.patternVersion,
      proposedHash: input.proposedHash,
      prNumber: input.prNumber,
      improvementPrId: input.improvementPrId ?? null,
    };
    if (existing) {
      await prisma.practiceAdoption.update({
        where: key,
        data: existing.state === "removed" ? { ...data, state: "proposed" } : data,
      });
      return;
    }
    await prisma.practiceAdoption.create({
      data: { orgId: input.orgId, repoFullName: input.repoFullName, practiceId: input.practiceId, artifactPath: input.artifactPath, ...data },
    });
  } catch (err) {
    // LOUDLY, as recordPracticePr does: a silent ledger is worse than a noisy one, because the row's
    // absence later reads as "this repo never adopted it".
    console.error(
      "[practice-adoption] failed to record a proposed adoption",
      { repo: input.repoFullName, practiceId: input.practiceId },
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Reconcile one repo's ledger against the census a scan just took. Returns the transition tally, or
 * `null` when there was nothing to reconcile — persistence off, no ledger rows, or a **v1 shape with
 * no census at all**, which is not evidence of anything and must not be read as "every file is gone".
 *
 * Called best-effort from `scan-finalize.ts` after the scan has persisted; a failure logs and returns
 * null. A scan must never fail because a projection could not be updated.
 */
export async function reconcilePracticeAdoption(
  orgId: string,
  repoFullName: string,
  scanId: string,
  shape: RepoPracticeShape | null | undefined,
): Promise<{ drifted: number; removed: number; adopted: number } | null> {
  if (!isDbConfigured()) return null;
  // An absent census is UNKNOWN. Only a v2 shape has actually looked.
  if (!shape || !Array.isArray(shape.artifacts)) return null;
  try {
    const prisma = getPrisma();
    const rows = await prisma.practiceAdoption.findMany({
      where: { orgId, repoFullName },
      select: { id: true, artifactPath: true, state: true, adoptedHash: true, adoptedOutline: true, practiceId: true },
    });
    if (rows.length === 0) return null;

    // Merge detection, READ-ONLY: which of this repo's practices have a merged ImprovementPr. Scoped
    // to the practice ids actually in the ledger so the query stays small.
    const merged = new Set(
      (
        await prisma.improvementPr.findMany({
          where: { orgId, repoFullName, state: "merged", practiceId: { in: [...new Set(rows.map((r) => r.practiceId))] } },
          select: { practiceId: true },
        })
      ).map((p) => p.practiceId),
    );

    const ledger: LedgerRow[] = rows.map((r) => ({
      id: r.id,
      artifactPath: r.artifactPath,
      state: r.state,
      adoptedHash: r.adoptedHash,
      adoptedOutline: r.adoptedOutline,
      // A playbook PR bypasses ImprovementPr entirely (applyPlaybookToRepo opens it directly), so it
      // has no merge fact to read. Treating it as merged would claim an adoption that may still be an
      // open draft; treating it as never-merged would strand it in `proposed` forever. The file being
      // PRESENT in the default-branch tree IS the merge evidence for that path, which is precisely what
      // the census reports — so a playbook row is admitted on presence alone.
      merged: r.practiceId.startsWith("playbook:") || merged.has(r.practiceId),
    }));

    const transitions = reconcileAdoption(ledger, shape.artifacts, shape.truncated === true);
    const now = new Date();
    for (const t of transitions) {
      const base = { lastCheckedAt: now, lastScanId: scanId };
      if (t.to === "checked") {
        await prisma.practiceAdoption.update({ where: { id: t.id }, data: base });
      } else if (t.to === "adopted") {
        await prisma.practiceAdoption.update({
          where: { id: t.id },
          data: { ...base, state: "adopted", adoptedHash: t.adoptedHash, adoptedOutline: t.adoptedOutline, adoptedAt: now, driftedAt: null },
        });
      } else if (t.to === "drifted") {
        await prisma.practiceAdoption.update({ where: { id: t.id }, data: { ...base, state: "drifted", driftedAt: now } });
      } else {
        await prisma.practiceAdoption.update({ where: { id: t.id }, data: { ...base, state: "removed", driftedAt: now } });
      }
    }
    // Rows the reconciler had nothing to say about still got LOOKED at, and the strip's "last checked"
    // reading would otherwise imply they were never examined.
    const touched = new Set(transitions.map((t) => t.id));
    const untouched = rows.filter((r) => !touched.has(r.id)).map((r) => r.id);
    if (untouched.length > 0) {
      await prisma.practiceAdoption.updateMany({ where: { id: { in: untouched } }, data: { lastCheckedAt: now, lastScanId: scanId } });
    }
    return tallyTransitions(transitions);
  } catch (err) {
    console.error("[practice-adoption] reconcile failed", repoFullName, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fold rows + the org's latest patterns into the strip's reading. PURE, exported for its test.
 *
 * "Behind" is a HOUSE-ONLY notion. A `generic` / `registry` / `playbook` row has `patternVersion:
 * null` — not version-tracked — and must never be counted behind, which is the same mistake as reading
 * that null as v0.
 */
export function foldAdoptionSummary(
  rows: readonly PracticeAdoptionRow[],
  latestVersions: Readonly<Record<string, number>>,
): PracticeAdoptionSummary {
  if (rows.length === 0) return EMPTY_SUMMARY;
  const adopted = new Set<string>();
  const behind = new Set<string>();
  const drifted = new Set<string>();
  const perPractice: Record<string, PracticeAdoptionCounts> = {};
  // practiceId -> { oldest version still in the field, repos behind }
  const gaps = new Map<string, { fromVersion: number; repos: Set<string> }>();

  for (const r of rows) {
    const p = (perPractice[r.practiceId] ??= { adopted: 0, behind: 0, drifted: 0 });
    if (r.state === "adopted") {
      adopted.add(r.repoFullName);
      p.adopted += 1;
      const latest = latestVersions[r.practiceId];
      if (r.source === "house" && r.patternVersion !== null && latest !== undefined && r.patternVersion < latest) {
        behind.add(r.repoFullName);
        p.behind += 1;
        const g = gaps.get(r.practiceId) ?? { fromVersion: r.patternVersion, repos: new Set<string>() };
        g.fromVersion = Math.min(g.fromVersion, r.patternVersion);
        g.repos.add(r.repoFullName);
        gaps.set(r.practiceId, g);
      }
    } else if (r.state === "drifted" || r.state === "removed") {
      drifted.add(r.repoFullName);
      p.drifted += 1;
    }
  }

  // The widest gap by version distance, ties broken by repo count then practiceId so the tile's
  // sub-line is stable across renders rather than flickering between equal candidates.
  let widestGap: PracticeAdoptionSummary["widestGap"] = null;
  for (const [practiceId, g] of [...gaps.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const toVersion = latestVersions[practiceId]!;
    const span = toVersion - g.fromVersion;
    const bestSpan = widestGap ? widestGap.toVersion - widestGap.fromVersion : -1;
    if (span > bestSpan || (span === bestSpan && widestGap !== null && g.repos.size > widestGap.repos)) {
      widestGap = { practiceId, fromVersion: g.fromVersion, toVersion, repos: g.repos.size };
    }
  }

  return {
    adoptedRepos: adopted.size,
    behindRepos: behind.size,
    driftedRepos: drifted.size,
    widestGap,
    perPractice,
    total: rows.length,
  };
}

/** The Practices tab's adoption reading. Degrades to the empty summary (strip renders nothing). */
export async function getPracticeAdoptionSummary(orgSlug: string): Promise<PracticeAdoptionSummary> {
  try {
    const [rows, patterns] = await Promise.all([
      listPracticeAdoptions(orgSlug),
      getLatestHousePatterns(orgSlug),
    ]);
    const latest: Record<string, number> = {};
    for (const [practiceId, p] of Object.entries(patterns)) latest[practiceId] = p.version;
    return foldAdoptionSummary(rows, latest);
  } catch (err) {
    console.error("[practice-adoption] summary failed", err instanceof Error ? err.message : err);
    return EMPTY_SUMMARY;
  }
}

/**
 * Repos carrying an `adopted` HOUSE artifact for `practiceId` older than the org's latest pattern —
 * the rollout's "behind" target set. Empty (never a guess) when the org has no pattern for it.
 */
export async function listBehindRepos(orgSlug: string, practiceId: string): Promise<{ latestVersion: number | null; repos: string[] }> {
  if (!isDbConfigured()) return { latestVersion: null, repos: [] };
  const org = await getOrgBySlug(orgSlug);
  if (!org) return { latestVersion: null, repos: [] };
  const latest = await getLatestHousePattern(org.id, practiceId);
  if (!latest) return { latestVersion: null, repos: [] };
  const rows = await getPrisma().practiceAdoption.findMany({
    where: {
      orgId: org.id,
      practiceId,
      source: "house",
      state: "adopted",
      patternVersion: { lt: latest.version },
    },
    select: { repoFullName: true },
  });
  return { latestVersion: latest.version, repos: [...new Set(rows.map((r) => r.repoFullName))].sort() };
}

/** Repos whose adoption of `practiceId` has drifted or been removed — the other rollout target set. */
export async function listDriftedRepos(
  orgSlug: string,
  practiceId: string,
): Promise<{ drifted: string[]; removed: string[] }> {
  if (!isDbConfigured()) return { drifted: [], removed: [] };
  const org = await getOrgBySlug(orgSlug);
  if (!org) return { drifted: [], removed: [] };
  const rows = await getPrisma().practiceAdoption.findMany({
    where: { orgId: org.id, practiceId, state: { in: ["drifted", "removed"] } },
    select: { repoFullName: true, state: true },
  });
  const pick = (s: string) => [...new Set(rows.filter((r) => r.state === s).map((r) => r.repoFullName))].sort();
  return { drifted: pick("drifted"), removed: pick("removed") };
}

/** Every live ledger row of `orgSlug` (superseded rows excluded). Empty when persistence is off. */
export async function listPracticeAdoptions(orgSlug: string): Promise<PracticeAdoptionRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const rows = await getPrisma().practiceAdoption.findMany({
    where: { orgId: org.id, state: { not: "superseded" } },
    orderBy: [{ practiceId: "asc" }, { repoFullName: "asc" }],
    select: ROW_SELECT,
  });
  return rows.map(toRow);
}
