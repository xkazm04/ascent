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
    name: ref.repo,
    description: null,
    primaryLanguage: "TypeScript",
    defaultBranch: "main",
  })),
}));

vi.mock("@/lib/practices/artifact", () => ({
  buildPracticeArtifact: vi.fn(async () => ({
    artifact: { path: "AGENTS.md", body: "# starter" },
    house: null,
  })),
}));

vi.mock("@/lib/db/org-practice-shapes", () => ({
  getOrgPracticeShapes: vi.fn(async () => null),
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
import { buildPracticeArtifact } from "@/lib/practices/artifact";
import { getOrgPracticeShapes } from "@/lib/db/org-practice-shapes";
import { artifactFingerprint } from "@/lib/practices/fingerprint";
import type { ShapeSource } from "@/lib/org/practice-mining";

const mockFetchCtx = vi.mocked(fetchRepoContext);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockMintToken = vi.mocked(getInstallationToken);
const mockAppConfigured = vi.mocked(isAppConfigured);
const mockCanMint = vi.mocked(canMintInstallationToken);
const mockBuild = vi.mocked(buildPracticeArtifact);
const mockShapes = vi.mocked(getOrgPracticeShapes);

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
  mockShapes.mockResolvedValue(null);
  mockBuild.mockResolvedValue({
    artifact: { path: "AGENTS.md", body: "# starter" },
    house: null,
  });
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

describe("POST /api/practices/generate — preview shape", () => {
  it("returns generic shape and does not resolve a house pattern without standing", async () => {
    const res = await run({ repo: "acme/repo", practiceId: "agent-guidance" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: { body: "# starter" },
      shape: { kind: "generic" },
    });
    expect(mockBuild.mock.calls.at(-1)?.[2]).toEqual({});
  });

  it("names a mined pattern as house with the exemplar count when the caller has standing", async () => {
    mockCanMint.mockResolvedValue(true);
    const houseBody = "# house starter\n- Commands";
    mockBuild.mockResolvedValue({
      artifact: { path: "AGENTS.md", body: houseBody },
      house: { lines: ["Commands"], exemplars: ["acme/api", "acme/core", "acme/web"] },
    });

    const res = await run({ repo: "Acme/repo", practiceId: "agent-guidance" });
    expect(await res.json()).toMatchObject({
      artifact: { body: houseBody },
      shape: { kind: "house", exemplars: 3 },
    });
    expect(mockBuild.mock.calls.at(-1)?.[2]).toEqual({ orgSlug: "acme" });
  });
});

/** Two D1 exemplars that agree on headings, plus a gap repo — `minedStarter` is offerable. */
function houseFixture(): ShapeSource[] {
  const entry = {
    practiceId: "agent-guidance",
    path: "AGENTS.md",
    outline: ["## Commands", "## Architecture map"],
    layout: [] as string[],
  };
  const shape = { version: "2" as const, entries: [entry] };
  return [
    { repoFullName: "acme/api", shape, dims: { D1: 90 } },
    { repoFullName: "acme/core", shape, dims: { D1: 88 } },
    { repoFullName: "acme/gap", shape, dims: { D1: 10 } },
  ];
}

async function useRealBuild() {
  const actual = await vi.importActual<typeof import("@/lib/practices/artifact")>("@/lib/practices/artifact");
  mockBuild.mockImplementation(actual.buildPracticeArtifact);
  return actual.buildPracticeArtifact;
}

describe("POST /api/practices/generate — preview body equals apply artifact", () => {
  it("matches apply's house body and fingerprint when the caller has standing", async () => {
    const build = await useRealBuild();
    mockCanMint.mockResolvedValue(true);
    mockShapes.mockResolvedValue(houseFixture());

    const res = await run({ repo: "acme/repo", practiceId: "agent-guidance" });
    expect(res.status).toBe(200);
    const json = await res.json();
    const ctx = mockBuild.mock.calls.at(-1)![1];
    const apply = await build("agent-guidance", ctx, { orgSlug: "acme" });

    expect(json.shape).toEqual({ kind: "house", exemplars: 2 });
    expect(json.artifact.body).toBe(apply.artifact!.body);
    expect(json.artifact.body).toContain("Your organization's shared pattern");
    expect(json.artifact.body).toContain("Commands");
    expect(artifactFingerprint(json.artifact.body)).toBe(artifactFingerprint(apply.artifact!.body));
  });

  it("matches apply's generic body and fingerprint when nothing is mined", async () => {
    const build = await useRealBuild();
    mockCanMint.mockResolvedValue(true);
    mockShapes.mockResolvedValue(null);

    const res = await run({ repo: "acme/repo", practiceId: "agent-guidance" });
    const json = await res.json();
    const ctx = mockBuild.mock.calls.at(-1)![1];
    const apply = await build("agent-guidance", ctx, { orgSlug: "acme" });

    expect(json.shape).toEqual({ kind: "generic" });
    expect(json.artifact.body).toBe(apply.artifact!.body);
    expect(json.artifact.body).not.toContain("Your organization's shared pattern");
    expect(artifactFingerprint(json.artifact.body)).toBe(artifactFingerprint(apply.artifact!.body));
  });

  it("does not bake mined lines into a preview without standing", async () => {
    const build = await useRealBuild();
    mockCanMint.mockResolvedValue(false);
    mockShapes.mockResolvedValue(houseFixture());

    const res = await run({ repo: "acme/repo", practiceId: "agent-guidance" });
    const json = await res.json();
    const ctx = mockBuild.mock.calls.at(-1)![1];
    const generic = await build("agent-guidance", ctx, {});
    const house = await build("agent-guidance", ctx, { orgSlug: "acme" });

    expect(json.shape).toEqual({ kind: "generic" });
    expect(json.artifact.body).toBe(generic.artifact!.body);
    expect(json.artifact.body).not.toBe(house.artifact!.body);
    expect(mockBuild.mock.calls[0]?.[2]).toEqual({});
  });
});
