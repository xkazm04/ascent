// The hosted watch scope (backlog develop-2026-09-17 row 39): own namespace or the org's installation
// listing on a hosted deployment; free-form on a self-hosted one; handle shape checked in both.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/db/installations", () => ({ getInstallationIdForOwner: vi.fn(async () => "inst-acme") }));
vi.mock("@/lib/github/app", () => ({
  listInstallationReposResult: vi.fn(async () => ({
    repos: [{ fullName: "Acme-Labs/Widgets", owner: "Acme-Labs", name: "Widgets" }],
    truncated: false,
  })),
}));

import { parseWatchHandle, watchScopeFor } from "./watch-scope";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import { listInstallationReposResult } from "@/lib/github/app";

const mockInstall = vi.mocked(getInstallationIdForOwner);
const mockListing = vi.mocked(listInstallationReposResult);

const h = (fullName: string) => {
  const [owner, name] = fullName.split("/");
  return { owner: owner!, name: name!, fullName };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
});
afterEach(() => vi.unstubAllEnvs());

describe("parseWatchHandle", () => {
  it("accepts a GitHub-shaped handle whose fullName is owner/name", () => {
    expect(parseWatchHandle({ owner: "acme", name: "web.app", fullName: "acme/web.app" })).toEqual({
      owner: "acme",
      name: "web.app",
      fullName: "acme/web.app",
    });
  });

  it("rejects a bad login, a traversal name, and a fullName that disagrees with owner/name", () => {
    expect(parseWatchHandle({ owner: "../x", name: "web", fullName: "../x/web" })).toBeNull();
    expect(parseWatchHandle({ owner: "acme", name: "..", fullName: "acme/.." })).toBeNull();
    expect(parseWatchHandle({ owner: "acme", name: "web", fullName: "victim/web" })).toBeNull();
    expect(parseWatchHandle({ owner: "acme", name: 3, fullName: "acme/3" })).toBeNull();
  });
});

describe("watchScopeFor: hosted", () => {
  it("admits the org's own namespace without reading the installation listing", async () => {
    const inScope = watchScopeFor("Acme");
    expect(await inScope(h("ACME/web"))).toBe(true);
    expect(mockListing).not.toHaveBeenCalled();
  });

  it("admits a repo on the org's installation listing, case-insensitively", async () => {
    const inScope = watchScopeFor("acme");
    expect(await inScope(h("acme-labs/widgets"))).toBe(true);
    expect(mockInstall).toHaveBeenCalledWith("acme");
  });

  it("refuses a foreign repo, and reads the listing once per scope", async () => {
    const inScope = watchScopeFor("acme");
    expect(await inScope(h("octocat/Hello-World"))).toBe(false);
    expect(await inScope(h("facebook/react"))).toBe(false);
    expect(mockListing).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the org has no installation or the listing throws", async () => {
    mockInstall.mockResolvedValueOnce(null);
    expect(await watchScopeFor("acme")(h("acme-labs/widgets"))).toBe(false);
    mockListing.mockRejectedValueOnce(new Error("rate limited"));
    expect(await watchScopeFor("acme")(h("acme-labs/widgets"))).toBe(false);
  });
});

describe("watchScopeFor: self-hosted", () => {
  it("admits a foreign repo with no installation read", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    expect(await watchScopeFor("kiro")(h("xkazm04/kp"))).toBe(true);
    expect(mockInstall).not.toHaveBeenCalled();
  });
});
