// ATHENA'S IDENTITY STORE — two tiers, one row each per org.
//
// ┌─ THE CONSTITUTION IS WRITE-LOCKED BY CONSTRUCTION ─────────────────────────────────────────────┐
// │ This module exports NO function that can update a row whose `tier` is "constitution". Not a    │
// │ guarded one — an ABSENT one. `updateSelfModel` hardcodes `tier: "self_model"` into its own     │
// │ where-clause, so there is no argument any caller can pass, no field any request body can carry,│
// │ and no refactor of a runtime check that opens the door. `seedAthenaIdentity` can CREATE a      │
// │ constitution (a row has to exist), but it is a `create`-only path: handed an org that already  │
// │ has one, it returns the existing row untouched.                                                │
// │                                                                                                 │
// │ WHY absence rather than a check: a guard is a line of code, and a line of code has a future in │
// │ which someone reads `if (tier === "constitution") throw` as defensive noise around an           │
// │ otherwise-general function and "simplifies" it. There is nothing to simplify here. The only    │
// │ way to make the constitution editable is to write a new function and be seen doing it.         │
// └────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// The self-model IS mutable, but only through the anchored-diff engine
// (src/lib/athena/identity-diff.ts) and only after a human accepts an `identity_diff` proposal. This
// module refuses to write a self-model any other way: `updateSelfModel` takes the diff, applies it
// here, and hands the caller back the typed refusal when the anchor missed.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { applyIdentityDiffs, type DiffFailureReason, type IdentityDiff } from "@/lib/athena/identity-diff";

/** The two tiers. `constitution` is written once and never patched; `self_model` grows by diff. */
export const ATHENA_TIERS = ["constitution", "self_model"] as const;
export type AthenaTier = (typeof ATHENA_TIERS)[number];

export interface AthenaIdentityRecord {
  id: string;
  orgId: string;
  tier: AthenaTier;
  content: string;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

type Row = {
  id: string;
  orgId: string;
  tier: string;
  content: string;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
};

const toRecord = (r: Row): AthenaIdentityRecord => ({
  id: r.id,
  orgId: r.orgId,
  tier: r.tier as AthenaTier,
  content: r.content,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
  updatedBy: r.updatedBy,
});

/** Read one tier of an org's identity. Null when it has never been seeded. */
export async function getAthenaIdentity(orgId: string, tier: AthenaTier): Promise<AthenaIdentityRecord | null> {
  if (!isDbConfigured() || !orgId) return null;
  const row = await getPrisma().athenaIdentity.findUnique({ where: { orgId_tier: { orgId, tier } } });
  return row ? toRecord(row) : null;
}

/** Both tiers at once — what the prompt builder needs, in one round trip. */
export async function getAthenaIdentityPair(
  orgId: string,
): Promise<{ constitution: AthenaIdentityRecord | null; selfModel: AthenaIdentityRecord | null }> {
  if (!isDbConfigured() || !orgId) return { constitution: null, selfModel: null };
  const rows = await getPrisma().athenaIdentity.findMany({ where: { orgId } });
  const pick = (tier: AthenaTier) => {
    const r = rows.find((x) => x.tier === tier);
    return r ? toRecord(r) : null;
  };
  return { constitution: pick("constitution"), selfModel: pick("self_model") };
}

/**
 * CREATE a tier's row if the org has none. Idempotent and create-ONLY: if the row exists it is
 * returned exactly as stored, so this can never become a back door that overwrites a constitution.
 * The `@@unique([orgId, tier])` index is the backstop for two seeds racing.
 */
export async function seedAthenaIdentity(
  orgId: string,
  tier: AthenaTier,
  content: string,
): Promise<AthenaIdentityRecord | null> {
  if (!isDbConfigured() || !orgId) return null;
  const prisma = getPrisma();
  const existing = await prisma.athenaIdentity.findUnique({ where: { orgId_tier: { orgId, tier } } });
  if (existing) return toRecord(existing);
  try {
    return toRecord(await prisma.athenaIdentity.create({ data: { orgId, tier, content } }));
  } catch {
    // Lost the race to a concurrent seed: the unique index rejected the second insert, which is the
    // correct outcome. Return whatever the winner wrote rather than clobbering it.
    const row = await prisma.athenaIdentity.findUnique({ where: { orgId_tier: { orgId, tier } } });
    return row ? toRecord(row) : null;
  }
}

export type SelfModelUpdate =
  | { ok: true; record: AthenaIdentityRecord }
  | { ok: false; reason: DiffFailureReason | "no-self-model" | "no-db"; detail: string };

/**
 * Apply accepted anchored diffs to the org's SELF-MODEL. The only mutating export in this module,
 * and `tier: "self_model"` is baked into both the read and the where-clause below — there is no
 * parameter through which a caller could aim it at the constitution.
 *
 * A refused diff is returned as a refusal and NOTHING is written: the engine never appends on a
 * miss, and neither does this.
 */
export async function updateSelfModel(
  orgId: string,
  diffs: readonly IdentityDiff[],
  updatedBy: string | null,
): Promise<SelfModelUpdate> {
  if (!isDbConfigured() || !orgId) return { ok: false, reason: "no-db", detail: "no database configured" };
  const prisma = getPrisma();
  const current = await prisma.athenaIdentity.findUnique({
    where: { orgId_tier: { orgId, tier: "self_model" } },
  });
  if (!current) {
    return { ok: false, reason: "no-self-model", detail: "this org has no self-model to amend yet" };
  }

  const applied = applyIdentityDiffs(current.content, diffs);
  if (!applied.ok) return { ok: false, reason: applied.reason, detail: applied.detail };

  const row = await prisma.athenaIdentity.update({
    // tier is pinned here, not passed in. See the box at the top of the file.
    where: { orgId_tier: { orgId, tier: "self_model" } },
    data: { content: applied.content, version: { increment: 1 }, updatedBy },
  });
  return { ok: true, record: toRecord(row) };
}
