// Regression tests for fetchBranchGovernance (ambiguity-ui-scan-2026-07-16 github-repo-data-access #1):
// a FAILED rulesets read (403 restricted token / 404 GHES without the rules API / non-array body) must
// yield "governance unknown" (null) — never a fabricated "zero rules" object with readable:true, which
// false-negates 6 governance signals on exactly the locked-down repos most likely to restrict the token.
// A 200 with a genuinely empty array remains a real "no rules".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/github/host", () => ({
  githubApiBase: () => "https://api.github.test",
  ghFetch: vi.fn(),
  // Real implementation: the slash-preserving encoding is the thing under test below.
  encodePathSegments: (x: string) => x.split("/").map(encodeURIComponent).join("/"),
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

// A branch name may contain slashes — `release/2.1` and `feature/x` are ordinary git refs and either
// can be a repo's DEFAULT branch. Whole-string encodeURIComponent collapses that to `release%2F2.1`,
// which GitHub treats as a branch that does not exist: the protection-bearing read 404s, the guard
// above reads it as "protection unknown", and the repo silently loses ALL governance — D9's
// branch-protection check drops to n/a and the gate's requireProtectedBranch never enforces for it.
describe("fetchBranchGovernance — a slash-containing default branch", () => {
  it("preserves the slashes in the request path (does not collapse to %2F)", async () => {
    stubReads({ status: 200, body: { protected: true } }, { status: 200, body: [] });
    await fetchBranchGovernance("acme", "r", "release/2.1", "tok");

    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/branches/release/2.1"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/rules/branches/release/2.1"))).toBe(true);
    expect(urls.some((u) => u.includes("%2F"))).toBe(false);
  });

  it("still reads governance for such a repo instead of returning null", async () => {
    stubReads({ status: 200, body: { protected: true } }, { status: 200, body: [{ type: "pull_request", parameters: {} }] });
    const gov = await fetchBranchGovernance("acme", "r", "release/2.1", "tok");
    expect(gov).not.toBeNull();
    expect(gov?.protected).toBe(true);
    expect(gov?.defaultBranch).toBe("release/2.1");
  });

  it("percent-encodes characters WITHIN a segment, so only the separators survive", async () => {
    stubReads({ status: 200, body: { protected: false } }, { status: 200, body: [] });
    await fetchBranchGovernance("acme", "r", "feat/a b", "tok");
    expect(mockFetch.mock.calls.map((c) => String(c[0])).some((u) => u.endsWith("/branches/feat/a%20b"))).toBe(true);
  });
});
