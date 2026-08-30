// AGENT ADMISSION (moonshot #8) — the `RepoAdmission` row: one recorded, overridable decision per
// (org, repo). Org-scoped throughout; the unique key `(orgId, repoFullName)` IS the idempotency key,
// so every write is an upsert and a double-submit cannot fork a repo's decision.
//
// WHAT THIS CLOSES. `Repository.passportJson` carries a DERIVED autonomy tier — computed from the
// repo's own artifacts, persisted, and never decidable by a human. The autonomy model's own
// DATA_MODEL_GAPS said so: "a grant should also be an overridable recorded decision". A derived
// grade is a measurement; an admission is a DECISION, and the two must not be the same field.
// `derivedTier` keeps the measurement, `grantedTier` carries the decision, and `decidedBy` is what
// separates them — NULL means "seeded from the measurement, nobody has decided", and the surfaces
// say exactly that rather than presenting a seed as a grant.
//
// THE HONEST NULL. `derivedTier` is null when the latest scan carried no passport. It does not
// become "T0" (the strictest — which would make every unscanned repo unmergeable) and it does not
// become "T3". The compiler (`src/lib/org/admission.ts`) reads null as "tier not assessed" and emits
// no control at all.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { parsePassportJson, deriveAutonomyForStored } from "@/lib/analyze/passport";
import { isAdmissionMode, isAutonomyTierId, type AdmissionMode, type RepoAdmissionRow } from "@/lib/org/admission";
import type { AutonomyTierId } from "@/lib/types";

export type { RepoAdmissionRow, AdmissionMode };

/** Cap on the free-text rationale a decision carries — same ceiling the stance sanitizer uses. */
export const MAX_RATIONALE = 500;

