// Regression tests for fetchBranchGovernance (ambiguity-ui-scan-2026-07-16 github-repo-data-access #1):
// a FAILED rulesets read (403 restricted token / 404 GHES without the rules API / non-array body) must
// yield "governance unknown" (null) — never a fabricated "zero rules" object with readable:true, which
// false-negates 6 governance signals on exactly the locked-down repos most likely to restrict the token.
// A 200 with a genuinely empty array remains a real "no rules".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/github/host", () => ({
  githubApiBase: () => "https://api.github.test",
  ghFetch: vi.fn(),
}));

import { ghFetch } from "@/lib/github/host";
import { fetchBranchGovernance } from "./governance";

const mockFetch = vi.mocked(ghFetch);

/** Minimal Response-alike for getJson: `.status` + `.json()`. */
function res(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

/** Route the two parallel reads by URL: the branch read vs the rulesets read. */
function stubReads(branch: { status: number; body: unknown }, rules: { status: number; body: unknown }) {
  mockFetch.mockImplementation(async (url: string) =>
    url.includes("/rules/branches/") ? res(rules.status, rules.body) : res(branch.status, branch.body),
  );
}

const PROTECTED_BRANCH = { protected: true };

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchBranchGovernance — rulesets read failure must not fabricate 'no rules'", () => {
  it("returns null (governance unknown) when the rulesets read is DENIED (403)", async () => {
    stubReads({ status: 200, body: PROTECTED_BRANCH }, { status: 403, body: { message: "Forbidden" } });
    const gov = await fetchBranchGovernance("acme", "core", "main", "tok");
    // The old behavior returned { requiresPullRequest:false, …, ruleCount:0, readable:true } here —
    // a confident false negative. Unknown must be unknown.
    expect(gov).toBeNull();
  });

  it("returns null when the rulesets endpoint doesn't exist (404, e.g. older GHES)", async () => {
    stubReads({ status: 200, body: PROTECTED_BRANCH }, { status: 404, body: { message: "Not Found" } });
    expect(await fetchBranchGovernance("acme", "core", "main", "tok")).toBeNull();
  });

  it("returns null when a 200 rulesets body is not an array (proxy HTML / truncated stream)", async () => {
    stubReads({ status: 200, body: PROTECTED_BRANCH }, { status: 200, body: null });
    expect(await fetchBranchGovernance("acme", "core", "main", "tok")).toBeNull();
  });

  it("a 200 with a genuinely EMPTY rules array is still a real 'no rules' result", async () => {
    stubReads({ status: 200, body: PROTECTED_BRANCH }, { status: 200, body: [] });
    const gov = await fetchBranchGovernance("acme", "core", "main", "tok");
    expect(gov).toMatchObject({ protected: true, requiresPullRequest: false, ruleCount: 0, readable: true });
  });

  it("still parses active rules from a successful rulesets read", async () => {
    stubReads(
      { status: 200, body: PROTECTED_BRANCH },
      {
        status: 200,
        body: [
          { type: "pull_request", parameters: { required_approving_review_count: 2 } },
          { type: "required_status_checks" },
        ],
      },
    );
    const gov = await fetchBranchGovernance("acme", "core", "main", "tok");
    expect(gov).toMatchObject({
      requiresPullRequest: true,
      requiredApprovals: 2,
      requiresStatusChecks: true,
      ruleCount: 2,
      readable: true,
    });
  });

  it("keeps the existing branch-read guard: a denied branch read is still null even with readable rules", async () => {
    stubReads({ status: 403, body: null }, { status: 200, body: [] });
    expect(await fetchBranchGovernance("acme", "core", "main", "tok")).toBeNull();
  });
});
