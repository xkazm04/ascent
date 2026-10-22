// The forge a row persists under is the ADAPTER's fact, not a guess from its url (card github-data-1).
//
// Before: persistScanReport and setRepoWatch called `forgeFromWebUrl(url)`, which parses with no host,
// so a self-managed GitLab web url (`https://git.acme.io/group/proj`) inferred `github` - and the row
// was written as fullName `group/proj`, where it could land on an unrelated GitHub repo's row in the
// same org. The GitLab source now stamps `meta.forge`, and `persistedForgeOf` reads it. Local working
// copies keep their GitHub identity (private-scan-scrub relies on that).

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ScanReport } from "@/lib/types";

const { mockGetPrisma, repoUpserts } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  repoUpserts: [] as Array<{ where?: unknown; create?: Record<string, unknown> }>,
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: mockGetPrisma,
  withDb: (op: (c: unknown) => unknown) => op(undefined),
  withRetry: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalOrgSlug: (slug: string) => slug.trim().toLowerCase(),
  canonicalRepoFullName: (owner: string, name: string) => `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`,
  ensureOrgId: vi.fn(async () => "org_1"),
  withRepoLock: <T,>(_key: string, fn: () => Promise<T>) => fn(),
  upsertRacing: async <T,>(upsert: () => Promise<T>) => upsert(),
  isUniqueConstraintError: () => false,
}));
vi.mock("@/lib/db/org-shared", () => ({
  segmentScope: () => ({}),
  getOrgBySlug: vi.fn(async () => ({ id: "org_1" })),
  normalizeOrgSlug: (s: string) => s.trim().toLowerCase(),
}));
vi.mock("@/lib/cache", () => ({ cacheDelete: vi.fn(), makeCacheKey: vi.fn(() => "k") }));

import { persistedForgeOf } from "./registry";
import { persistScanReport } from "@/lib/db/scans-persist";
import { setRepoWatch } from "@/lib/db/org-watch";

/** The persist body is cut off right after the repo upsert: only the identity it writes is under test. */
const STOP = new Error("stop after repo upsert");

beforeEach(() => {
  repoUpserts.length = 0;
  mockGetPrisma.mockReset();
  mockGetPrisma.mockReturnValue({
    organization: { upsert: vi.fn(async () => ({ id: "org_1" })) },
    repository: {
      upsert: vi.fn(async (args: { where?: unknown; create?: Record<string, unknown> }) => {
        repoUpserts.push(args);
        if (!("watched" in (args.create ?? {}))) throw STOP;
        return { id: "repo_1" };
      }),
    },
  });
});

function gitlabReport(): ScanReport {
  return {
    repo: { owner: "group", name: "proj", url: "https://git.acme.io/group/proj", forge: "gitlab", stars: 0, forks: 0, defaultBranch: "main", headSha: "sha1", isPrivate: false },
    scannedAt: "2026-10-22T00:00:00Z",
    dimensions: [],
  } as unknown as ScanReport;
}

describe("persistedForgeOf", () => {
  it("a GitLab meta on a self-managed url persists as gitlab", () => {
    expect(persistedForgeOf({ forge: "gitlab", url: "https://git.acme.io/group/proj" })).toBe("gitlab");
  });

  it("guard: a local working copy keeps its GitHub identity", () => {
    expect(persistedForgeOf({ forge: "local", url: "https://github.com/o/r" })).toBe("github");
  });

  it("guard: no forge on the meta still infers from the url", () => {
    expect(persistedForgeOf({ url: "https://gitlab.com/group/proj" })).toBe("gitlab");
    expect(persistedForgeOf({ url: "https://github.com/o/r" })).toBe("github");
  });
});

describe("the persist and watch writers record the adapter's forge", () => {
  it("persistScanReport writes fullName gitlab:group/proj and forge gitlab for a self-managed row", async () => {
    await expect(persistScanReport(gitlabReport(), { orgSlug: "acme" })).rejects.toBe(STOP);
    expect(repoUpserts).toHaveLength(1);
    expect(repoUpserts[0]!.where).toEqual({ orgId_fullName: { orgId: "org_1", fullName: "gitlab:group/proj" } });
    expect(repoUpserts[0]!.create).toMatchObject({ forge: "gitlab", fullName: "gitlab:group/proj" });
  });

  it("setRepoWatch creates a self-managed GitLab row with forge gitlab", async () => {
    await setRepoWatch(
      "acme",
      { owner: "group", name: "proj", fullName: "gitlab:group/proj", url: "https://git.acme.io/group/proj", forge: "gitlab" },
      true,
    );
    expect(repoUpserts[0]!.create).toMatchObject({ forge: "gitlab", fullName: "gitlab:group/proj" });
  });
});
