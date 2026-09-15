// Fixture-driven tests for the four GitLab mappers. NO live GitLab: every mapper is pure over a JSON
// shape, which is the reason the adapter was split into `http.ts` (network) + mappers (pure).
//
// FAIL-BEFORE for the governance guard (verified, see the handoff): defaulting an unmapped
// `Governance` field to `true` — e.g. `requiresSignatures: pushRule?.reject_unsigned_commits !== false`
// — turns "reads an unmapped field as FALSE, never true" red. That is the failure that matters here:
// a GitLab repo silently credited with controls it never configured.

import { describe, expect, it } from "vitest";
import { globMatches, mapGovernance } from "@/lib/forge/gitlab/governance";
import { mapCiHealth } from "@/lib/forge/gitlab/pipelines";
import { mapDeployments } from "@/lib/forge/gitlab/deployments";
import { mapMergeRequest, mapState, summarizeGitlabMrs } from "@/lib/forge/gitlab/merge-requests";

describe("gitlab → Governance", () => {
  const protectedMain = {
    name: "main",
    push_access_levels: [{ access_level: 0 }],
    merge_access_levels: [{ access_level: 30 }],
    code_owner_approval_required: true,
  };

  it("maps a fully-governed project", () => {
    expect(
      mapGovernance({
        defaultBranch: "main",
        branches: [protectedMain],
        approvals: { approvals_before_merge: 2 },
        pushRule: { reject_unsigned_commits: true },
        project: { merge_method: "ff", only_allow_merge_if_pipeline_succeeds: true },
      }),
    ).toEqual({
      defaultBranch: "main",
      protected: true,
      requiresPullRequest: true,
      requiredApprovals: 2,
      requiresCodeOwnerReview: true,
      requiresStatusChecks: true,
      requiresSignatures: true,
      linearHistory: true,
      ruleCount: 1,
      readable: true,
    });
  });

  it("reads an unmapped field as FALSE, never true — an unearned control is worse than none", () => {
    const g = mapGovernance({
      defaultBranch: "main",
      branches: [{ name: "main", push_access_levels: [{ access_level: 30 }] }],
      approvals: null,
      pushRule: null,
      project: null,
    })!;
    expect(g.requiresSignatures).toBe(false);
    expect(g.requiresStatusChecks).toBe(false);
    expect(g.requiresCodeOwnerReview).toBe(false);
    expect(g.linearHistory).toBe(false);
    // A developer-level push access level means direct pushes ARE allowed.
    expect(g.requiresPullRequest).toBe(false);
    // An unreadable approvals API is 0 required approvals, matching the GitHub path's no-rule case.
    expect(g.requiredApprovals).toBe(0);
  });

  it("returns null — not observable — when the protected-branch list is unreadable", () => {
    expect(
      mapGovernance({ defaultBranch: "main", branches: null, approvals: null, pushRule: null, project: null }),
    ).toBeNull();
  });

  it("matches a wildcard protection pattern", () => {
    expect(globMatches("main*", "main")).toBe(true);
    expect(globMatches("release/*", "release/2.1")).toBe(true);
    expect(globMatches("main", "develop")).toBe(false);
    const g = mapGovernance({
      defaultBranch: "main",
      branches: [{ name: "*", push_access_levels: [{ access_level: 0 }] }],
      approvals: null,
      pushRule: null,
      project: null,
    })!;
    expect(g.protected).toBe(true);
  });

  it("rebase_merge does NOT count as linear history — merge commits are still reachable", () => {
    const g = mapGovernance({
      defaultBranch: "main",
      branches: [protectedMain],
      approvals: null,
      pushRule: null,
      project: { merge_method: "rebase_merge" },
    })!;
    expect(g.linearHistory).toBe(false);
  });
});

describe("gitlab → CiHealth", () => {
  it("excludes non-verdict statuses from the success rate", () => {
    const ci = mapCiHealth("main", [
      { status: "success", ref: "main", duration: 120, updated_at: "2026-08-01T00:00:00Z", source: "push" },
      { status: "failed", ref: "main", duration: 240, updated_at: "2026-08-02T00:00:00Z", source: "schedule" },
      { status: "canceled", ref: "main", updated_at: "2026-08-03T00:00:00Z", source: "push" },
      { status: "running", ref: "main", updated_at: "2026-08-04T00:00:00Z", source: "push" },
    ])!;
    expect(ci.sampled).toBe(2);
    expect(ci.successRate).toBe(50);
    expect(ci.medianDurationMin).toBe(3);
    expect(ci.latestRunAt).toBe("2026-08-04T00:00:00Z");
    expect(ci.failing).toEqual(["schedule"]);
  });

  it("reports NO SAMPLE as null, never as 0% healthy", () => {
    const ci = mapCiHealth("main", [{ status: "running", ref: "main" }])!;
    expect(ci.sampled).toBe(0);
    expect(ci.successRate).toBeNull();
    expect(ci.medianDurationMin).toBeNull();
  });

  it("returns null for an unreadable list — not observable", () => {
    expect(mapCiHealth("main", null)).toBeNull();
  });
});

