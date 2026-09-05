// AI-usage storage for the provider integrations (increment 2). recordUsage() ingests normalized
// records (idempotent by the (org, source, scope, scopeKey, period) unique key); getOrgUsageRollup()
// aggregates a recent window into the shape the /delivery AI ROI resolver consumes — measured per-repo
// spend (scope=repo) and allocated org totals (scope=org). Guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";

export type UsageScope = "repo" | "user" | "team" | "org";
export type UsageFidelity = "measured" | "allocated";

export interface UsageRecordInput {
  source: string; // "claude-code" | "copilot" | "openai"
  scope: UsageScope;
  scopeKey: string; // repo fullName | user email | team slug | org slug
  periodStart: Date; // UTC bucket start (day/month)
  tokens?: number;
  costCents?: number;
  sessions?: number;
  seats?: number;
  fidelity: UsageFidelity;
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/**
 * Upsert usage records for an org. `mode` controls how an existing (org, source, scope, scopeKey, day)
 * row is updated:
 *   - "replace" (default) — set the values. For batch/period reposts (the JSON contract, the demo seed):
 *     re-sending a period is idempotent.
 *   - "add" — increment tokens/cost/sessions. For OTLP counter streams that arrive as increments; seats
 *     (a level, not additive) is replaced with the latest observed value.
 * Skips malformed rows; returns how many were stored.
 */
export async function recordUsage(
  orgSlug: string,
  records: UsageRecordInput[],
  opts?: { mode?: "replace" | "add" },
): Promise<{ ok: boolean; stored: number; error?: string }> {
  if (!isDbConfigured()) return { ok: false, stored: 0, error: "Database not configured." };
  const org = await getOrgBySlug(orgSlug);
  if (!org) return { ok: false, stored: 0, error: "Unknown organization." };
  const prisma = getPrisma();
  const mode = opts?.mode ?? "replace";

  let stored = 0;
  for (const r of records) {
    if (!r.source || !r.scope || !r.scopeKey) continue;
    if (!(r.periodStart instanceof Date) || Number.isNaN(r.periodStart.getTime())) continue;
    if (r.fidelity !== "measured" && r.fidelity !== "allocated") continue;
    const data = { tokens: n(r.tokens), costCents: n(r.costCents), sessions: n(r.sessions), seats: n(r.seats), fidelity: r.fidelity };
    const update =
      mode === "add"
        ? { tokens: { increment: data.tokens }, costCents: { increment: data.costCents }, sessions: { increment: data.sessions }, seats: data.seats, fidelity: data.fidelity }
        : data;
    await prisma.aiUsageRecord.upsert({
      where: {
        orgId_source_scope_scopeKey_periodStart: {
          orgId: org.id,
          source: r.source,
          scope: r.scope,
          scopeKey: r.scopeKey,
          periodStart: r.periodStart,
        },
      },
      update,
      create: { orgId: org.id, source: r.source, scope: r.scope, scopeKey: r.scopeKey, periodStart: r.periodStart, ...data },
    });
    stored++;
  }
  return { ok: true, stored };
}

/**
 * The org's current ingest-token revocation epoch. Returns:
 *   - a number — the stored epoch (0 for a never-rotated org, which is every org pre-migration);
 *   - 0 when persistence is off — a DB-less local/demo deployment has no rotation state, and the
 *     stateless epoch-0 token is the whole story there;
 *   - null when the lookup FAILED while the DB is configured. Callers must treat null as
 *     "revocation state unknown" and refuse (503) rather than fall back to 0: silently reading a
 *     revoked org as epoch 0 would resurrect the exact leaked token the owner rotated away.
 * An org that doesn't exist reads as 0 — the token verifies but nothing can be persisted for it
 * anyway (recordUsage returns "Unknown organization").
 */
export async function getIngestTokenEpoch(orgSlug: string): Promise<number | null> {
  if (!isDbConfigured()) return 0;
  try {
    const org = await getOrgBySlug(orgSlug);
    return org?.ingestTokenEpoch ?? 0;
  } catch {
    return null;
  }
}

/**
 * Bump the org's ingest-token epoch, invalidating every token minted at a lower one. Returns the NEW
 * epoch, or null when persistence is off / the org is unknown — rotation is a stateful act, so an
 * unpersisted "success" would be a lie the owner acts on.
 */
export async function bumpIngestTokenEpoch(orgSlug: string): Promise<number | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const updated = await getPrisma().organization.update({
    where: { id: org.id },
    data: { ingestTokenEpoch: { increment: 1 } },
    select: { ingestTokenEpoch: true },
  });
  return updated.ingestTokenEpoch;
}

/** What a provider has actually delivered, per source. Read from rows the ingest path already writes
 *  — `AiUsageRecord.updatedAt` is a Prisma `@updatedAt`, so it already means "last time this
 *  provider's telemetry landed". No schema change, no second write path to drift. */
