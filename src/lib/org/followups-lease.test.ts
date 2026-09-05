// The work lease's PURE half (moonshot #3): who may claim, and when a lease has lapsed.
//
// The table below is the authorization rule of the whole agent-work protocol, so it is asserted
// exhaustively over tier × executor rather than by example. The two rows worth reading twice are
// `null` tier (refused — unknown is not green) and `local`/`human` on T0 (allowed — the tier gates
// UNATTENDED AI authorship, not the operator's own box or a person's own hands).

import { describe, expect, it } from "vitest";
import {
  AGENT_LEASE_MS_DEFAULT,
  AGENT_LEASE_MS_MAX,
  AGENT_LEASE_MS_MIN,
  ATTEMPT_VERDICTS,
  buildAgentBrief,
  claimRefusalText,
  claimability,
  clampLeaseMs,
  isAttemptVerdict,
  leaseExpired,
  leaseRemainingMs,
  type ClaimExecutor,
  type FollowUpItem,
} from "@/lib/org/followups";
import type { AutonomyTierId } from "@/lib/types";

const NOW = new Date("2026-08-30T12:00:00.000Z");

const item = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id: "rec-1",
  repo: "acme/api",
  title: "No dependency review on pull requests",
  dimId: "D9",
  dimLabel: "Security",
  impact: "high",
  effort: "low",
  rationale: "Nothing checks a new dependency before it merges.",
  explore: ["Which workflow would carry it?"],
  projectedPoints: 4,
  ...over,
});

describe("claimability — the tier × executor table", () => {
  const tiers: (AutonomyTierId | null)[] = [null, "T0", "T1", "T2", "T3"];

  it("refuses a remote agent on T0 and on an unassessed tier, and only there", () => {
    const refused = tiers.filter((t) => !claimability({ autonomyTier: t, executor: "remote-agent" }).allowed);
    expect(refused).toEqual([null, "T0"]);
  });

  it("names WHY it refused, so the two refusals are not the same fact", () => {
    expect(claimability({ autonomyTier: "T0", executor: "remote-agent" })).toEqual({
      allowed: false,
      reason: "tier-blocked",
    });
    expect(claimability({ autonomyTier: null, executor: "remote-agent" })).toEqual({
      allowed: false,
      reason: "tier-unknown",
    });
  });

  it("flags human review on T1 and T2 but not on T3", () => {
    expect(claimability({ autonomyTier: "T1", executor: "remote-agent" })).toEqual({ allowed: true, requiresHumanReview: true });
    expect(claimability({ autonomyTier: "T2", executor: "remote-agent" })).toEqual({ allowed: true, requiresHumanReview: true });
    expect(claimability({ autonomyTier: "T3", executor: "remote-agent" })).toEqual({ allowed: true, requiresHumanReview: false });
  });

  it("refuses a sealed repo whatever its tier — a no-AI zone outranks a green tier", () => {
    expect(claimability({ autonomyTier: "T3", executor: "remote-agent", sealed: true })).toEqual({
      allowed: false,
      reason: "no-ai-zone",
    });
  });

  // The MODE is a second decision, not a second name for the tier (UAT PRIYA-L2-C4). A T3 repo an
  // owner holds `assisted-only` is refused; a repo with no recorded decision is gated as it always was.
  it("refuses an admission mode below `agents-allowed`, whatever the tier", () => {
    for (const mode of ["assisted-only", "blocked"] as const) {
      expect(claimability({ autonomyTier: "T3", executor: "remote-agent", admissionMode: mode })).toEqual({
        allowed: false,
        reason: "admission-blocked",
      });
    }
    expect(claimability({ autonomyTier: "T3", executor: "remote-agent", admissionMode: "agents-allowed" })).toEqual({
      allowed: true,
      requiresHumanReview: false,
    });
  });

  it("treats an ABSENT mode as no decision, never as a refusal", () => {
    expect(claimability({ autonomyTier: "T2", executor: "remote-agent", admissionMode: null })).toEqual({
      allowed: true,
      requiresHumanReview: true,
    });
  });

  // Order matters: a sealed repo is refused for the zone that sealed it, not for a mode.
  it("names the no-AI zone ahead of the mode when both would refuse", () => {
    expect(claimability({ autonomyTier: "T3", executor: "remote-agent", sealed: true, admissionMode: "blocked" })).toEqual({
      allowed: false,
      reason: "no-ai-zone",
    });
  });

  it("leaves the local engine and a person unaffected by the tier", () => {
    for (const executor of ["local", "human"] as ClaimExecutor[]) {
      for (const tier of tiers) {
        expect(claimability({ autonomyTier: tier, executor, sealed: true })).toEqual({
          allowed: true,
          requiresHumanReview: false,
        });
      }
    }
  });

  it("gives a refusal sentence that names the repo and nothing else", () => {
    for (const reason of ["tier-blocked", "tier-unknown", "no-ai-zone", "admission-blocked"] as const) {
      const text = claimRefusalText(reason, "acme/api");
      expect(text).toContain("acme/api");
      expect(text.length).toBeGreaterThan(40);
    }
  });
});

