// resolveScanScope — the server half of scan scoping. This is the layer that must never let a
// client's word for a ref become the scanned/keyed/persisted identity, and must never quietly
// substitute the default branch for a ref it couldn't resolve.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveRefSha } from "@/lib/github/source";
import { resolveScanScope } from "./scan-scope-server";

vi.mock("@/lib/github/source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/source")>()),
  resolveRefSha: vi.fn(),
}));

const mockResolve = vi.mocked(resolveRefSha);
const parsed = { owner: "octo", repo: "mono" };
const SHA = "c".repeat(40);

beforeEach(() => mockResolve.mockReset());

describe("no scope requested", () => {
  it("costs no GitHub call and reports itself unscoped", async () => {
    const r = await resolveScanScope(parsed, {});
    expect(r.requested).toBe(false);
    expect(r.error).toBeNull();
    expect(r.pinSha).toBeNull();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("ignores non-string inputs rather than coercing them", async () => {
    const r = await resolveScanScope(parsed, { ref: 42, subPath: { evil: true } });
    expect(r.requested).toBe(false);
  });
});

describe("ref resolution", () => {
  it("resolves the ref to its OWN commit sha — the value that keys the cache", async () => {
    mockResolve.mockResolvedValueOnce(SHA);
    const r = await resolveScanScope(parsed, { ref: "develop" }, { token: "tok" });
    expect(r.error).toBeNull();
    expect(r.pinSha).toBe(SHA);
    expect(r.scope).toEqual({ ref: "develop", refSha: SHA, subPath: undefined });
    expect(mockResolve).toHaveBeenCalledWith(parsed, "develop", { token: "tok" });
  });

  it("400s an invalid ref BEFORE spending a GitHub call", async () => {
    const r = await resolveScanScope(parsed, { ref: "../../etc/passwd" });
    expect(r.error?.code).toBe("INVALID_REF");
    expect(r.error?.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("404s an unknown ref — it NEVER falls back to the default branch", async () => {
    // Falling back would score a tree the user didn't ask for and label it with their branch name.
    mockResolve.mockResolvedValueOnce(null);
    const r = await resolveScanScope(parsed, { ref: "no-such-branch" });
    expect(r.error?.code).toBe("REF_NOT_FOUND");
    expect(r.error?.status).toBe(404);
    expect(r.pinSha).toBeNull();
  });
});

describe("sub-path resolution", () => {
  it("normalizes the sub-path and needs no GitHub call", async () => {
    const r = await resolveScanScope(parsed, { subPath: "/packages/api/" });
    expect(r.error).toBeNull();
    expect(r.requested).toBe(true);
    expect(r.scope.subPath).toBe("packages/api");
    expect(r.pinSha).toBeNull(); // the caller pins the default head it already resolves
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("400s a traversal sub-path", async () => {
    const r = await resolveScanScope(parsed, { subPath: "../../secrets" });
    expect(r.error?.code).toBe("INVALID_SUBPATH");
    expect(r.error?.status).toBe(400);
  });

  it("rejects a bad sub-path before resolving an otherwise-valid ref", async () => {
    const r = await resolveScanScope(parsed, { ref: "develop", subPath: ".." });
    expect(r.error?.code).toBe("INVALID_SUBPATH");
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("combines ref + sub-path", async () => {
    mockResolve.mockResolvedValueOnce(SHA);
    const r = await resolveScanScope(parsed, { ref: "release/2.1", subPath: "apps/web" });
    expect(r.scope).toEqual({ ref: "release/2.1", refSha: SHA, subPath: "apps/web" });
    expect(r.pinSha).toBe(SHA);
  });
});
