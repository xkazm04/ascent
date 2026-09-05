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

/**
 * Does this organization TRACK this repository? The tenancy question the admission routes ask
 * before they will record a decision about a repo name a caller supplied.
 *
 * WHY THIS EXISTS (UAT `PRIYA-L2-C5`). The check it replaces was `owner === orgSlug` — a string
 * prefix standing in for ownership. That holds only for an org whose slug happens to equal its
 * GitHub owner namespace, and it is false for the most ordinary case there is: an org named for the
 * team, watching repos that live under a personal or differently-named account. On this host, org
 * `kiro` could therefore never admit its own `xkazm04/*` repositories, which made the entire remote
 * work protocol permanently unreachable for it.
 *
 * The `Repository` row IS the tenancy fact. It exists because the org imported the repo from an
 * installation listing or scanned it, it is keyed `(orgId, fullName)`, and the read below is that
 * key — so a repo another tenant tracks is simply not found here.
 *
 * DELIBERATELY THE TRACKED SET, NOT THE `watched` SUBSET. `watched` is a rescan-CADENCE preference
 * (it defaults false and an owner toggles it per repo). Making a governance decision refusable
 * because autoscan happens to be off would tie the perimeter to a scheduling flag, and the two
 * answer different questions.
 *
 * False without a database or for an unknown org — the callers already refuse both, and a tenancy
 * check that failed open would be the wrong direction for the one it does reach.
 */
export async function orgTracksRepo(orgSlug: string, repoFullName: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getOrgBySlug(orgSlug).catch(() => null);
  if (!org) return false;
  const row = await getPrisma()
    .repository.findFirst({ where: { orgId: org.id, fullName: repoFullName }, select: { id: true } })
    .catch(() => null);
  return Boolean(row);
}

/**
 * The row a repo WOULD have if someone read it through `getRepoAdmission` — computed, never written.
 *
 * A READ MUST NOT SEED. The lazy seed in `getRepoAdmission` exists so the gate and the MCP tools can
 * ask about one repo and get an answer; making the fleet LIST seed would write a row for every
 * repository an org tracks the first time anyone opened the Governance tab, which is a decision-shaped
 * artifact created by a page view. So this derives the identical state in memory instead, and the row
 * is only ever persisted by the POST an owner actually clicks.
 *
 * It is byte-for-byte what the seed would have written: `grantedTier = derivedTier`, the middle rung
 * (`assisted-only`), `decidedBy` NULL. Every reader that distinguishes a seed from a decision does it
 * on `decidedBy`, so a derived row and a seeded row are indistinguishable — which is correct, because
 * they say the same thing.
 *
 * `id` and the timestamps are EMPTY rather than invented: nothing was written, and a fabricated
 * `createdAt` would be a fact this row does not have. No caller reads them (the column keys on
 * `repoFullName`), and a wire type may not carry a `Date` anyway.
 *
 * `derivedTier: null` (no passport) keeps the honest null: `grantedTier` then falls to "T0" purely to
 * satisfy the non-null column, and never reaches a reader — the view layer renders "tier not
 * assessed" from `derivedTier === null`, and `getRepoAdmission` returns null for such a repo so the
 * gate applies no bar to it at all.
 */
