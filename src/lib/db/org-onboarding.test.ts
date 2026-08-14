// Membership onboarding stamp + getting-started facts (W6a) contracts:
//  - the stamp is SELF-SCOPED (the write keys on the caller's own {orgId,userId}) and column-mapped
//    by status; no membership row → false/null, never a throw;
//  - the facts read is existence-shaped and its WHERE clauses pin the exact step predicates
//    (assignee-or-done recs, non-archived registry rows, pending+unexpired invites, published
//    stance, watched+scheduled repos);
//  - the migration + init.sql carry the backfill semantics: existing rows stamped completed ONCE,
//    new rows start null (init.sql's backfill is guarded so pglite's every-boot re-exec can't
//    re-stamp memberships created since the last restart).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma, mockGetOrgId } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import { getGettingStartedFacts, getOnboardingStamp, isOnboardingStatus, setOnboardingStamp } from "./org-onboarding";

/** A minimal prisma fake; pass overrides per model method. */
function fakePrisma(over: Record<string, Record<string, unknown>> = {}) {
  const p = {
    user: { findUnique: vi.fn(async () => ({ id: "user_1" })), ...(over.user ?? {}) },
    membership: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
      ...(over.membership ?? {}),
    },
    organization: {
      findUnique: vi.fn(async () => ({ id: "org_1", kind: "org", alertWebhookUrl: null })),
      ...(over.organization ?? {}),
    },
    scan: { findFirst: vi.fn(async () => null), ...(over.scan ?? {}) },
    repository: { findFirst: vi.fn(async () => null), ...(over.repository ?? {}) },
    recommendation: { findFirst: vi.fn(async () => null), ...(over.recommendation ?? {}) },
    recommendationOverlay: { findFirst: vi.fn(async () => null), ...(over.recommendationOverlay ?? {}) },
    improvementPr: { findFirst: vi.fn(async () => null), ...(over.improvementPr ?? {}) },
    orgSkill: { findFirst: vi.fn(async () => null), ...(over.orgSkill ?? {}) },
    orgMemory: { findFirst: vi.fn(async () => null), ...(over.orgMemory ?? {}) },
    orgAiStance: { findFirst: vi.fn(async () => null), ...(over.orgAiStance ?? {}) },
    invite: { findFirst: vi.fn(async () => null), ...(over.invite ?? {}) },
    // W1c — the programme step's fact. Unique by orgId, so findUnique rather than findFirst.
    transitionProgram: { findUnique: vi.fn(async () => null), ...(over.transitionProgram ?? {}) },
  };
  mockGetPrisma.mockReturnValue(p);
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockResolvedValue("org_1");
});

describe("isOnboardingStatus", () => {
  it("accepts exactly the two stamp statuses", () => {
    expect(isOnboardingStatus("completed")).toBe(true);
    expect(isOnboardingStatus("skipped")).toBe(true);
    expect(isOnboardingStatus("done")).toBe(false);
    expect(isOnboardingStatus(undefined)).toBe(false);
  });
});

describe("getOnboardingStamp", () => {
  it("returns the stamp with dismissed=true when EITHER timestamp is set", async () => {
    const completedAt = new Date("2026-08-01T00:00:00Z");
    fakePrisma({
      membership: {
        findUnique: vi.fn(async () => ({ onboardingCompletedAt: completedAt, onboardingSkippedAt: null })),
      },
    });
    const stamp = await getOnboardingStamp("acme", "Dana");
    expect(stamp).toEqual({ completedAt, skippedAt: null, dismissed: true });
  });

  it("returns dismissed=false when both are null (the flow should show)", async () => {
    fakePrisma({
      membership: { findUnique: vi.fn(async () => ({ onboardingCompletedAt: null, onboardingSkippedAt: null })) },
    });
    const stamp = await getOnboardingStamp("acme", "dana");
    expect(stamp).toEqual({ completedAt: null, skippedAt: null, dismissed: false });
  });

  it("returns null when the viewer has no User row (no membership to consult)", async () => {
    fakePrisma({ user: { findUnique: vi.fn(async () => null) } });
    expect(await getOnboardingStamp("acme", "stranger")).toBeNull();
  });

  it("returns null when the org is unknown", async () => {
    fakePrisma();
    mockGetOrgId.mockResolvedValue(null);
    expect(await getOnboardingStamp("ghost", "dana")).toBeNull();
  });
});

