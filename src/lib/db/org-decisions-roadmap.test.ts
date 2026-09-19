// Direction 1 — a dismissal becomes evidence the next scan hears.
//
// The invariant under test is END-TO-END and deliberately spans two modules: dismissing a roadmap
// recommendation WITH A REASON must land as an OrgDecision that `decisionsForRepo` returns and
// `decisionsBlock` renders into the next scan's prompt — through the EXISTING standing-decision path,
// not a second suppression list. Three corners carry the product risk:
//   * a dismissal with NO reason must record nothing (silence is not permanent suppression);
//   * un-dismissing must un-suppress;
//   * the prompt must keep its "new evidence contradicts the stated reason" escape hatch, because a
//     suppression with no override is how a platform goes blind to a gap that came back.
//
// A live LLM scan is not runnable here, so the suppression is asserted at the boundary the platform
// controls — what the prompt actually says — not by observing a model's roadmap.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import type { LlmScoreInput } from "@/lib/llm/provider";

interface Row {
  id: string;
  orgId: string;
  module: string;
  itemKey: string;
  status: string;
  rationale: string;
  title: string;
  decidedBy: string | null;
  snoozedUntil: Date | null;
  memoryId: string | null;
  updatedAt: Date;
}

const store: Row[] = [];
/** The one recommendation every test dismisses: acme/rocket, D3, "CI never gates the tests". */
let recRow: unknown = {
  scan: { repo: { fullName: "acme/rocket", org: { slug: "acme" } } },
};

const prisma = {
  orgDecision: {
    findMany: vi.fn(async ({ where }: { where: { orgId: string; module?: string } }) =>
      store.filter((r) => r.orgId === where.orgId && (!where.module || r.module === where.module)),
    ),
    findUnique: vi.fn(async ({ where }: { where: { orgId_module_itemKey: { orgId: string; module: string; itemKey: string } } }) => {
      const k = where.orgId_module_itemKey;
      return store.find((r) => r.orgId === k.orgId && r.module === k.module && r.itemKey === k.itemKey) ?? null;
    }),
    upsert: vi.fn(async ({ where, update, create }: {
      where: { orgId_module_itemKey: { orgId: string; module: string; itemKey: string } };
      update: Partial<Row>;
      create: Row;
    }) => {
      const k = where.orgId_module_itemKey;
      const existing = store.find((r) => r.orgId === k.orgId && r.module === k.module && r.itemKey === k.itemKey);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return { id: existing.id };
      }
      const row: Row = { ...create, id: `dec_${store.length + 1}`, memoryId: null, updatedAt: new Date() };
      store.push(row);
      return { id: row.id };
    }),
    update: vi.fn(async () => ({})),
  },
  recommendation: { findUnique: vi.fn(async () => recRow) },
};

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => prisma,
}));
vi.mock("@/lib/db/org-shared", () => ({
  getOrgBySlug: async (slug: string) => (slug === "acme" ? { id: "org_1", slug: "acme" } : null),
  normalizeOrgSlug: (s: string) => s.trim().toLowerCase(),
}));
// Memory + audit are best-effort side-writes by contract; keep them inert so the decision itself is
// what's asserted.
vi.mock("@/lib/db/org-memory", () => ({ createOrgMemory: async () => null }));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: async () => undefined }));

const {
  clearRecommendationDismissal,
  decisionsForRepo,
  recommendationDecisionKey,
  recordRecommendationDismissal,
  ROADMAP_DECISION_MODULE,
} = await import("@/lib/db/org-decisions");

const REC = { title: "CI never gates the tests", dimension: "D3" };
const REASON = "We build with Bazel; the GitHub workflow is a mirror and gating happens upstream.";

function scoreInput(overrides: Partial<LlmScoreInput> = {}): LlmScoreInput {
  return {
    repo: { owner: "acme", name: "rocket", url: "https://github.com/acme/rocket", stars: 1, forks: 0, defaultBranch: "main" },
    signals: [{ id: "D3", signalScore: 40, signals: [] }],
    files: [],
    commitSample: [],
    archetype: "team",
    governance: null,
    ...overrides,
  };
}

beforeEach(() => {
  store.length = 0;
  recRow = { scan: { repo: { fullName: "acme/rocket", org: { slug: "acme" } } } };
  vi.clearAllMocks();
});