describe("leaseExpired — null is a human hand-off, never an expiry", () => {
  it("is false for a null lease, however old the row", () => {
    expect(leaseExpired(null, NOW)).toBe(false);
    expect(leaseRemainingMs(null, NOW)).toBeNull();
  });

  it("is false one millisecond before the boundary and true AT it", () => {
    const at = NOW.toISOString();
    const justBefore = new Date(NOW.getTime() + 1).toISOString();
    expect(leaseExpired(justBefore, NOW)).toBe(false);
    expect(leaseExpired(at, NOW)).toBe(true);
  });

  it("is false for an unparseable value rather than releasing a row on bad data", () => {
    expect(leaseExpired("not-a-date", NOW)).toBe(false);
    expect(leaseRemainingMs("not-a-date", NOW)).toBeNull();
  });

  it("reports remaining time, floored at zero once lapsed", () => {
    expect(leaseRemainingMs(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe(60_000);
    expect(leaseRemainingMs(new Date(NOW.getTime() - 60_000).toISOString(), NOW)).toBe(0);
  });
});

describe("clampLeaseMs", () => {
  it("defaults when the caller asked for nothing", () => {
    expect(clampLeaseMs(undefined)).toBe(AGENT_LEASE_MS_DEFAULT);
    expect(clampLeaseMs(null)).toBe(AGENT_LEASE_MS_DEFAULT);
    expect(clampLeaseMs(Number.NaN)).toBe(AGENT_LEASE_MS_DEFAULT);
  });

  it("clamps into the band rather than refusing", () => {
    expect(clampLeaseMs(1)).toBe(AGENT_LEASE_MS_MIN);
    expect(clampLeaseMs(999 * 60_000)).toBe(AGENT_LEASE_MS_MAX);
  });
});

describe("ATTEMPT_VERDICTS", () => {
  it("is the reportable subset — never `attempted` or `absent`", () => {
    expect([...ATTEMPT_VERDICTS]).toEqual(["resolved", "skipped", "needs_human"]);
    expect(isAttemptVerdict("attempted")).toBe(false);
    expect(isAttemptVerdict("absent")).toBe(false);
    expect(isAttemptVerdict("done")).toBe(false);
    expect(isAttemptVerdict("resolved")).toBe(true);
  });
});

describe("buildAgentBrief", () => {
  const ctx = { org: "acme", generatedAt: "2026-08-30T12:00:00.000Z" };
  const base = { repo: "acme/api", autonomyTier: "T2" as const, reviewText: null, requiresHumanReview: true, leaseUntil: "2026-08-30T12:45:00.000Z" };

  it("keeps the fix prompt intact and appends the perimeter and the protocol", () => {
    const text = buildAgentBrief([item()], ctx, { ...base, stance: null });
    expect(text).toContain("# Ascent follow-ups — acme");
    expect(text).toContain("No dependency review on pull requests");
    expect(text).toContain("## Working perimeter");
    expect(text).toContain("autonomy tier T2");
    expect(text).toContain("2026-08-30T12:45:00.000Z");
    expect(text).toContain("## Protocol");
    expect(text).toContain("Ascent-Resolves: <id>");
    expect(text).toContain("report_attempt");
  });

  it("answers an absent stance rather than leaving an empty heading", () => {
    const text = buildAgentBrief([item()], ctx, { ...base, stance: null });
    expect(text).toContain("Absence is not permission");
  });

  it("carries the org's own stored values verbatim, inventing none", () => {
    const text = buildAgentBrief([item()], ctx, {
      ...base,
      reviewText: "Two approvals from the platform team.",
      stance: {
        permittedTools: ["Claude Code"],
        permittedModels: ["claude-opus"],
        noAiZones: [{ repoGlobs: [], pathGlobs: ["prisma/migrations/**"], reason: "hand-reviewed" }],
        reviewTiers: [],
        provenance: { requireTrailer: true, requireHumanApproval: true },
      },
    });
    expect(text).toContain("Claude Code");
    expect(text).toContain("claude-opus");
    expect(text).toContain("prisma/migrations/**");
    expect(text).toContain("Two approvals from the platform team.");
  });

  it("never tells the agent it can close a row", () => {
    const text = buildAgentBrief([item()], ctx, { ...base, stance: null });
    expect(text).toContain("Nothing you can call closes a row");
  });
});
