// Saved Roadmap Sandbox scenarios — the read/write side of the SandboxScenario model.
//
// The sandbox models a repo's future in the browser: drag the per-dimension sliders, watch the whole
// hero recompute, arrive at "+12 points". Until now that model was React state. A reload erased it,
// and "commit to tracker" persisted only a status flip plus a NOTE with the delta rounded into an
// English sentence — so the override values that produced the number were stored nowhere and the
// number itself could only be recovered by parsing prose. This module makes the scenario durable and,
// once the repo is scanned again, ANSWERABLE: projected +12, actual +7.
//
// Tenancy: `orgId` is resolved server-side from the repo, never taken from the request; the route
// gates on requireOrgAccess before calling in. Same policy as org-decisions.ts.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { canonicalRepoFullName, resolveOrgId } from "@/lib/db/scans-shared";
import type { DimensionId } from "@/lib/types";

/** The saved model, as the sandbox reads it back. */
export interface SandboxScenarioRecord {
  repo: string;
  authorLogin: string;
  /** Per-dimension what-if scores. Only dimensions the user actually moved appear. */
  overrides: Partial<Record<DimensionId, number>>;
  /** recommendationDecisionKey identities of the roadmap items the scenario selected. */
  itemKeys: string[];
  baseline: { score: number; level: string; scannedAt: string };
  projected: { score: number; level: string; delta: number };
  updatedAt: string;
  /**
   * Projected-vs-actual, present ONLY once a scan NEWER than the one the scenario was modeled on has
   * landed. `delta` is the real movement over the same baseline the projection used, so the two
   * numbers are directly comparable — which is the whole reason the baseline is stored rather than
   * inferred from "current" at read time.
   */
  actual: { score: number; level: string; scannedAt: string; delta: number } | null;
}

export interface SandboxScenarioInput {
  overrides: Partial<Record<DimensionId, number>>;
  itemKeys: string[];
  baselineScore: number;
  baselineLevel: string;
  baselineScanAt: string;
  projectedScore: number;
  projectedLevel: string;
}

/** Bound what a single scenario may carry, so the row can't be used as free-text storage. */
export const MAX_SCENARIO_ITEM_KEYS = 64;

type Row = {
  repoFullName: string;
  authorLogin: string;
  overridesJson: string;
  itemKeysJson: string;
  baselineScore: number;
  baselineLevel: string;
  baselineScanAt: Date;
  projectedScore: number;
  projectedLevel: string;
  projectedDelta: number;
  updatedAt: Date;
};

const SELECT = {
  repoFullName: true,
  authorLogin: true,
  overridesJson: true,
  itemKeysJson: true,
  baselineScore: true,
  baselineLevel: true,
  baselineScanAt: true,
  projectedScore: true,
  projectedLevel: true,
  projectedDelta: true,
  updatedAt: true,
} as const;

/** Parse a stored JSON blob defensively — a hand-edited or legacy row degrades to empty, never throws. */
function parseOverrides(json: string): Partial<Record<DimensionId, number>> {
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Partial<Record<DimensionId, number>> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k as DimensionId] = Math.round(v);
    }
    return out;
  } catch {
    return {};
  }
}

function parseKeys(json: string): string[] {
  try {
    const raw: unknown = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The reconciliation half: the repo's latest scan, IF it postdates the scan the scenario was modeled
 * on. Returns null while the scenario is still describing the current scan — there is nothing to
 * reconcile yet, and reporting "actual +0" against the very scan you modeled would be a lie dressed as
 * a measurement.
 */
async function actualSince(
  orgId: string,
  fullName: string,
  baselineScanAt: Date,
  baselineScore: number,
): Promise<SandboxScenarioRecord["actual"]> {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName } },
    select: { id: true },
  });
  if (!repo) return null;
  const scan = await prisma.scan.findFirst({
    where: { repoId: repo.id, scannedAt: { gt: baselineScanAt } },
    // Same deterministic "latest first" ordering the rest of the read layer uses: scannedAt is not
    // unique, so a bare desc can resolve a tie to an arbitrary row.
    orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { overallScore: true, level: true, scannedAt: true },
  });
  if (!scan) return null;
  return {
    score: scan.overallScore,
    level: scan.level,
    scannedAt: scan.scannedAt.toISOString(),
    delta: scan.overallScore - baselineScore,
  };
}

