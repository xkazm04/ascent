// Membership onboarding stamp + getting-started facts (W6a).
//
// Two design rules, carried from the kp study, shape everything here:
//
//   1. The gate is a STAMP, not an empty-data heuristic. Membership.onboardingCompletedAt /
//      onboardingSkippedAt — either one, once set, silences the guided flow for that member in that
//      org forever. Self-scoped exactly like Membership.alertsSeenAt: the write only ever lands on
//      the CALLER's own row (org, viewer), so it can't touch anyone else's onboarding state. The
//      add-column migration backfilled every pre-existing membership as completed, so only NEW
//      memberships start null.
//
//   2. Step doneness is NEVER recorded per step. getGettingStartedFacts below reads what the org's
//      REAL data already proves (a scan persisted, a rec assigned, a skill authored, a schedule
//      set…) and the pure model in src/lib/org/getting-started.ts turns those facts into steps —
//      so doing the work through ANY door completes a step, and the checklist cannot drift from
//      reality the way a per-step "mark done" bit would.

import type { PrismaClient } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { normalizeLogin } from "@/lib/db/members";

export type OnboardingStatus = "completed" | "skipped";

export function isOnboardingStatus(v: unknown): v is OnboardingStatus {
  return v === "completed" || v === "skipped";
}

export interface OnboardingStamp {
  completedAt: Date | null;
  skippedAt: Date | null;
  /** Either stamp set — the gate. True silences the guided onboarding flow forever. */
  dismissed: boolean;
}

/** The caller's own Membership row id lookups, shared by the stamp read + write. */
async function membershipKey(
  prisma: PrismaClient,
  orgSlug: string,
  login: string,
): Promise<{ orgId: string; userId: string } | null> {
  const gh = normalizeLogin(login);
  if (!gh) return null;
  const user = await prisma.user.findUnique({ where: { githubLogin: gh }, select: { id: true } });
  if (!user) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  return { orgId, userId: user.id };
}

/**
 * The member's onboarding stamp in `orgSlug`, or null when they have no membership row (signed-out
 * viewer, auth-off deployment, non-member) — the caller then has no per-member gate to consult and
 * degrades to not showing the flow (chrome must never 500 a page).
 */
export async function getOnboardingStamp(orgSlug: string, login: string): Promise<OnboardingStamp | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const key = await membershipKey(prisma, orgSlug, login);
  if (!key) return null;
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: key },
    select: { onboardingCompletedAt: true, onboardingSkippedAt: true },
  });
  if (!m) return null;
  return {
    completedAt: m.onboardingCompletedAt,
    skippedAt: m.onboardingSkippedAt,
    dismissed: m.onboardingCompletedAt != null || m.onboardingSkippedAt != null,
  };
}

/**
 * Stamp the member's own onboarding state in `orgSlug` — "completed" sets onboardingCompletedAt,
 * "skipped" sets onboardingSkippedAt; the sibling column is left untouched (the two are
 * independently meaningful, and either silences the flow). Returns false when there's no membership
 * row to stamp — the same degraded path as getOnboardingStamp. Deliberately an unconditional single
 * write (mirror markAlertsSeen): no read-modify-write race between two open tabs, and re-stamping
 * only refreshes a timestamp whose only job is "is it set".
 */
export async function setOnboardingStamp(
  orgSlug: string,
  login: string,
  status: OnboardingStatus,
  at: Date = new Date(),
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const key = await membershipKey(prisma, orgSlug, login);
  if (!key) return false;
  const updated = await prisma.membership.updateMany({
    where: key,
    data: status === "completed" ? { onboardingCompletedAt: at } : { onboardingSkippedAt: at },
  });
  return updated.count > 0;
}

// --- Getting-started facts ----------------------------------------------------------------------

/**
 * What the org's real data already proves, in one lean pass — the raw inputs the pure
 * getting-started model derives step doneness from. Every field is existence-shaped
 * (`findFirst`/`count`, no payloads), so the whole read is ten indexed point lookups run in
 * parallel; it is polled, so it must stay cheap.
 */
