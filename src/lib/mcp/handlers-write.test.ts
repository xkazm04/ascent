// THE WORK-PROTOCOL HANDLERS (moonshot #3) — and the one property the whole design rests on:
// NO VERDICT ANY AGENT CAN REPORT CLOSES A ROW.
//
// `report_attempt` is the tool an agent reaches for when it believes it fixed something, so it is
// exactly the tool an implementation would "helpfully" wire to `status: "done"`. This suite fails
// against that implementation, for every verdict, and asserts the claim gate refuses T0 and an
// unassessed tier before any row is touched.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { buildLaneBrief } from "@/lib/org/lane-brief";

const claims: Record<string, unknown>[] = [];
const attempts: Record<string, unknown>[] = [];
let heldRows: { id: string; repo: string }[] = [];
let tier: string | null = "T3";
let sealedGlobs: string[] = [];
/** The RECORDED admission decision, null when the org has decided nothing for this repo. */
let admission: { derivedTier: string | null; grantedTier: string; mode: string } | null = null;

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
vi.mock("@/lib/db/org-admission", () => ({ getRepoAdmission: vi.fn(async () => admission) }));
// PRIYA-L1-706: the remote brief carries the ORG'S STANDARD, through the very same
// `loadLaneBriefInput` → `buildLaneBrief` pair the local lane uses. Mocked at the DB read only, so
// the assembly under test is the real one — a second, "equivalent" assembly is exactly how the local
// and remote briefs would drift apart again.
let briefInput: Parameters<typeof buildLaneBrief>[0] | null = null;
vi.mock("@/lib/db/lane-brief-read", () => ({ loadLaneBriefInput: vi.fn(async () => briefInput) }));
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
const { runTool } = await import("@/lib/mcp/handlers");
const { MAX_CLAIM_COUNT } = await import("@/lib/mcp/tools");

/** The verified caller. `actor` is the TOKEN ID form (`agent:<id>`); `label` is the token's name,
 *  which is a display string and never the identity. */
const P = (tokenId: string | null = "tok_1") => ({ actor: "agent:tok_1", tokenId, label: "ci" });

beforeEach(() => {
  claims.length = 0;
  attempts.length = 0;
  heldRows = [{ id: "rec-1", repo: "acme/api" }];
  tier = "T3";
  sealedGlobs = [];
  admission = null;
});

describe("report_attempt — the write path has no verb that closes a row", () => {
  it("NEVER writes status `done`, for any verdict", async () => {
    for (const verdict of ["resolved", "skipped", "needs_human"] as const) {
      const res = await reportAttemptTool("acme", { id: "rec-1", verdict, reason: "r" }, P());
      expect(res.isError).toBeFalsy();
    }
    // The patch the handler asked the store for never names `done` — not as a status, not anywhere.
    expect(attempts.every((a) => JSON.stringify(a).includes('"done"') === false)).toBe(true);
    expect(attempts.map((a) => a.verdict)).toEqual(["resolved", "skipped", "needs_human"]);
  });

  it("tells a `resolved` reporter, in the same breath, that the rescan decides", async () => {
    const res = await reportAttemptTool("acme", { id: "rec-1", verdict: "resolved", reason: "Added the workflow" }, P(null));
    expect(JSON.stringify(res.structuredContent)).toContain("does not close the row");
  });

  it("refuses an unknown verdict rather than coercing it to something actionable", async () => {
    const res = await reportAttemptTool("acme", { id: "rec-1", verdict: "done", reason: "r" }, P(null));
    expect(res.isError).toBe(true);
    expect(attempts).toHaveLength(0);
  });

  it("refuses a verdict with no reason — a verdict alone is not an account", async () => {
    const res = await reportAttemptTool("acme", { id: "rec-1", verdict: "resolved" }, P(null));
    expect(res.isError).toBe(true);
  });

  it("carries the actor and the token into the store, so the row's holder is checked", async () => {
    await reportAttemptTool("acme", { id: "rec-1", verdict: "skipped", reason: "Already covered" }, P("tok_9"));
    expect(attempts[0]).toMatchObject({ actor: "agent:tok_1", tokenId: "tok_9", org: "acme" });
  });
});