function toRecord(row: Row, actual: SandboxScenarioRecord["actual"]): SandboxScenarioRecord {
  return {
    repo: row.repoFullName,
    authorLogin: row.authorLogin,
    overrides: parseOverrides(row.overridesJson),
    itemKeys: parseKeys(row.itemKeysJson),
    baseline: {
      score: row.baselineScore,
      level: row.baselineLevel,
      scannedAt: row.baselineScanAt.toISOString(),
    },
    projected: { score: row.projectedScore, level: row.projectedLevel, delta: row.projectedDelta },
    updatedAt: row.updatedAt.toISOString(),
    actual,
  };
}

/**
 * This author's saved scenario for this repo, with projected-vs-actual attached once a newer scan
 * exists. Null when persistence is off, the org/scenario doesn't exist, or the read fails — the
 * sandbox falls back to its ephemeral behavior, which is exactly what it did before this shipped.
 */
export async function getSandboxScenario(
  orgSlug: string,
  owner: string,
  name: string,
  authorLogin: string | null,
): Promise<SandboxScenarioRecord | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe(async () => {
    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return null;
    const repoFullName = canonicalRepoFullName(owner, name);
    const row = await getPrisma().sandboxScenario.findUnique({
      where: {
        orgId_repoFullName_authorLogin: { orgId, repoFullName, authorLogin: authorLogin ?? "" },
      },
      select: SELECT,
    });
    if (!row) return null;
    const actual = await actualSince(orgId, repoFullName, row.baselineScanAt, row.baselineScore).catch(
      () => null,
    );
    return toRecord(row, actual);
  }, null);
}

/**
 * Save (or replace) this author's scenario for this repo. One row per (org, repo, author) — re-saving
 * is an UPSERT, so "save" always means "this is my current plan", never an accumulating pile of
 * unnamed snapshots (scenario naming/comparison are explicit non-goals).
 *
 * `projectedDelta` is DERIVED here (projectedScore − baselineScore) rather than accepted from the
 * client: it is the number the reconciliation compares against, so it must be consistent with the two
 * scores stored beside it by construction.
 */
export async function saveSandboxScenario(
  orgSlug: string,
  owner: string,
  name: string,
  authorLogin: string | null,
  input: SandboxScenarioInput,
): Promise<SandboxScenarioRecord | null> {
  if (!isDbConfigured()) return null;
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repoFullName = canonicalRepoFullName(owner, name);
  const baselineScanAt = new Date(input.baselineScanAt);
  if (Number.isNaN(baselineScanAt.getTime())) return null;

  const data = {
    overridesJson: JSON.stringify(input.overrides ?? {}),
    itemKeysJson: JSON.stringify((input.itemKeys ?? []).slice(0, MAX_SCENARIO_ITEM_KEYS)),
    baselineScore: input.baselineScore,
    baselineLevel: input.baselineLevel,
    baselineScanAt,
    projectedScore: input.projectedScore,
    projectedLevel: input.projectedLevel,
    projectedDelta: input.projectedScore - input.baselineScore,
  };

  const row = await getPrisma().sandboxScenario.upsert({
    where: {
      orgId_repoFullName_authorLogin: { orgId, repoFullName, authorLogin: authorLogin ?? "" },
    },
    update: data,
    create: { orgId, repoFullName, authorLogin: authorLogin ?? "", ...data },
    select: SELECT,
  });
  const actual = await actualSince(orgId, repoFullName, row.baselineScanAt, row.baselineScore).catch(
    () => null,
  );
  return toRecord(row, actual);
}

/** Discard this author's scenario for this repo. Idempotent — deleting nothing is a success. */
export async function deleteSandboxScenario(
  orgSlug: string,
  owner: string,
  name: string,
  authorLogin: string | null,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return false;
  await getPrisma()
    .sandboxScenario.deleteMany({
      where: { orgId, repoFullName: canonicalRepoFullName(owner, name), authorLogin: authorLogin ?? "" },
    })
    .catch(() => null);
  return true;
}