describe("setOnboardingStamp", () => {
  it("stamps onboardingCompletedAt on the CALLER's own membership row for 'completed'", async () => {
    const p = fakePrisma();
    const at = new Date("2026-08-12T10:00:00Z");
    expect(await setOnboardingStamp("acme", "Dana", "completed", at)).toBe(true);
    expect(p.membership.updateMany).toHaveBeenCalledWith({
      where: { orgId: "org_1", userId: "user_1" },
      data: { onboardingCompletedAt: at },
    });
  });

  it("stamps onboardingSkippedAt (and ONLY it) for 'skipped'", async () => {
    const p = fakePrisma();
    const at = new Date("2026-08-12T10:00:00Z");
    expect(await setOnboardingStamp("acme", "dana", "skipped", at)).toBe(true);
    const call = p.membership.updateMany.mock.calls[0]![0];
    expect(call.data).toEqual({ onboardingSkippedAt: at });
    expect(call.data).not.toHaveProperty("onboardingCompletedAt");
  });

  it("returns false when there is no membership row to stamp (updateMany count 0)", async () => {
    fakePrisma({ membership: { updateMany: vi.fn(async () => ({ count: 0 })) } });
    expect(await setOnboardingStamp("acme", "dana", "completed")).toBe(false);
  });

  it("returns false for an unknown user without attempting a write", async () => {
    const p = fakePrisma({ user: { findUnique: vi.fn(async () => null) } });
    expect(await setOnboardingStamp("acme", "stranger", "completed")).toBe(false);
    expect(p.membership.updateMany).not.toHaveBeenCalled();
  });
});

describe("getGettingStartedFacts — step predicates", () => {
  it("returns null when the org row doesn't exist (caller substitutes the all-false facts)", async () => {
    fakePrisma({ organization: { findUnique: vi.fn(async () => null) } });
    expect(await getGettingStartedFacts("ghost")).toBeNull();
  });

  it("derives all-false facts for a bare org (nothing exists ⇒ nothing done)", async () => {
    fakePrisma({ membership: { count: vi.fn(async () => 1) } });
    const facts = await getGettingStartedFacts("acme");
    expect(facts).toEqual({
      kind: "org",
      hasCompletedScan: false,
      gapEngaged: false,
      registrySeeded: false,
      loopSchedule: false,
      loopAlerts: false,
      loopStance: false,
      memberCount: 1,
      hasPendingInvite: false,
      hasProgram: false,
    });
  });

  it("first-scan: any persisted Scan row under the org's repos counts (any engine)", async () => {
    const p = fakePrisma({ scan: { findFirst: vi.fn(async () => ({ id: "s1" })) } });
    const facts = await getGettingStartedFacts("acme");
    expect(facts!.hasCompletedScan).toBe(true);
    expect(p.scan.findFirst).toHaveBeenCalledWith({ where: { repo: { orgId: "org_1" } }, select: { id: true } });
  });

  it("gap-engaged: pins the assignee-OR-done predicate on recommendations", async () => {
    const p = fakePrisma({ recommendation: { findFirst: vi.fn(async () => ({ id: "r1" })) } });
    const facts = await getGettingStartedFacts("acme");
    expect(facts!.gapEngaged).toBe(true);
    expect(p.recommendation.findFirst).toHaveBeenCalledWith({
      where: {
        scan: { repo: { orgId: "org_1" } },
        OR: [{ assigneeLogin: { not: null } }, { status: "done" }],
      },
      select: { id: true },
    });
  });

  it("gap-engaged: an opened ImprovementPr counts too (practices / stance apply)", async () => {
    fakePrisma({ improvementPr: { findFirst: vi.fn(async () => ({ id: "pr1" })) } });
    expect((await getGettingStartedFacts("acme"))!.gapEngaged).toBe(true);
  });

  it("registry: only NON-ARCHIVED skill/memory rows count", async () => {
    const p = fakePrisma({ orgSkill: { findFirst: vi.fn(async () => ({ id: "sk1" })) } });
    const facts = await getGettingStartedFacts("acme");
    expect(facts!.registrySeeded).toBe(true);
    expect(p.orgSkill.findFirst).toHaveBeenCalledWith({
      where: { orgId: "org_1", archived: false },
      select: { id: true },
    });
    expect(p.orgMemory.findFirst).toHaveBeenCalledWith({
      where: { orgId: "org_1", archived: false },
      select: { id: true },
    });
  });

  it("registry: a memory row alone suffices", async () => {
    fakePrisma({ orgMemory: { findFirst: vi.fn(async () => ({ id: "m1" })) } });
    expect((await getGettingStartedFacts("acme"))!.registrySeeded).toBe(true);
  });

  it("loop: schedule needs a WATCHED repo with a cadence other than 'off'", async () => {
    const p = fakePrisma({
      repository: {
        findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
          "scanSchedule" in args.where ? { id: "repo1" } : null,
        ),
      },
    });
    const facts = await getGettingStartedFacts("acme");
    expect(facts!.loopSchedule).toBe(true);
    expect(p.repository.findFirst).toHaveBeenCalledWith({
      where: { orgId: "org_1", watched: true, scanSchedule: { not: "off" } },
      select: { id: true },
    });
  });

  it("loop: alerts = a non-blank webhook; stance = a PUBLISHED OrgAiStance row", async () => {
    const p = fakePrisma({
      organization: {
        findUnique: vi.fn(async () => ({ id: "org_1", kind: "org", alertWebhookUrl: "https://hooks.example/x" })),
      },
      orgAiStance: { findFirst: vi.fn(async () => ({ id: "st1" })) },
    });
    const facts = await getGettingStartedFacts("acme");
    expect(facts!.loopAlerts).toBe(true);
    expect(facts!.loopStance).toBe(true);
    expect(p.orgAiStance.findFirst).toHaveBeenCalledWith({
      where: { orgId: "org_1", status: "published" },
      select: { id: true },
    });
  });

  it("loop: a blank webhook string does NOT count as configured", async () => {
    fakePrisma({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", kind: "org", alertWebhookUrl: "  " })) },
    });
    expect((await getGettingStartedFacts("acme"))!.loopAlerts).toBe(false);
  });

  it("team: pins the pending+unexpired invite predicate (same as listPendingInvites)", async () => {
    const p = fakePrisma({ invite: { findFirst: vi.fn(async () => ({ id: "inv1" })) } });
    const facts = await getGettingStartedFacts("acme");
    expect(facts!.hasPendingInvite).toBe(true);
    const where = p.invite.findFirst.mock.calls[0]![0].where;
    expect(where.orgId).toBe("org_1");
    expect(where.status).toBe("pending");
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("personal: a watched pointer repo proves first-scan (its scans live in the public corpus)", async () => {
    const p = fakePrisma({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", kind: "personal", alertWebhookUrl: null })) },
      repository: {
        findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
          "scanSchedule" in args.where ? null : { id: "repo1" },
        ),
      },
    });
    const facts = await getGettingStartedFacts("dana");
    expect(facts!.kind).toBe("personal");
    expect(facts!.hasCompletedScan).toBe(true);
    expect(p.scan.findFirst).toHaveBeenCalled(); // still checked — a direct scan row also counts
  });

  it("personal: a RecommendationOverlay row counts as gap engagement; org kind never reads overlays", async () => {
    const overlay = vi.fn(async () => ({ id: "ov1" }));
    fakePrisma({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", kind: "personal", alertWebhookUrl: null })) },
      recommendationOverlay: { findFirst: overlay },
    });
    expect((await getGettingStartedFacts("dana"))!.gapEngaged).toBe(true);

    const overlayOrg = vi.fn(async () => ({ id: "ov1" }));
    fakePrisma({ recommendationOverlay: { findFirst: overlayOrg } });
    const orgFacts = await getGettingStartedFacts("acme");
    expect(overlayOrg).not.toHaveBeenCalled();
    expect(orgFacts!.gapEngaged).toBe(false);
  });
});

