// Pins the practice-preview token ladder (practices-governance-adoption #2). /api/practices/generate
// has no auth gate by design (public repos need no auth), so the ONLY thing standing between an
// anonymous caller and the operator PAT's broad read access is which token the route hands to
// fetchRepoContext. The load-bearing invariant: the ambient GITHUB_TOKEN is used ONLY for a caller
// with real standing in the owner org (canMintInstallationToken) — never keyed on whether the owner
// happens to have an App installation. The old guard dropped the PAT only for INSTALLED owners, so an
// anonymous caller could probe private repo metadata of any NON-installed owner the PAT could read.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

vi.mock("@/lib/github/source", () => ({
  GitHubError: class GitHubError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      readonly status?: number,
    ) {
      super(message);
      this.name = "GitHubError";
    }
  },
  parseRepoUrl: (input: string) => {
    const parts = String(input || "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner!) || !/^[A-Za-z0-9_.-]+$/.test(repo!)) return null;
    return { owner, repo };
  },
  fetchRepoContext: vi.fn(async (ref: { owner: string; repo: string }) => ({
    fullName: `${ref.owner}/${ref.repo}`,
    primaryLanguage: "TypeScript",
  })),
}));

vi.mock("@/lib/practice-artifact", () => ({
  buildArtifact: vi.fn(() => ({ path: "AGENTS.md", body: "# starter" })),
}));

vi.mock("@/lib/db", () => ({ getInstallationIdForOwner: vi.fn(async () => null) }));

vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(async () => "installation-token"),
  isAppConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/authz", () => ({ canMintInstallationToken: vi.fn(async () => false) }));

import { POST } from "./route";
import { fetchRepoContext } from "@/lib/github/source";
import { getInstallationIdForOwner } from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { canMintInstallationToken } from "@/lib/authz";

const mockFetchCtx = vi.mocked(fetchRepoContext);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockMintToken = vi.mocked(getInstallationToken);
const mockAppConfigured = vi.mocked(isAppConfigured);
const mockCanMint = vi.mocked(canMintInstallationToken);

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/practices/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** The token fetchRepoContext actually received on the last call. */
const tokenPassed = () => mockFetchCtx.mock.calls.at(-1)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GITHUB_TOKEN", "operator-pat");
  mockAppConfigured.mockReturnValue(true);
  mockCanMint.mockResolvedValue(false);
  mockInstallId.mockResolvedValue(null);
  mockMintToken.mockResolvedValue("installation-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/practices/generate — ambient-PAT gate keys on caller standing", () => {
  it("NEVER hands the operator PAT to an anonymous caller, even for a NON-installed owner", async () => {
    // The closed hole: owner has no App installation, caller has no standing. The old guard only
    // dropped the PAT for installed owners, so this request went out with the operator PAT and
    // confirmed/read private repo metadata. It must now be token-less (private repos 404 cleanly).
    mockCanMint.mockResolvedValue(false);
    mockInstallId.mockResolvedValue(null);

    const res = await run({ repo: "victim/private-repo", practiceId: "agents-md" });

    expect(res.status).toBe(200); // public-repo preview still works token-less
    expect(tokenPassed()).toBeUndefined();
    expect(mockMintToken).not.toHaveBeenCalled();
  });

  it("refuses the PAT for an anonymous caller against an INSTALLED owner (prior guard preserved)", async () => {
    mockCanMint.mockResolvedValue(false);
    mockInstallId.mockResolvedValue("inst-1");

    await run({ repo: "installed-org/repo", practiceId: "agents-md" });

    expect(tokenPassed()).toBeUndefined();
    expect(mockMintToken).not.toHaveBeenCalled(); // no standing ⇒ no mint either
  });

  it("uses the minted installation token for a caller WITH standing in an installed owner", async () => {
    mockCanMint.mockResolvedValue(true);
    mockInstallId.mockResolvedValue("inst-1");

    await run({ repo: "acme/repo", practiceId: "agents-md" });

    expect(mockCanMint).toHaveBeenCalledWith("acme");
    expect(tokenPassed()).toBe("installation-token");
  });

  it("falls back to the ambient PAT ONLY for a caller with standing whose owner has no installation", async () => {
    mockCanMint.mockResolvedValue(true);
    mockInstallId.mockResolvedValue(null);

    await run({ repo: "acme/repo", practiceId: "agents-md" });

    expect(tokenPassed()).toBe("operator-pat");
  });
});