describe("recommendationDecisionKey", () => {
  it("is prefixed with the repo so decisionsForRepo's exact prefix match picks it up", () => {
    expect(recommendationDecisionKey("acme/rocket", "D3", REC.title)).toMatch(/^acme\/rocket::rec:D3:/);
  });

  it("survives a live-LLM rephrasing of case, punctuation and whitespace", () => {
    expect(recommendationDecisionKey("acme/rocket", "D3", "CI never gates the tests")).toBe(
      recommendationDecisionKey("acme/rocket", "D3", "  CI never gates the tests.  "),
    );
  });

  it("treats a materially different gap in the same dimension as a different decision", () => {
    expect(recommendationDecisionKey("acme/rocket", "D3", "CI never gates the tests")).not.toBe(
      recommendationDecisionKey("acme/rocket", "D3", "No coverage tracking is configured"),
    );
  });
});

describe("dismissing a recommendation with a reason", () => {
  it("persists it as a standing decision scoped to org + repo + this gap", async () => {
    await recordRecommendationDismissal("rec_1", { ...REC, reason: REASON }, "octocat");
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      orgId: "org_1",
      module: ROADMAP_DECISION_MODULE,
      itemKey: recommendationDecisionKey("acme/rocket", "D3", REC.title),
      status: "dismissed",
      rationale: REASON,
      decidedBy: "octocat",
    });
  });

  it("is carried into the next scan's prompt through the EXISTING decisionsBlock", async () => {
    await recordRecommendationDismissal("rec_1", { ...REC, reason: REASON }, "octocat");
    const orgDecisions = await decisionsForRepo("acme", "acme/rocket");
    expect(orgDecisions).toHaveLength(1);

    const { user, system } = buildAssessmentPrompt(scoreInput({ orgDecisions }));
    expect(user).toContain("STANDING DECISIONS");
    expect(user).toContain(`[${ROADMAP_DECISION_MODULE} · dismissed] CI never gates the tests (D3)`);
    expect(user).toContain(`reason: ${REASON}`);
    // The suppression instruction itself…
    expect(user).toContain("do NOT re-raise a dismissed finding in the roadmap");
    // …and the escape hatch, so new evidence still overrides the standing reason.
    expect(user).toContain("unless new evidence contradicts its stated reason");
    // …and the calibration framing that stops "they dismissed it" reading as "this is fine".
    expect(user).toContain("not as a reason to raise the score");
    // Never in the cacheable SYSTEM prefix.
    expect(system).not.toContain("STANDING DECISIONS");
  });

  it("re-dismissing the same gap edits the one row rather than stacking suppressions", async () => {
    await recordRecommendationDismissal("rec_1", { ...REC, reason: REASON }, "octocat");
    await recordRecommendationDismissal("rec_9", { ...REC, reason: "Still Bazel." }, "hubot");
    expect(store).toHaveLength(1);
    expect(store[0]!.rationale).toBe("Still Bazel.");
  });
});

describe("a dismissal with no reason", () => {
  it.each([undefined, null, "", "   "])("records nothing for %p — silence is not suppression", async (reason) => {
    const res = await recordRecommendationDismissal("rec_1", { ...REC, reason }, "octocat");
    expect(res).toBeNull();
    expect(store).toHaveLength(0);
    expect(prisma.orgDecision.upsert).not.toHaveBeenCalled();
    expect(await decisionsForRepo("acme", "acme/rocket")).toEqual([]);
  });
});

describe("un-dismissing", () => {
  it("reopens the standing decision so the gap stops being suppressed", async () => {
    await recordRecommendationDismissal("rec_1", { ...REC, reason: REASON }, "octocat");
    expect(await decisionsForRepo("acme", "acme/rocket")).toHaveLength(1);

    await clearRecommendationDismissal("rec_1", REC, "octocat");
    expect(store[0]!.status).toBe("open");
    // Reopened ⇒ not resolved ⇒ never sent to the model again.
    expect(await decisionsForRepo("acme", "acme/rocket")).toEqual([]);
    // The reason stays ON the record; it just no longer speaks for the team.
    expect(store[0]!.rationale).toBe(REASON);
  });

  it("is a no-op for a gap that was never dismissed (no manufactured 'open' decision)", async () => {
    const res = await clearRecommendationDismissal("rec_1", REC, "octocat");
    expect(res).toBeNull();
    expect(store).toHaveLength(0);
  });
});

describe("never-throwing contract", () => {
  it("swallows an unresolvable recommendation rather than failing the PATCH", async () => {
    recRow = null;
    await expect(recordRecommendationDismissal("nope", { ...REC, reason: REASON })).resolves.toBeNull();
    await expect(clearRecommendationDismissal("nope", REC)).resolves.toBeNull();
  });

  it("swallows a decision-store failure", async () => {
    prisma.recommendation.findUnique.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordRecommendationDismissal("rec_1", { ...REC, reason: REASON })).resolves.toBeNull();
    warn.mockRestore();
  });
});
