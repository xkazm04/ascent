// Per-org CI maturity-gate policy (GATE-1). Before this, the App-mode PR Check Run — the status that
// actually blocks merge — called evaluateGate(report) with NO policy, so it always used archetype
// defaults and silently ignored any configured/security bar; buildGovernanceOverview likewise
// hardcoded the org default. These helpers persist a GatePolicy on Organization.gatePolicy (JSON) so
// the check + the fleet view honor it. Stored values are sanitized at the route on write and again on
// read (defense in depth). No-op-safe without a DB.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { sanitizeGatePolicy, type GatePolicy } from "@/lib/scoring/gate";

/** The org's configured gate policy, or null (unset / unknown org / DB-less / invalid → archetype default). */
export async function getOrgGatePolicy(orgSlug: string): Promise<GatePolicy | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug.toLowerCase() },
    select: { gatePolicy: true },
  });
  return org?.gatePolicy ? sanitizeGatePolicy(org.gatePolicy) : null;
}

/** Set (policy) or clear (null) the org's gate policy. undefined = unknown org. */
export async function setOrgGatePolicy(orgSlug: string, policy: GatePolicy | null): Promise<GatePolicy | null | undefined> {
  if (!isDbConfigured()) return undefined;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } });
  if (!org) return undefined;
  const clean = policy ? sanitizeGatePolicy(policy) : null;
  await prisma.organization.update({
    where: { id: org.id },
    // DbNull = SQL NULL (clear); otherwise store the sanitized policy object. (undefined would skip
    // the field entirely, so a "clear" must be an explicit DbNull.)
    data: { gatePolicy: clean === null ? Prisma.DbNull : (clean as Prisma.InputJsonValue) },
  });
  return clean;
}
