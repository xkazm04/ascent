// THE WORK-PROTOCOL HANDLERS (moonshot #3) — and the one property the whole design rests on:
// NO VERDICT ANY AGENT CAN REPORT CLOSES A ROW.
//
// `report_attempt` is the tool an agent reaches for when it believes it fixed something, so it is
// exactly the tool an implementation would "helpfully" wire to `status: "done"`. This suite fails
// against that implementation, for every verdict, and asserts the claim gate refuses T0 and an
// unassessed tier before any row is touched.

import { beforeEach, describe, expect, it, vi } from "vitest";

const claims: Record<string, unknown>[] = [];
const attempts: Record<string, unknown>[] = [];
let heldRows: { id: string; repo: string }[] = [];
let tier: string | null = "T3";
let sealedGlobs: string[] = [];

const claimRow = (id: string, repo = "acme/api") => ({
  id,
  repo,
  title: "No dependency review on pull requests",
  claimActor: "agent:ci",
  claimExecutor: "remote-agent" as const,
  leaseUntil: "2026-08-30T12:45:00.000Z",
  needsHuman: false,
});

vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async (input: Record<string, unknown>) => {
    claims.push(input);
    const list = input.ids as string[];
    return { claimed: list.map((id) => claimRow(id)), refused: [] };
  }),
  heldFollowups: vi.fn(async (_org: string, wanted: string[]) => heldRows.filter((r) => wanted.includes(r.id)).map((r) => claimRow(r.id, r.repo))),
  reportAttempt: vi.fn(async (input: Record<string, unknown>) => {
    attempts.push(input);
    // The store's real contract, mirrored: `skipped` reopens, the other two leave the row IN PROGRESS.
    return { ...claimRow(input.id as string), leaseUntil: null };
  }),
}));
vi.mock("@/lib/db/org-stance", () => ({
  getStanceRepoFacts: vi.fn(async () => [{ fullName: "acme/api", autonomyTier: tier }]),
  getActiveOrgStance: vi.fn(async () => ({
    version: 3,
    stance: {
      permittedTools: ["Claude Code"],
      permittedModels: [],
      noAiZones: [{ repoGlobs: sealedGlobs, pathGlobs: ["prisma/migrations/**"] }],
      reviewTiers: [{ tier: "T2", review: "Two approvals." }],
      provenance: { requireTrailer: true, requireHumanApproval: false },
    },
  })),
}));
vi.mock("@/lib/local/loop-lane", () => ({
  openBatch: vi.fn(async () => [
    {
      id: "rec-1",
      repo: "acme/api",
      title: "No dependency review on pull requests",
      dimId: "D9",
      dimLabel: "Security",
      impact: "high",
      effort: "low",
      rationale: "Nothing checks a new dependency before it merges.",
      explore: [],
      projectedPoints: 4,
    },
  ]),
}));

const { claimFollowupsTool, getFixBriefTool, reportAttemptTool } = await import("@/lib/mcp/work-tools");

beforeEach(() => {
  claims.length = 0;
  attempts.length = 0;
  heldRows = [{ id: "rec-1", repo: "acme/api" }];
  tier = "T3";
  sealedGlobs = [];
});