describe("gitlab → DeploymentRecord", () => {
  it("maps an environment deployment, preserving GitLab's own status vocabulary", () => {
    expect(
      mapDeployments([
        {
          id: 41,
          status: "success",
          created_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T10:05:00Z",
          environment: { name: "production" },
          deployable: { commit: { id: "abc123" }, ref: "main" },
        },
      ]),
    ).toEqual([
      {
        externalId: "41",
        environment: "production",
        sha: "abc123",
        ref: "main",
        state: "success",
        createdAt: "2026-08-01T10:00:00Z",
        statusAt: "2026-08-01T10:05:00Z",
      },
    ]);
  });

  it("DROPS a deployment with no resolvable sha — an unjoinable row would only inflate the count", () => {
    expect(mapDeployments([{ id: 1, status: "success", created_at: "2026-08-01T10:00:00Z" }])).toEqual([]);
  });

  it("an unreadable list is [] — 'not observable', which the outcome views already render as unmeasured", () => {
    expect(mapDeployments(null)).toEqual([]);
  });
});

describe("gitlab → PrNode", () => {
  const mr = {
    iid: 7,
    title: "Add retry policy",
    description: "Co-Authored-By: Claude <noreply@anthropic.com>",
    draft: false,
    state: "merged",
    createdAt: "2026-08-01T00:00:00Z",
    mergedAt: "2026-08-02T00:00:00Z",
    closedAt: null,
    userNotesCount: 4,
    mergeCommitSha: "deadbeef",
    diffStatsSummary: { additions: 30, deletions: 5, fileCount: 3 },
    author: { username: "dana", bot: false },
    labels: { nodes: [{ title: "backend" }, null] },
    approvedBy: { nodes: [{ username: "tomas", bot: false }] },
    commits: { nodes: [{ sha: "c1", message: "fix\n\nCo-Authored-By: Claude <x>" }] },
  };

  it("maps every field, with approvals as timestamp-less APPROVED reviews", () => {
    const node = mapMergeRequest(mr)!;
    expect(node.number).toBe(7);
    expect(node.state).toBe("MERGED");
    expect(node.additions).toBe(30);
    expect(node.deletions).toBe(5);
    expect(node.changedFiles).toBe(3);
    expect(node.labels.nodes).toEqual([{ name: "backend" }]);
    expect(node.comments.totalCount).toBe(4);
    expect(node.reviews.totalCount).toBe(1);
    // GitLab's approval record carries NO timestamp. Null is the honest value; a merge time borrowed
    // as a review time would fabricate `medianHoursToFirstReview` out of nothing.
    expect(node.reviews.nodes[0]).toEqual({
      state: "APPROVED",
      submittedAt: null,
      author: { login: "tomas", __typename: "User" },
    });
    expect(node.mergeCommit?.oid).toBe("deadbeef");
    expect(node.commits?.nodes[0]).toEqual({ commit: { oid: "c1", message: expect.stringContaining("Co-Authored-By") } });
  });

  it("maps state conservatively — an unrecognized state is never counted as a merge", () => {
    expect(mapState("opened", null)).toBe("OPEN");
    expect(mapState("locked", null)).toBe("OPEN");
    expect(mapState("closed", null)).toBe("CLOSED");
    expect(mapState("merged", null)).toBe("MERGED");
    expect(mapState("something_new", null)).toBe("CLOSED");
    // A merge timestamp always wins: it is the fact, the state string is the label.
    expect(mapState("opened", "2026-08-02T00:00:00Z")).toBe("MERGED");
  });

  it("marks a bot author so the shared AI detectors see it", () => {
    const node = mapMergeRequest({ ...mr, author: { username: "renovate", bot: true } })!;
    expect(node.author).toEqual({ login: "renovate", __typename: "Bot" });
  });

  it("drops a malformed MR and reports the sample as PARTIAL, so it is not persisted as authoritative", () => {
    const out = summarizeGitlabMrs({ count: 2, nodes: [mr, { title: "no iid" }] });
    expect(out.partial).toBe(true);
    expect(out.stats.analyzed).toBe(1);
    // The rates come from the SHARED summarizer, so the AI detectors behave identically per forge.
    expect(out.stats.totalCount).toBe(2);
    expect(out.aiChanges).toHaveLength(1);
    expect(out.aiChanges[0]?.prNumber).toBe(7);
  });

  it("is complete when every node maps", () => {
    expect(summarizeGitlabMrs({ count: 1, nodes: [mr] }).partial).toBe(false);
  });
});
