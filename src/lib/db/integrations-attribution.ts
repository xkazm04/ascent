// SERVER-ONLY. Which repos the org's measured Claude Code spend landed on, beside the two sets that
// decide whether AI delivery can show it. One authority for the join: the delivery set IS
// getOrgPrSignals.perRepo, the exact list Delivery draws its rows from (aiDeliveryModel), so the
// Integrations reconcile cannot disagree with Delivery. The window is Delivery's default window.
import { isDbConfigured, getPrisma } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { getOrgPrSignals } from "@/lib/db/org-signals";
import { resolveWindow } from "@/lib/window";

/** Wire shape (no timestamps): what the server read hands the Integrations surfaces. */
export interface AttributionWire {
  /** Which window the measured spend is summed over (the Delivery default window's title). */
  windowTitle: string;
  measured: { repo: string; costCents: number }[];
  /** fullNames AI delivery draws a row for. */
  deliverySet: string[];
  /** fullNames the org has a Repository row for. */
  fleet: string[];
  /** A GitLab installation with a stored credential exists, so a `gitlab:` repo can be scanned. */
  gitlabConnected: boolean;
}

/**
 * Measured scope=repo usage from `source`, summed per lower-cased repo over the Delivery default
 * window (first-seen spelling kept for display), plus the delivery set and the fleet. Null when the
 * db is off or the org is unknown; `gitlabConnected` is the caller's to fill (it holds the forge rows).
 */
export async function getMeasuredAttribution(
  orgSlug: string,
  now: Date = new Date(),
  source = "claude-code",
): Promise<Omit<AttributionWire, "gitlabConnected"> | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();
  const period = resolveWindow({}, now);

  const periodStart: { gte?: Date; lte?: Date } = {};
  if (period.start) periodStart.gte = period.start;
  if (period.end) periodStart.lte = period.end;
  const [rows, repos, pr] = await Promise.all([
    prisma.aiUsageRecord.findMany({
      where: { orgId: org.id, source, scope: "repo", ...(periodStart.gte || periodStart.lte ? { periodStart } : {}) },
      select: { scopeKey: true, costCents: true },
    }),
    prisma.repository.findMany({ where: { orgId: org.id }, select: { fullName: true } }),
    getOrgPrSignals(orgSlug),
  ]);

  const byKey = new Map<string, { repo: string; costCents: number }>();
  for (const r of rows) {
    const key = r.scopeKey.toLowerCase();
    const e = byKey.get(key);
    if (e) e.costCents += r.costCents;
    else byKey.set(key, { repo: r.scopeKey, costCents: r.costCents });
  }

  return {
    windowTitle: period.title,
    measured: [...byKey.values()],
    deliverySet: (pr?.perRepo ?? []).map((row) => row.fullName),
    fleet: repos.map((r) => r.fullName),
  };
}
