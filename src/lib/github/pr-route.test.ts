// requirePrWriteTarget — the one door for an in-context customer-repo write. The load-bearing
// property is that the TOKEN and the WRITE COORDINATE both come out of the org the caller was gated
// on: the installation is looked up for the gated org and nothing else, and a coordinate outside
// that org is refused before any installation lookup happens. (Before this composer the routes
// passed a bare string to requirePrWriteContext, and ai-stance/apply passed the wrong one.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new this(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  getInstallationToken: vi.fn(async (id: string) => `token-for-${id}`),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getInstallationIdForOwner: vi.fn(async (owner: string) => `inst-${owner}`),
}));
const { respondError } = vi.hoisted(() => ({
  respondError: vi.fn((status: number, message: string) => Response.json({ error: message }, { status })),
}));
vi.mock("@/lib/api/respond", () => ({ respondError }));
vi.mock("@/lib/db/org-admission", () => ({ orgTracksRepo: vi.fn(async () => false) }));

import { requirePrWriteTarget, mapPrWriteError, MINT_FAILED } from "./pr-route";
import { AppApiError } from "@/lib/github/app";
import { GitHubError } from "@/lib/github/source";
import { getInstallationToken } from "@/lib/github/app";
import { getInstallationIdForOwner } from "@/lib/db";
import { orgTracksRepo } from "@/lib/db/org-admission";

const mockInstall = vi.mocked(getInstallationIdForOwner);
const mockToken = vi.mocked(getInstallationToken);
const mockTracks = vi.mocked(orgTracksRepo);

beforeEach(() => {
  vi.clearAllMocks();
  mockInstall.mockImplementation(async (owner: string) => `inst-${owner}`);
  mockToken.mockImplementation(async (id: string | number) => `token-for-${id}`);
  mockTracks.mockResolvedValue(false);
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
});
afterEach(() => vi.unstubAllEnvs());

async function refusal(res: unknown) {
  expect(res).toBeInstanceOf(Response);
  const r = res as Response;
  return { status: r.status, error: ((await r.json()) as { error: string }).error };
}

