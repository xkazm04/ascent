// The GitHub half of the catalog write-back: which endpoint each policy reaches, with which token and
// coordinate. The token and the repo come from the source the index pass already holds (minted by the
// gate for the gated org, coordinate from that org's own registry row); this file must not mint.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  pr: vi.fn(),
  readAt: vi.fn(),
  mint: vi.fn(),
}));

vi.mock("@/lib/github/app", () => ({
  githubAppFetch: h.fetch,
  getInstallationToken: h.mint,
  AppApiError: class extends Error {},
}));
vi.mock("./signals-pr", () => ({ openOrUpdateSignalsPr: h.pr }));
vi.mock("./read", () => ({ readFileAtRef: h.readAt }));

import { githubCatalogWriter } from "./catalog-write-github";
import { CATALOG_PR_BRANCH } from "./catalog-write";

beforeEach(() => {
  for (const m of Object.values(h)) m.mockReset();
});

describe("githubCatalogWriter", () => {
  const w = githubCatalogWriter("ghs_gated", "acme", "ai-registry");

  it("commits catalog.json on the branch with the prior blob sha (optimistic concurrency)", async () => {
    h.fetch.mockResolvedValueOnce({ content: { sha: "newblob" }, commit: { sha: "newcommit" } });
    const out = await w.commit({ branch: "main", content: "{}\n", priorBlobSha: "oldblob", message: "m" });
    expect(out).toEqual({ commitSha: "newcommit", blobSha: "newblob" });
    const [path, token, init] = h.fetch.mock.calls[0]! as [string, string, RequestInit];
    expect(path).toBe("/repos/acme/ai-registry/contents/catalog.json");
    expect(token).toBe("ghs_gated");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body).toMatchObject({ branch: "main", sha: "oldblob", message: "m" });
    expect(Buffer.from(body.content!, "base64").toString("utf8")).toBe("{}\n");
    expect(h.mint).not.toHaveBeenCalled();
  });

  it("creates the file (no sha) when the registry has none", async () => {
    h.fetch.mockResolvedValueOnce({});
    const out = await w.commit({ branch: "main", content: "{}\n", priorBlobSha: null, message: "m" });
    expect(out).toEqual({ commitSha: null, blobSha: null });
    const body = JSON.parse(String((h.fetch.mock.calls[0]![2] as RequestInit).body)) as Record<string, unknown>;
    expect("sha" in body).toBe(false);
  });

  it("reads the PR branch's catalog with the same token", async () => {
    h.readAt.mockResolvedValueOnce("{}");
    await expect(w.readBranch(CATALOG_PR_BRANCH)).resolves.toBe("{}");
    expect(h.readAt).toHaveBeenCalledWith("ghs_gated", "acme", "ai-registry", "catalog.json", CATALOG_PR_BRANCH);
  });

  it("proposes through the create-or-update PR helper on the stable branch", async () => {
    h.pr.mockResolvedValueOnce({ url: "u", number: 3, branch: CATALOG_PR_BRANCH, commitSha: "c", reused: true, updated: true });
    const out = await w.propose({ base: "main", branch: CATALOG_PR_BRANCH, content: "{}\n", message: "m", title: "t", body: "b" });
    expect(out).toEqual({ url: "u", number: 3, branch: CATALOG_PR_BRANCH, reused: true });
    expect(h.pr).toHaveBeenCalledWith({
      token: "ghs_gated",
      owner: "acme",
      repo: "ai-registry",
      base: "main",
      branch: CATALOG_PR_BRANCH,
      path: "catalog.json",
      content: "{}\n",
      commitMessage: "m",
      prTitle: "t",
      prBody: "b",
    });
    expect(h.mint).not.toHaveBeenCalled();
  });
});