describe("backfill semantics (migration + init.sql mirror)", () => {
  const root = process.cwd();
  const migration = readFileSync(
    join(root, "prisma", "migrations", "20260812200000_add_membership_onboarding_stamp", "migration.sql"),
    "utf8",
  );
  const initSql = readFileSync(join(root, "prisma", "init.sql"), "utf8");

  it("migration adds both NULLABLE columns and stamps every existing row completed", () => {
    expect(migration).toMatch(/ADD COLUMN "onboardingCompletedAt" TIMESTAMP\(3\);/);
    expect(migration).toMatch(/ADD COLUMN "onboardingSkippedAt" TIMESTAMP\(3\);/);
    // The seeded-self-stamp: existing memberships are never ambushed; only NEW rows start null.
    expect(migration).toMatch(/UPDATE "Membership" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP;/);
    // No NOT NULL / DEFAULT — new memberships MUST start null so the flow fires for them.
    expect(migration).not.toMatch(/onboardingCompletedAt" TIMESTAMP\(3\) NOT NULL/);
    expect(migration).not.toMatch(/onboarding\w+" TIMESTAMP\(3\) DEFAULT/);
  });

  it("init.sql guards its backfill on column ABSENCE so pglite's every-boot re-exec can't re-stamp new rows", () => {
    // The one-time backfill lives inside a DO block gated on the column not existing yet…
    const doBlock = /DO \$\$[\s\S]*?column_name = 'onboardingCompletedAt'[\s\S]*?UPDATE "Membership" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP;[\s\S]*?END \$\$;/;
    expect(initSql).toMatch(doBlock);
    // …and there is NO bare (unguarded) membership backfill that a re-exec would replay.
    const bare = initSql.replace(doBlock, "");
    expect(bare).not.toMatch(/UPDATE "Membership"/);
  });
});