export interface ProviderIngestStatus {
  source: string;
  /** When this provider's data last landed (the newest touched row). */
  lastReceived: Date;
  /** Distinct repos this provider has attributed spend to in the window. */
  repos: number;
  costCents: number;
  tokens: number;
  /** True when at least one row is exact-repo attribution rather than a distributed org total. */
  measured: boolean;
}

/**
 * Per-provider delivery status for the Integrations page: has anything arrived, when, and how much
 * landed. An integration that receives datapoints and stores zero otherwise looks — on that page —
 * exactly like one that is working; this is the surface that tells them apart. Null when the DB is
 * off or the org is unknown (the page then says nothing rather than implying "never received").
 */
export async function getProviderIngestStatus(orgSlug: string, windowDays = 35): Promise<ProviderIngestStatus[] | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await getPrisma().aiUsageRecord.findMany({ where: { orgId: org.id, updatedAt: { gte: since } } });

  const bySource = new Map<string, ProviderIngestStatus & { repoKeys: Set<string> }>();
  for (const r of rows) {
    const e =
      bySource.get(r.source) ??
      ({ source: r.source, lastReceived: r.updatedAt, repos: 0, costCents: 0, tokens: 0, measured: false, repoKeys: new Set<string>() } as ProviderIngestStatus & {
        repoKeys: Set<string>;
      });
    if (r.updatedAt > e.lastReceived) e.lastReceived = r.updatedAt;
    e.costCents += r.costCents;
    e.tokens += r.tokens;
    if (r.scope === "repo") {
      e.repoKeys.add(r.scopeKey.toLowerCase());
      if (r.fidelity === "measured") e.measured = true;
    }
    bySource.set(r.source, e);
  }

  return [...bySource.values()].map(({ repoKeys, ...s }) => ({ ...s, repos: repoKeys.size }));
}

export interface RepoUsage {
  costCents: number;
  seats: number;
  tokens: number;
  source: string;
}

export interface OrgUsageRollup {
  hasMeasured: boolean; // any scope=repo, fidelity=measured records
  hasAllocated: boolean; // any scope=org records
  /**
   * W3b — any scope=org record carrying REAL COST. Distinct from `hasAllocated` on purpose: the
   * Copilot Metrics API reports seats and engagement but NOT spend, so a connected Copilot org has
   * allocated records whose `costCents` is legitimately 0. Entering the ROI model's allocated branch
   * on `hasAllocated` alone would then divide a zero total across every repo and render the entire
   * fleet as "$0 / shadow AI" — a confident, connected-looking, completely wrong answer.
   */
  hasAllocatedCost: boolean;
  /** Measured per-repo usage, keyed by repo fullName (costs/tokens summed over the window; seats = peak). */
  perRepo: Record<string, RepoUsage>;
  /** Allocated org-level totals per source (for distribution by git evidence). */
  orgTotals: { source: string; costCents: number; seats: number; tokens: number }[];
  sources: string[]; // distinct provider sources present
}

/** Aggregate an org's AI usage over the trailing `windowDays` into the resolver's rollup shape.
 *  Null when the DB is off / org is unknown; an org with no records returns an empty-but-present rollup. */
export async function getOrgUsageRollup(orgSlug: string, windowDays = 35): Promise<OrgUsageRollup | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();

  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await prisma.aiUsageRecord.findMany({ where: { orgId: org.id, periodStart: { gte: since } } });

  const perRepo: Record<string, RepoUsage> = {};
  const orgAgg = new Map<string, { costCents: number; seats: number; tokens: number }>();
  const sources = new Set<string>();
  let hasMeasured = false;
  let hasAllocated = false;
  let hasAllocatedCost = false;

  for (const r of rows) {
    sources.add(r.source);
    if (r.scope === "repo") {
      if (r.fidelity === "measured") hasMeasured = true;
      // Key by lower-cased fullName so a git-URL-derived scopeKey (OTLP) matches the DB fullName the
      // resolver looks up with, regardless of case.
      const e = (perRepo[r.scopeKey.toLowerCase()] ??= { costCents: 0, seats: 0, tokens: 0, source: r.source });
      e.costCents += r.costCents;
      e.tokens += r.tokens;
      // seats is a level, not additive across day buckets — take the peak seen in the window.
      e.seats = Math.max(e.seats, r.seats);
    } else if (r.scope === "org") {
      hasAllocated = true;
      if (r.costCents > 0) hasAllocatedCost = true;
      const e = orgAgg.get(r.source) ?? { costCents: 0, seats: 0, tokens: 0 };
      e.costCents += r.costCents;
      e.tokens += r.tokens;
      e.seats = Math.max(e.seats, r.seats);
      orgAgg.set(r.source, e);
    }
  }

  return {
    hasMeasured,
    hasAllocated,
    hasAllocatedCost,
    perRepo,
    orgTotals: [...orgAgg.entries()].map(([source, v]) => ({ source, ...v })),
    sources: [...sources],
  };
}
