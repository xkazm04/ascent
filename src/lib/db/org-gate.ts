// Per-org CI maturity-gate policy (GATE-1). Before this, the App-mode PR Check Run — the status that
// actually blocks merge — called evaluateGate(report) with NO policy, so it always used archetype
// defaults and silently ignored any configured/security bar; buildGovernanceOverview likewise
// hardcoded the org default. These helpers persist a GatePolicy on Organization.gatePolicy so the
// check + the fleet view honor it. It is stored as SERIALIZED JSON in a TEXT column (the schema's
// no-jsonb DSQL-safety contract, like every other JSON payload here) and parsed at THIS edge. Stored
// values are sanitized at the route on write and again on read (defense in depth). No-op-safe without a DB.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { sanitizeGatePolicy, type GatePolicy } from "@/lib/scoring/gate";

/** Parse the serialized gatePolicy TEXT column; tolerant of legacy non-string (parsed object) values. */
function parseStoredGatePolicy(raw: unknown): unknown {
  if (typeof raw !== "string") return raw; // legacy jsonb row read back as an object — pass through
  try {
    return JSON.parse(raw);
  } catch {
    return null; // corrupt/non-JSON text → treated as unset (sanitize would reject it anyway)
  }
}

/** The org's configured gate policy, or null (unset / unknown org / DB-less / invalid → archetype default). */
export async function getOrgGatePolicy(orgSlug: string): Promise<GatePolicy | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug.toLowerCase() },
    select: { gatePolicy: true },
  });
  return org?.gatePolicy ? sanitizeGatePolicy(parseStoredGatePolicy(org.gatePolicy)) : null;
}

/** Set (policy) or clear (null) the org's gate policy. undefined = unknown org. */
export async function setOrgGatePolicy(orgSlug: string, policy: GatePolicy | null): Promise<GatePolicy | null | undefined> {
  if (!isDbConfigured()) return undefined;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } });
  if (!org) return undefined;
  const clean = policy ? sanitizeGatePolicy(policy) : null;
  // null clears the column; otherwise store the sanitized policy as serialized JSON (TEXT column,
  // no-jsonb contract). undefined would skip the field, so a "clear" must be an explicit null.
  const gatePolicy: string | null = clean === null ? null : JSON.stringify(clean);
  await prisma.organization.update({
    where: { id: org.id },
    // Cast: `gatePolicy` is now String? in schema.prisma, but the generated Prisma client is shared
    // (node_modules junctions to the main checkout) and still typed Json? until `prisma generate` is
    // re-run after this schema change. The runtime value is a plain JSON string — correct for the TEXT
    // column; the cast falls away (no-op) once the client is regenerated.
    data: { gatePolicy } as Prisma.OrganizationUpdateInput,
  });
  return clean;
}