type DbAdmission = {
  id: string;
  repoFullName: string;
  stanceVersion: number;
  derivedTier: string | null;
  grantedTier: string;
  mode: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  rationale: string;
  rulesetId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Prisma row → wire row. Every `DateTime` becomes an ISO STRING here, server-side, because this row
 * crosses to the Governance client (`wire-safe-dates`).
 *
 * The two string-union columns are re-validated on READ, not only on write: they are plain TEXT in
 * the database, and a value written by an older build, a migration, or a hand-edit must degrade to a
 * documented default rather than reach the compiler as an unhandled tier. An unrecognized mode reads
 * as the middle rung (`assisted-only`) — never as `agents-allowed`, which would be a corrupt row
 * quietly granting the loosest posture available.
 */
function toRow(r: DbAdmission): RepoAdmissionRow {
  return {
    id: r.id,
    repoFullName: r.repoFullName,
    stanceVersion: r.stanceVersion,
    derivedTier: isAutonomyTierId(r.derivedTier) ? r.derivedTier : null,
    grantedTier: isAutonomyTierId(r.grantedTier) ? r.grantedTier : "T0",
    mode: isAdmissionMode(r.mode) ? r.mode : "assisted-only",
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    rationale: r.rationale,
    rulesetId: r.rulesetId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const SELECT = {
  id: true,
  repoFullName: true,
  stanceVersion: true,
  derivedTier: true,
  grantedTier: true,
  mode: true,
  decidedBy: true,
  decidedAt: true,
  rationale: true,
  rulesetId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The passport-derived tier for one tracked repo, or null when the latest scan carried no passport. */
export async function derivedTierFor(orgSlug: string, repoFullName: string): Promise<AutonomyTierId | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const repo = await getPrisma().repository.findFirst({
    where: { orgId: org.id, fullName: repoFullName },
    select: { passportJson: true },
  });
  const passport = parsePassportJson(repo?.passportJson);
  if (!passport) return null;
  // `deriveAutonomyForStored` is the SHARED resolver — the same symbol the passports tab and the
  // stance readout use. Re-deriving rather than reading `passport.autonomy.tier` matters for a row
  // written before the autonomy block existed: the migration derives it read-time, and calling the
  // resolver keeps this seed identical to what every other surface shows for the same repo.
  return deriveAutonomyForStored(passport).tier;
}

/**
 * One repo's admission row, seeded lazily on first read when the repo has a passport.
 *
 * SEEDING IS NOT DECIDING. The seed copies `grantedTier = derivedTier`, sets the middle rung
 * (`assisted-only`) and leaves `decidedBy` NULL — so every surface can tell a measurement that was
 * written down from a decision a person made. A repo with no passport is NOT seeded at all: there is
 * nothing to copy, and a row with `derivedTier: null` and an invented `grantedTier` would be the
 * product asserting a grade nobody measured.
 *
 * Returns null without a database, for an unknown org, or for a repo with no assessed tier.
 */
export async function getRepoAdmission(orgSlug: string, repoFullName: string): Promise<RepoAdmissionRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();
  const existing = await prisma.repoAdmission.findFirst({
    where: { orgId: org.id, repoFullName },
    select: SELECT,
  });
  if (existing) return toRow(existing);

  const derived = await derivedTierFor(orgSlug, repoFullName);
  if (!derived) return null;
  const stanceVersion = await activeStanceVersion(org.id);
  try {
    const created = await prisma.repoAdmission.create({
      data: {
        orgId: org.id,
        repoFullName,
        stanceVersion,
        derivedTier: derived,
        grantedTier: derived,
        mode: "assisted-only",
      },
      select: SELECT,
    });
    return toRow(created);
  } catch {
    // A concurrent reader won the unique key. Read theirs rather than surfacing a write error for
    // what is, semantically, the same seed — the unique key IS the idempotency key.
    const raced = await prisma.repoAdmission.findFirst({ where: { orgId: org.id, repoFullName }, select: SELECT });
    return raced ? toRow(raced) : null;
  }
}

/** Every admission row for an org, by repo name. Empty (not null) without a DB — a caller asking for
 *  a fleet list wants a list; the per-repo read is where "unavailable" is distinguishable. */
export async function listOrgAdmissions(orgSlug: string): Promise<RepoAdmissionRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const rows = await getPrisma().repoAdmission.findMany({
    where: { orgId: org.id },
    orderBy: { repoFullName: "asc" },
    select: SELECT,
  });
  return rows.map(toRow);
}

/** The active published stance version, or 0 when the org has published none. */
async function activeStanceVersion(orgId: string): Promise<number> {
  const row = await getPrisma().orgAiStance.findFirst({
    where: { orgId, status: "published" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return row?.version ?? 0;
}

export interface AdmissionDecision {
  grantedTier: AutonomyTierId;
  mode: AdmissionMode;
  rationale?: string;
  /** GitHub login of the deciding owner. Required: an override with no author is not a decision. */
  decidedBy: string;
}

/**
 * Record (or move) one repo's admission decision. Upserts on the unique key, so a re-submit is
 * idempotent rather than a second row.
 *
 * `derivedTier` is re-read on every write and stored alongside the grant: the pair is the evidence
 * that an override HAPPENED — "granted T3 where the scan derived T1" is the sentence an auditor
 * needs, and it is unreconstructible if only the grant is kept. `stanceVersion` is stamped with the
 * ACTIVE stance, because this write is the moment a human affirmed the decision against it.
 */
export async function upsertRepoAdmission(
  orgSlug: string,
  repoFullName: string,
  decision: AdmissionDecision,
): Promise<RepoAdmissionRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();
  const [derived, stanceVersion] = await Promise.all([derivedTierFor(orgSlug, repoFullName), activeStanceVersion(org.id)]);
  const data = {
    stanceVersion,
    derivedTier: derived,
    grantedTier: decision.grantedTier,
    mode: decision.mode,
    decidedBy: decision.decidedBy,
    decidedAt: new Date(),
    rationale: (decision.rationale ?? "").slice(0, MAX_RATIONALE),
  };
  const row = await prisma.repoAdmission.upsert({
    where: { orgId_repoFullName: { orgId: org.id, repoFullName } },
    create: { orgId: org.id, repoFullName, ...data },
    update: data,
    select: SELECT,
  });
  return toRow(row);
}

/**
 * Store (or clear) the GitHub ruleset id an apply created. This column is the REVERSAL HANDLE: an
 * applied ruleset that cannot be named cannot be removed from the same surface that created it, and
 * a control a customer cannot undo is one they will disable outside the product instead.
 *
 * Org-scoped by `updateMany`, so a repo name belonging to another tenant simply matches nothing.
 */
export async function setAdmissionRulesetId(
  orgSlug: string,
  repoFullName: string,
  rulesetId: string | null,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return false;
  const res = await getPrisma().repoAdmission.updateMany({
    where: { orgId: org.id, repoFullName },
    data: { rulesetId },
  });
  return res.count > 0;
}