export function deriveRepoAdmission(
  repoFullName: string,
  derivedTier: AutonomyTierId | null,
  stanceVersion: number,
): RepoAdmissionRow {
  return {
    id: "",
    repoFullName,
    stanceVersion,
    derivedTier,
    grantedTier: derivedTier ?? "T0",
    mode: "assisted-only",
    decidedBy: null,
    decidedAt: null,
    rationale: "",
    rulesetId: null,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * The org's whole admission picture: one row per TRACKED repository, carrying its derived tier and
 * its decision when one exists — plus any decision whose repository the org has since stopped
 * tracking.
 *
 * WHY THE REPOSITORY SET AND NOT THE `RepoAdmission` TABLE. This read used to be a plain `findMany`
 * over the decisions, and no surface in the product seeds them: `getRepoAdmission`'s lazy seed is
 * reached only from the gate, /admission/propose, /admission/ruleset and the MCP tools. So an org
 * that had never called a gate saw an EMPTY column reading "no repository has an admission decision
 * yet" — with no repository to click, and therefore no way to make the first one. The decision layer
 * was reachable only after some other surface incidentally seeded a row.
 *
 * Tenancy is the tracked set for the same reason `orgTracksRepo` uses it: the `Repository` row IS the
 * fact that the org has this repo, and `watched` is a rescan-cadence preference that answers a
 * different question.
 *
 * A decision for a repo no longer in the tracked set is still returned. It is a record an owner made
 * and can still withdraw, and dropping it from the only surface that can withdraw it would strand it.
 *
 * Empty (not null) without a DB — a caller asking for a fleet list wants a list; the per-repo read is
 * where "unavailable" is distinguishable.
 */
export async function listOrgAdmissions(orgSlug: string): Promise<RepoAdmissionRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const prisma = getPrisma();
  const [repos, stored, stanceVersion] = await Promise.all([
    prisma.repository.findMany({ where: { orgId: org.id }, select: { fullName: true, passportJson: true } }),
    prisma.repoAdmission.findMany({ where: { orgId: org.id }, select: SELECT }),
    activeStanceVersion(org.id),
  ]);

  const decided = new Map(stored.map((r) => [r.repoFullName, toRow(r)]));
  const out: RepoAdmissionRow[] = [];
  for (const repo of repos) {
    const existing = decided.get(repo.fullName);
    if (existing) {
      decided.delete(repo.fullName);
      out.push(existing);
      continue;
    }
    // Same resolver, same call, as the seed — see `derivedTierFor`. Read from the passport already in
    // hand rather than re-querying per repo: a fleet list must not be N+1 in the org's repo count.
    const passport = parsePassportJson(repo.passportJson);
    out.push(deriveRepoAdmission(repo.fullName, passport ? deriveAutonomyForStored(passport).tier : null, stanceVersion));
  }
  out.push(...decided.values());
  return out.sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
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
 * WITHDRAW one repo's admission decision — back to no decision at all.
 *
 * THE STATE STORE IS SPARSE; THE LEDGER IS APPEND-ONLY. That is the whole shape of a decision record,
 * and Ascent had built only half of it: `upsertRepoAdmission` could *move* a decision but never unmake
 * one, so the nearest thing to a revoke was writing `grantedTier == derivedTier` — which still records
 * that an owner decided something, with `decidedBy` and `decidedAt` set. A decision made in error was
 * permanent, and the trail could not tell "decided, then withdrawn" from "decided" (UAT `RC2-N4`; the
 * recertify pass hit it while cleaning up after its own probe row).
 *
 * So the row is DELETED rather than flipped to a `withdrawn` status. An undecided item must have *no
 * record at all* — a status flip would leave a decision-shaped row that every reader has to learn to
 * discount, and `getRepoAdmission`'s lazy seed already re-creates the honest "seeded from the
 * measurement, nobody has decided" state on the next read. The deletion is never silent: the ROUTE
 * writes the withdrawal act to `OrgAudit`, which is why this returns the row it removed — the act
 * needs the previous status, and it is unreconstructible once the row is gone.
 *
 * Org-scoped by `deleteMany` on the resolved org id, so a repo name belonging to another tenant simply
 * matches nothing. Returns null when there was no row to withdraw (already undecided — an idempotent
 * no-op, not an error) and the caller must NOT write an act for it: a withdrawal that withdrew nothing
 * is not something that happened.
 */
export async function deleteRepoAdmission(orgSlug: string, repoFullName: string): Promise<RepoAdmissionRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();
  const existing = await prisma.repoAdmission.findFirst({ where: { orgId: org.id, repoFullName }, select: SELECT });
  if (!existing) return null;
  const res = await prisma.repoAdmission.deleteMany({ where: { orgId: org.id, repoFullName } });
  // Lost a race to a concurrent withdrawal: the other caller owns the act. Same reasoning as the
  // seed's unique-key race — the outcome is what was asked for, and two acts for one withdrawal
  // would be a worse record than one.
  if (res.count === 0) return null;
  return toRow(existing);
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