describe("claim_followups — the tier gate runs before any row is touched", () => {
  it("refuses a T0 repository and claims nothing", async () => {
    tier = "T0";
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, P());
    expect(res.isError).toBe(true);
    expect(claims).toHaveLength(0);
  });

  it("refuses an unassessed repository — unknown is not green", async () => {
    tier = null;
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, P());
    expect(res.isError).toBe(true);
    expect(String(res.text)).toContain("no assessed autonomy tier");
    expect(claims).toHaveLength(0);
  });

  it("refuses a repository sealed by a no-AI zone, whatever its tier", async () => {
    sealedGlobs = ["acme/*"];
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, P());
    expect(res.isError).toBe(true);
    expect(claims).toHaveLength(0);
  });

  it("claims as a remote agent under a clamped lease, with the actor on the row", async () => {
    const res = await claimFollowupsTool("acme", { repo: "acme/api", leaseMinutes: 999 }, P());
    expect(res.isError).toBeFalsy();
    expect(claims[0]).toMatchObject({ actor: "agent:tok_1", executor: "remote-agent", tokenId: "tok_1" });
    expect(claims[0]!.leaseMs).toBe(4 * 60 * 60_000);
  });

  it("flags human review on a T2 repo and does not on T3", async () => {
    tier = "T2";
    const t2 = await claimFollowupsTool("acme", { repo: "acme/api" }, P(null));
    expect(t2.structuredContent).toMatchObject({ requiresHumanReview: true });
    tier = "T3";
    const t3 = await claimFollowupsTool("acme", { repo: "acme/api" }, P(null));
    expect(t3.structuredContent).toMatchObject({ requiresHumanReview: false });
  });

  // UAT PRIYA-L2-C4. Moonshot #8's whole claim is a "recorded, OVERRIDABLE per-repo decision", and
  // this is the only gate that acts on it — it read the derived tier and never looked at the table.
  it("lets a RECORDED grant beat the derived tier, so an owner's T2 is not refused as T0", async () => {
    tier = "T0";
    admission = { derivedTier: "T0", grantedTier: "T2", mode: "agents-allowed" };
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, P());
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ requiresHumanReview: true });
    expect(claims).toHaveLength(1);
  });

  // The other direction, and the reason a grant is not simply "the loosest number wins": the mode is
  // a separate decision from the tier, and it lowers.
  it("refuses a T3 repo held `assisted-only`, and says the tier is not the obstacle", async () => {
    tier = "T3";
    admission = { derivedTier: "T3", grantedTier: "T3", mode: "assisted-only" };
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, P());
    expect(res.isError).toBe(true);
    expect(String(res.text)).toContain("does not permit an agent to open work here");
    expect(claims).toHaveLength(0);
  });

  // Rule 2 of the compiler, kept here rather than re-derived: a grant beside an UNASSESSED derivation
  // is a seed nobody measured, and it must not become the evidence that a repo can be worked.
  it("ignores a grant on a repo whose tier was never assessed", async () => {
    tier = null;
    admission = { derivedTier: null, grantedTier: "T3", mode: "agents-allowed" };
    const res = await claimFollowupsTool("acme", { repo: "acme/api" }, P());
    expect(res.isError).toBe(true);
    expect(String(res.text)).toContain("no assessed autonomy tier");
    expect(claims).toHaveLength(0);
  });

  it("refuses a repository this organization has never scanned rather than inventing a queue", async () => {
    const res = await claimFollowupsTool("acme", { repo: "acme/ghost" }, P(null));
    expect(res.isError).toBe(true);
    expect(String(res.text)).toContain("no scan");
  });
});