describe("requirePrWriteTarget — 'owner-namespace'", () => {
  it("returns the gated org's token and the parsed coordinate, owner lower-cased", async () => {
    const target = await requirePrWriteTarget("acme", "Acme/App", "owner-namespace");
    expect(target).not.toBeInstanceOf(Response);
    expect(target).toMatchObject({
      org: "acme",
      owner: "acme",
      repo: "App",
      fullName: "acme/App",
      token: "token-for-inst-acme",
    });
    expect(mockInstall.mock.calls).toEqual([["acme"]]);
  });

  it("refuses a repo under another owner with 403 before ANY installation lookup", async () => {
    const res = await requirePrWriteTarget("acme", "other/app", "owner-namespace");
    expect(await refusal(res)).toEqual({ status: 403, error: "That repository doesn't belong to acme." });
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("does not consult the tracked set: owner-namespace is the stricter rule", async () => {
    mockTracks.mockResolvedValue(true);
    const res = await requirePrWriteTarget("acme", "other/app", "owner-namespace");
    expect((await refusal(res)).status).toBe(403);
    expect(mockTracks).not.toHaveBeenCalled();
  });

  it("400s a malformed coordinate without a lookup", async () => {
    const res = await requirePrWriteTarget("acme", "not-a-repo", "owner-namespace");
    expect((await refusal(res)).status).toBe(400);
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it("keeps the install-missing 403 copy, named for the gated org", async () => {
    mockInstall.mockResolvedValue(null);
    const res = await requirePrWriteTarget("Acme", "acme/app", "owner-namespace");
    expect(await refusal(res)).toEqual({
      status: 403,
      error: "Ascent isn't installed on acme. Install the GitHub App (with write access) to open PRs.",
    });
    expect(mockToken).not.toHaveBeenCalled();
  });
});

describe("requirePrWriteTarget — 'tracked'", () => {
  it("writes to the tracked repo's REAL owner and mints the token for the gated org", async () => {
    mockTracks.mockResolvedValue(true);
    const target = await requirePrWriteTarget("kiro", "xkazm04/kp", "tracked");
    expect(target).toMatchObject({ org: "kiro", owner: "xkazm04", repo: "kp", fullName: "xkazm04/kp" });
    expect(mockTracks).toHaveBeenCalledWith("kiro", "xkazm04/kp");
    expect(mockInstall.mock.calls).toEqual([["kiro"]]);
    expect(mockInstall).not.toHaveBeenCalledWith("xkazm04");
  });

  it("refuses an untracked foreign repo with 403 and no installation lookup", async () => {
    const res = await requirePrWriteTarget("kiro", "facebook/react", "tracked");
    expect(await refusal(res)).toEqual({ status: 403, error: "That repository doesn't belong to kiro." });
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it("admits the org's own namespace without a read (the repoUnderOrg fast path)", async () => {
    const target = await requirePrWriteTarget("kiro", "kiro/site", "tracked");
    expect(target).toMatchObject({ owner: "kiro", repo: "site" });
    expect(mockTracks).not.toHaveBeenCalled();
  });
});

describe("requirePrWriteTarget — a batch of coordinates", () => {
  it("mints ONE token for the gated org and returns every coordinate in order", async () => {
    const target = await requirePrWriteTarget("acme", ["acme/a", "ACME/b"], "owner-namespace");
    expect(target).not.toBeInstanceOf(Response);
    const t = target as Exclude<typeof target, Response>;
    expect(t.token).toBe("token-for-inst-acme");
    expect(t.targets.map((x) => [x.raw, x.fullName])).toEqual([
      ["acme/a", "acme/a"],
      ["ACME/b", "acme/b"],
    ]);
    expect(mockToken).toHaveBeenCalledTimes(1);
  });

  it("refuses the whole batch when any one coordinate is foreign, before any lookup", async () => {
    const res = await requirePrWriteTarget("acme", ["acme/a", "victim/b"], "owner-namespace");
    expect(await refusal(res)).toEqual({ status: 403, error: "Not repositories of acme: victim/b." });
    expect(mockInstall).not.toHaveBeenCalled();
  });
});

// Backlog develop-2026-09-17 row 41: the token for a TRACKED repo under another owner comes from the
// installation that covers that repo. Hosted: the gated org's own (a hosted org can only watch its own
// namespace or its installation's listing, so its installation IS the repo's). Self-hosted: the repo
// owner's installation, which is what the loop already writes with (org `kiro` over `xkazm04/*`).
describe("requirePrWriteTarget: whose installation mints a tracked foreign repo", () => {
  it("self-hosted: mints from the repo owner's installation", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    mockTracks.mockResolvedValue(true);
    const target = await requirePrWriteTarget("kiro", "xkazm04/kp", "tracked");
    expect(target).toMatchObject({ org: "kiro", owner: "xkazm04", token: "token-for-inst-xkazm04" });
    expect(mockInstall.mock.calls).toEqual([["xkazm04"]]);
  });

  // A managed deployment that lost its billing token INFERS self-hosted (selfHosted() fails open with a
  // warning). An authorization relaxation must not ride that inference: only the explicit flag lets the
  // door mint another account's installation token, or the ai-stance cross-tenant write reopens.
  it("inferred self-host (flag unset, no billing): a tracked foreign repo still mints for the gated org", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "");
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    mockTracks.mockResolvedValue(true);
    const target = await requirePrWriteTarget("kiro", "xkazm04/kp", "tracked");
    expect(target).toMatchObject({ org: "kiro", owner: "xkazm04", token: "token-for-inst-kiro" });
    expect(mockInstall.mock.calls).toEqual([["kiro"]]);
  });

  it("guard: self-hosted owner-namespace and own-namespace coordinates still mint for the gated org", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    await requirePrWriteTarget("kiro", "kiro/site", "tracked");
    await requirePrWriteTarget("acme", "acme/app", "owner-namespace");
    expect(mockInstall.mock.calls).toEqual([["kiro"], ["acme"]]);
  });

  it("self-hosted batch: each target carries its installation's token, one mint per installation", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    mockTracks.mockImplementation(async (_org, full) => full.startsWith("xkazm04/"));
    const target = await requirePrWriteTarget("kiro", ["kiro/site", "xkazm04/kp", "xkazm04/systedo"], "tracked");
    const t = target as Exclude<typeof target, Response>;
    expect(t.targets.map((x) => [x.fullName, x.token])).toEqual([
      ["kiro/site", "token-for-inst-kiro"],
      ["xkazm04/kp", "token-for-inst-xkazm04"],
      ["xkazm04/systedo", "token-for-inst-xkazm04"],
    ]);
    expect(mockToken).toHaveBeenCalledTimes(2);
  });

  it("self-hosted batch: a tracked owner with no installation refuses the batch with its name", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    mockTracks.mockResolvedValue(true);
    mockInstall.mockImplementation(async (owner: string) => (owner === "kiro" ? "inst-kiro" : null));
    const res = await requirePrWriteTarget("kiro", ["kiro/site", "xkazm04/kp"], "tracked");
    expect(await refusal(res)).toEqual({
      status: 403,
      error: "Ascent isn't installed on xkazm04. Install the GitHub App (with write access) to open PRs.",
    });
  });
});

describe("mapPrWriteError", () => {
  it("answers an unclassified error with the route's generic 500, unchanged on the wire, and reports its cause", async () => {
    const boom = new Error("db down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = mapPrWriteError(boom, { tag: "t", genericError: "Failed to do it." });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to do it." });
    expect(respondError).toHaveBeenCalledWith(500, "Failed to do it.", { cause: boom });
  });

  it("does not report a classified error", async () => {
    const a = mapPrWriteError(new AppApiError("no"), { tag: "t", genericError: "x" });
    const g = mapPrWriteError(new GitHubError("UPSTREAM", "nope", 422), { tag: "t", genericError: "x" });
    expect(a.status).toBe(502);
    expect(g.status).toBe(422);
    expect(respondError).not.toHaveBeenCalled();
  });

  it("exports the shared mint copy", () => {
    expect(MINT_FAILED).toBe("Failed to mint an installation token for this org.");
  });
});
