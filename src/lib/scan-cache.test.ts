// Integration test for the conditional head-hint reuse (scan-and-decide idea d19f7836): the
// badge/gate surfaces resolve the head sha through resolveHeadWithHint, which must send the prior
// ETag (If-None-Match) so an unchanged repo answers a free 304 instead of burning a rate-limit
// unit per request. resolveHead is mocked; the in-memory hint store (cache.ts) is the real thing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveHead } from "@/lib/github/source";
import { resolveHeadWithHint } from "./scan-cache";

vi.mock("@/lib/github/source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/source")>()),
  resolveHead: vi.fn(),
}));

const mockResolveHead = vi.mocked(resolveHead);

describe("resolveHeadWithHint — conditional head-hint reuse (#7)", () => {
  beforeEach(() => mockResolveHead.mockReset());

  it("stores the hint on a fresh 200 and returns the head sha", async () => {
    mockResolveHead.mockResolvedValueOnce({ status: "ok", sha: "sha1", etag: "etag1" });
    const sha = await resolveHeadWithHint({ owner: "octo", repo: "hint-200" }, "tok");
    expect(sha).toBe("sha1");
    // First lookup has no prior ETag.
    expect(mockResolveHead).toHaveBeenNthCalledWith(1, { owner: "octo", repo: "hint-200" }, { token: "tok", etag: null });
  });

  it("reuses the stored ETag (If-None-Match) on the next lookup and returns the cached sha on a 304", async () => {
    mockResolveHead
      .mockResolvedValueOnce({ status: "ok", sha: "sha1", etag: "etag1" })
      .mockResolvedValueOnce({ status: "unmodified" });
    const first = await resolveHeadWithHint({ owner: "octo", repo: "hint-304" }, "tok");
    const second = await resolveHeadWithHint({ owner: "octo", repo: "hint-304" }, "tok");
    expect(first).toBe("sha1");
    expect(second).toBe("sha1"); // 304 → reuse the prior sha (the free re-validation)
    // The whole point of #7: the SECOND call sends the ETag it learned from the first.
    expect(mockResolveHead).toHaveBeenNthCalledWith(2, { owner: "octo", repo: "hint-304" }, { token: "tok", etag: "etag1" });
  });

  it("refreshes the hint when GitHub returns a new head (200 with a new sha/etag)", async () => {
    mockResolveHead
      .mockResolvedValueOnce({ status: "ok", sha: "old", etag: "e-old" })
      .mockResolvedValueOnce({ status: "ok", sha: "new", etag: "e-new" });
    await resolveHeadWithHint({ owner: "octo", repo: "hint-refresh" }, "tok"); // stores {e-old, old}
    const sha = await resolveHeadWithHint({ owner: "octo", repo: "hint-refresh" }, "tok");
    expect(sha).toBe("new");
    expect(mockResolveHead).toHaveBeenNthCalledWith(2, { owner: "octo", repo: "hint-refresh" }, { token: "tok", etag: "e-old" });
  });

  it("returns null on a failed head lookup so the caller falls back to a SHA-less key", async () => {
    mockResolveHead.mockResolvedValueOnce({ status: "error" });
    expect(await resolveHeadWithHint({ owner: "octo", repo: "hint-error" }, "tok")).toBeNull();
  });
});