describe("report_attempt — the write path has no verb that closes a row", () => {
  it("NEVER writes status `done`, for any verdict", async () => {
    for (const verdict of ["resolved", "skipped", "needs_human"] as const) {
      const res = await reportAttemptTool("acme", { id: "rec-1", verdict, reason: "r" }, "agent:ci", "tok_1");
      expect(res.isError).toBeFalsy();
    }
    // The patch the handler asked the store for never names `done` — not as a status, not anywhere.
    expect(attempts.every((a) => JSON.stringify(a).includes('"done"') === false)).toBe(true);
    expect(attempts.map((a) => a.verdict)).toEqual(["resolved", "skipped", "needs_human"]);
  });

  it("tells a `resolved` reporter, in the same breath, that the rescan decides", async () => {
    const res = await reportAttemptTool("acme", { id: "rec-1", verdict: "resolved", reason: "Added the workflow" }, "agent:ci", null);
    expect(JSON.stringify(res.structuredContent)).toContain("does not close the row");
  });

  it("refuses an unknown verdict rather than coercing it to something actionable", async () => {
    const res = await reportAttemptTool("acme", { id: "rec-1", verdict: "done", reason: "r" }, "agent:ci", null);
    expect(res.isError).toBe(true);
    expect(attempts).toHaveLength(0);
  });

  it("refuses a verdict with no reason — a verdict alone is not an account", async () => {
    const res = await reportAttemptTool("acme", { id: "rec-1", verdict: "resolved" }, "agent:ci", null);
    expect(res.isError).toBe(true);
  });

  it("carries the actor and the token into the store, so the row's holder is checked", async () => {
    await reportAttemptTool("acme", { id: "rec-1", verdict: "skipped", reason: "Already covered" }, "agent:ci", "tok_9");
    expect(attempts[0]).toMatchObject({ actor: "agent:ci", tokenId: "tok_9", org: "acme" });
  });
});

describe("claim_followups — the tier gate runs before any row is touched", () => {
  it("refuses a T0 repository and claims nothing", async () => {
    tier = "T0";
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, "agent:ci", "tok_1");
    expect(res.isError).toBe(true);
    expect(claims).toHaveLength(0);
  });

  it("refuses an unassessed repository — unknown is not green", async () => {
    tier = null;
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, "agent:ci", "tok_1");
    expect(res.isError).toBe(true);
    expect(String(res.text)).toContain("no assessed autonomy tier");
    expect(claims).toHaveLength(0);
  });

  it("refuses a repository sealed by a no-AI zone, whatever its tier", async () => {
    sealedGlobs = ["acme/*"];
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, "agent:ci", "tok_1");
    expect(res.isError).toBe(true);
    expect(claims).toHaveLength(0);
  });

  it("claims as a remote agent under a clamped lease, with the actor on the row", async () => {
    const res = await claimFollowupsTool("acme", { repo: "acme/api", leaseMinutes: 999 }, "agent:ci", "tok_1");
    expect(res.isError).toBeFalsy();
    expect(claims[0]).toMatchObject({ actor: "agent:ci", executor: "remote-agent", tokenId: "tok_1" });
    expect(claims[0]!.leaseMs).toBe(4 * 60 * 60_000);
  });

  it("flags human review on a T2 repo and does not on T3", async () => {
    tier = "T2";
    const t2 = await claimFollowupsTool("acme", { repo: "acme/api" }, "agent:ci", null);
    expect(t2.structuredContent).toMatchObject({ requiresHumanReview: true });
    tier = "T3";
    const t3 = await claimFollowupsTool("acme", { repo: "acme/api" }, "agent:ci", null);
    expect(t3.structuredContent).toMatchObject({ requiresHumanReview: false });
  });

  it("refuses a repository this organization has never scanned rather than inventing a queue", async () => {
    const res = await claimFollowupsTool("acme", { repo: "acme/ghost" }, "agent:ci", null);
    expect(res.isError).toBe(true);
    expect(String(res.text)).toContain("no scan");
  });
});

describe("get_fix_brief — only for rows this caller holds", () => {
  it("names the ids it could not brief instead of silently dropping them", async () => {
    const res = await getFixBriefTool("acme", { ids: ["rec-1", "rec-lost"] }, "agent:ci");
    expect(res.structuredContent).toMatchObject({ refused: [{ id: "rec-lost", reason: "not-held" }] });
  });

  it("carries the org's perimeter and the protocol into the brief text", async () => {
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, "agent:ci");
    expect(res.text).toContain("## Working perimeter");
    expect(res.text).toContain("Claude Code");
    expect(res.text).toContain("prisma/migrations/**");
    expect(res.text).toContain("Nothing you can call closes a row");
  });

  it("refuses outright when the caller holds none of them", async () => {
    heldRows = [];
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, "agent:ci");
    expect(res.isError).toBe(true);
  });
});
