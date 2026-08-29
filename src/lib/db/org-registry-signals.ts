// `RegistrySignal` — the `signals/` lane persisted per index pass, and the audit row for every
// contribution ascent publishes back into the registry (#18).
//
// Like the usage samples, these are a SNAPSHOT: upserted on
// `(registryId, contributor, bundle, subjectSlug)`, so re-indexing the same head changes nothing.
// Contributions are the opposite — `RegistrySignalContribution` is append-only and deliberately has
// no unique key beyond its id, because the same payload may legitimately be published twice and
// collapsing those two acts would erase half the audit trail.
//
// Not barrel-exported, following the standing `org-registry*` convention.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import type { SignalRow } from "@/lib/registry/signals";

/** One persisted signal row, client-facing (timestamps are ISO strings). */
export interface RegistrySignalRow extends Omit<SignalRow, "generatedAt"> {
  generatedAt: string;
}

/** One recorded contribution back to the registry. */
export interface SignalContributionRow {
  id: string;
  contributor: string;
  prUrl: string | null;
  commitSha: string | null;
  payloadDigest: string;
  bundles: string[];
  subjects: number;
  deviations: number;
  actor: string;
  createdAt: string;
}

/** Every signal row for one org. [] when persistence is off or nobody has contributed. */
export async function listRegistrySignals(orgId: string): Promise<RegistrySignalRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().registrySignal.findMany({
    where: { orgId },
    orderBy: [{ bundle: "asc" }, { subjectSlug: "asc" }, { contributor: "asc" }],
  });
  return rows.map((r) => ({
    contributor: r.contributor,
    app: r.app,
    bundle: r.bundle,
    subjectSlug: r.subjectSlug,
    consults: r.consults,
    deviations: r.deviations,
    citResolved: r.citResolved,
    citMoved: r.citMoved,
    citGone: r.citGone,
    windowDays: r.windowDays,
    generatedAt: r.generatedAt.toISOString(),
  }));
}

/**
 * Mirror one index pass's signal rows, then drop the contributors that vanished from the lane —
 * the same rule the usage samples follow, and for the same reason: a decommissioned installation's
 * last reading must not go on speaking for the fleet.
 *
 * An empty `rows` list purges nothing. "This pass read no signals" is not "the lane was emptied",
 * and the caller (which knows whether the tree was truncated) is the only place that can tell.
 */
export async function recordRegistrySignals(
  registryId: string,
  orgId: string,
  rows: SignalRow[],
): Promise<{ written: number; purged: number }> {
  if (!isDbConfigured() || !rows.length) return { written: 0, purged: 0 };
  const prisma = getPrisma();
  let written = 0;
  for (const r of rows) {
    const contributor = r.contributor.slice(0, 200);
    const bundle = r.bundle.slice(0, 200);
    const subjectSlug = r.subjectSlug.slice(0, 200);
    if (!contributor || !bundle || !subjectSlug) continue;
    const generatedAt = Number.isFinite(Date.parse(r.generatedAt)) ? new Date(r.generatedAt) : new Date();
    const data = {
      app: r.app,
      consults: r.consults,
      deviations: r.deviations,
      citResolved: r.citResolved,
      citMoved: r.citMoved,
      citGone: r.citGone,
      windowDays: r.windowDays,
      generatedAt,
    };
    try {
      await prisma.registrySignal.upsert({
        where: { registryId_contributor_bundle_subjectSlug: { registryId, contributor, bundle, subjectSlug } },
        update: data,
        create: { registryId, orgId, contributor, bundle, subjectSlug, ...data },
      });
      written += 1;
    } catch {
      /* one malformed row degrades itself, never the pass */
    }
  }
  const seen = Array.from(new Set(rows.map((r) => r.contributor.slice(0, 200)).filter(Boolean)));
  const { count } = await prisma.registrySignal.deleteMany({
    where: { registryId, contributor: { notIn: seen } },
  });
  return { written, purged: count };
}

/**
 * Record a contribution ATTEMPT. Written before the outbound GitHub call, so a failed PR still
 * leaves the audit row — an attempt to publish is the auditable act, and only recording successes
 * would hide exactly the cases someone would later want to look at.
 */
export async function recordSignalContribution(input: {
  orgId: string;
  registryId: string;
  contributor: string;
  payloadDigest: string;
  bundles: string[];
  subjects: number;
  deviations: number;
  actor: string;
}): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const row = await getPrisma().registrySignalContribution.create({
    data: {
      orgId: input.orgId,
      registryId: input.registryId,
      contributor: input.contributor.slice(0, 200),
      payloadDigest: input.payloadDigest,
      bundlesJson: JSON.stringify(input.bundles),
      subjects: input.subjects,
      deviations: input.deviations,
      actor: input.actor.slice(0, 200),
    },
    select: { id: true },
  });
  return row.id;
}

/** Stamp the outcome onto an attempt once GitHub answered. Best-effort: the attempt is already recorded. */
export async function setSignalContributionResult(
  id: string,
  result: { prUrl?: string | null; commitSha?: string | null },
): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma()
    .registrySignalContribution.update({
      where: { id },
      data: { prUrl: result.prUrl ?? null, commitSha: result.commitSha ?? null },
    })
    .catch(() => {});
}

/** The contribution log for one org, newest first. */
export async function listSignalContributions(orgId: string, limit = 20): Promise<SignalContributionRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().registrySignalContribution.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
  });
  return rows.map((r) => ({
    id: r.id,
    contributor: r.contributor,
    prUrl: r.prUrl,
    commitSha: r.commitSha,
    payloadDigest: r.payloadDigest,
    bundles: parseBundles(r.bundlesJson),
    subjects: r.subjects,
    deviations: r.deviations,
    actor: r.actor,
    createdAt: r.createdAt.toISOString(),
  }));
}

function parseBundles(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