export interface GettingStartedFacts {
  kind: "org" | "personal";
  /** ≥1 persisted scan under the org's repos (any engine — a Scan row only exists once complete).
   *  A PERSONAL workspace holds watch-POINTER repos whose scans live in the shared public corpus,
   *  so there a watched pointer row (created by /api/me/watch after a public scan) is the proof. */
  hasCompletedScan: boolean;
  /** ≥1 backlog recommendation with an assignee or done status, or ≥1 ImprovementPr opened
   *  (practices / stance apply-PR). Personal: ≥1 RecommendationOverlay row (a row exists only once
   *  the viewer touched a rec). */
  gapEngaged: boolean;
  /** ≥1 live (non-archived) OrgSkill or OrgMemory row. */
  registrySeeded: boolean;
  /** ≥1 watched repo with a real cadence (scanSchedule != "off"). */
  loopSchedule: boolean;
  /** Org alert sink (Slack-compatible webhook) configured. */
  loopAlerts: boolean;
  /** A published OrgAiStance version exists (W3). */
  loopStance: boolean;
  memberCount: number;
  /** ≥1 pending, unexpired invite (same predicate as listPendingInvites). */
  hasPendingInvite: boolean;
}

/** All-false facts for an org row that doesn't exist yet — a checklist with nothing done, which is
 *  exactly the truth for a workspace whose first scan hasn't materialized the Organization row. */
export const EMPTY_GETTING_STARTED_FACTS: GettingStartedFacts = {
  kind: "org",
  hasCompletedScan: false,
  gapEngaged: false,
  registrySeeded: false,
  loopSchedule: false,
  loopAlerts: false,
  loopStance: false,
  memberCount: 0,
  hasPendingInvite: false,
};

/**
 * One-pass facts read. Null only when the DB is off or the org row doesn't exist — callers substitute
 * EMPTY_GETTING_STARTED_FACTS for the latter (nothing exists ⇒ nothing is done).
 */
export async function getGettingStartedFacts(orgSlug: string): Promise<GettingStartedFacts | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug.trim().toLowerCase() },
    select: { id: true, kind: true, alertWebhookUrl: true },
  });
  if (!org) return null;
  const orgId = org.id;
  const personal = org.kind === "personal";

  const [scan, watched, engagedRec, overlay, improvementPr, skill, memory, scheduled, stance, memberCount, invite] =
    await Promise.all([
      prisma.scan.findFirst({ where: { repo: { orgId } }, select: { id: true } }),
      prisma.repository.findFirst({ where: { orgId, watched: true }, select: { id: true } }),
      prisma.recommendation.findFirst({
        where: { scan: { repo: { orgId } }, OR: [{ assigneeLogin: { not: null } }, { status: "done" }] },
        select: { id: true },
      }),
      // Personal workspaces engage gaps through the private overlay (shared-corpus recs are read-only
      // for them); a sparse overlay row only exists once the viewer touched a recommendation.
      personal
        ? prisma.recommendationOverlay.findFirst({ where: { orgId }, select: { id: true } })
        : Promise.resolve(null),
      prisma.improvementPr.findFirst({ where: { orgId }, select: { id: true } }),
      prisma.orgSkill.findFirst({ where: { orgId, archived: false }, select: { id: true } }),
      prisma.orgMemory.findFirst({ where: { orgId, archived: false }, select: { id: true } }),
      prisma.repository.findFirst({
        where: { orgId, watched: true, scanSchedule: { not: "off" } },
        select: { id: true },
      }),
      prisma.orgAiStance.findFirst({ where: { orgId, status: "published" }, select: { id: true } }),
      prisma.membership.count({ where: { orgId } }),
      prisma.invite.findFirst({
        where: { orgId, status: "pending", expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);

  return {
    kind: personal ? "personal" : "org",
    hasCompletedScan: scan != null || (personal && watched != null),
    gapEngaged: engagedRec != null || improvementPr != null || overlay != null,
    registrySeeded: skill != null || memory != null,
    loopSchedule: scheduled != null,
    loopAlerts: typeof org.alertWebhookUrl === "string" && org.alertWebhookUrl.trim() !== "",
    loopStance: stance != null,
    memberCount,
    hasPendingInvite: invite != null,
  };
}