describe("get_fix_brief — only for rows this caller holds", () => {
  it("names the ids it could not brief instead of silently dropping them", async () => {
    const res = await getFixBriefTool("acme", { ids: ["rec-1", "rec-lost"] }, P());
    expect(res.structuredContent).toMatchObject({ refused: [{ id: "rec-lost", reason: "not-held" }] });
  });

  it("carries the org's perimeter and the protocol into the brief text", async () => {
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, P());
    expect(res.text).toContain("## Working perimeter");
    expect(res.text).toContain("Claude Code");
    expect(res.text).toContain("prisma/migrations/**");
    expect(res.text).toContain("Nothing you can call closes a row");
  });

  it("carries the ORGANIZATION'S STANDARD, the same one a local lane gets", async () => {
    briefInput = {
      org: "acme",
      repo: "acme/api",
      dimIds: ["D9"],
      playbooks: [
        {
          id: "pb-1",
          dimId: "D9",
          title: "Dependency review",
          version: 2,
          summary: "Nothing new enters the lockfile unreviewed.",
          steps: ["Review every new dependency before it merges."],
        },
      ],
      housePattern: [],
      memories: [],
      skills: [],
      evidence: [],
    };
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, P());
    expect(res.text).toContain("## Your organization's standard");
    expect(res.text).toContain("Dependency review");
    // Order matters: the standard is what the work should look like, the perimeter is the fence
    // around it. Same order the local lane's prompt uses.
    expect(String(res.text).indexOf("## Your organization's standard")).toBeLessThan(
      String(res.text).indexOf("## Working perimeter"),
    );
  });

  it("omits the standard heading entirely when the org has published nothing for these dimensions", async () => {
    briefInput = null;
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, P());
    // A heading over an empty section reads to a model as "there are no rules here", which is the
    // one thing an absent standard must not say.
    expect(res.text).not.toContain("## Your organization's standard");
    expect(res.text).toContain("## Working perimeter");
  });

  it("refuses outright when the caller holds none of them", async () => {
    heldRows = [];
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, P());
    expect(res.isError).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE SCHEMA IS ENFORCED AT DISPATCH (Direction 2). `validate-args.test.ts` proves the rules; this
// proves the DOOR runs them — on `runTool`, so the MCP route and Athena's in-process grounding get
// the same enforcement, and a violation is an in-band result the model can fix rather than a throw or
// a protocol error.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("runTool validates arguments before dispatching", () => {
  const principal = P();

  it("refuses an over-long `ids` IN BAND and claims nothing", async () => {
    const ids = Array.from({ length: MAX_CLAIM_COUNT + 1 }, (_, i) => `rec-${i}`);
    const res = await runTool("claim_followups", "acme", { repo: "acme/api", ids }, principal);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(new RegExp(`\`ids\` takes at most ${MAX_CLAIM_COUNT}`));
    expect(res.text).toMatch(/claim_followups again/);
    // The whole point of refusing rather than truncating: nothing was leased under a partial list.
    expect(claims).toHaveLength(0);
  });

  it("refuses an undeclared argument rather than reading it", async () => {
    const res = await runTool("report_attempt", "acme", { id: "rec-1", verdict: "skipped", reason: "r", who: "me" }, principal);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/`who` is not an argument of this tool/);
    expect(attempts).toHaveLength(0);
  });

  it("lets a conforming call through untouched", async () => {
    const res = await runTool("report_attempt", "acme", { id: "rec-1", verdict: "skipped", reason: "r" }, principal);
    expect(res.isError).toBeFalsy();
    expect(attempts).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE BRIEF RE-CHECKS ADMISSION (Direction 3). A lease runs up to four hours; a governance decision
// takes effect the moment it is recorded. Before this, `claimability` ran only at the claim, so an
// agent holding a lease kept receiving working briefs for a repository its owner had just moved to
// `assisted-only` — the decision applied to the next agent and not to the one already inside.
//
// FAIL-BEFORE: delete the `claimability` block in `getFixBriefTool` and both cases below fail.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("get_fix_brief — a repo that no longer admits agents", () => {
  it("refuses the row BY NAME with the org's own sentence, and briefs nothing", async () => {
    admission = { derivedTier: "T3", grantedTier: "T3", mode: "assisted-only" };
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, P());
    const out = res.structuredContent as { briefs: unknown[]; refused: { id: string; reason: string; detail?: string }[] };
    expect(out.briefs).toHaveLength(0);
    expect(out.refused).toEqual([
      { id: "rec-1", reason: "repo-closed", detail: expect.stringContaining("a person driving") },
    ]);
  });

  it("refuses a repo sealed into a no-AI zone after the claim", async () => {
    sealedGlobs = ["acme/*"];
    const out = (await getFixBriefTool("acme", { ids: ["rec-1"] }, P())).structuredContent as {
      refused: { reason: string; detail?: string }[];
    };
    expect(out.refused[0]!.reason).toBe("repo-closed");
    expect(out.refused[0]!.detail).toMatch(/no-AI zone/i);
  });

  it("still briefs a repo that admits them, and takes `requiresHumanReview` from the same verdict", async () => {
    tier = "T2";
    const res = await getFixBriefTool("acme", { ids: ["rec-1"] }, P());
    const out = res.structuredContent as { briefs: { brief: string }[]; refused: unknown[] };
    expect(out.briefs).toHaveLength(1);
    expect(out.refused).toEqual([]);
    // T2 is allowed and flagged — the one derivation, `claimability`'s, reaching the brief text.
    expect(out.briefs[0]!.brief).toMatch(/human review is required/i);
  });
});
