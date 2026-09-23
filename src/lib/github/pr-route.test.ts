// requirePrWriteTarget — the one door for an in-context customer-repo write. The load-bearing
// property is that the TOKEN and the WRITE COORDINATE both come out of the org the caller was gated
// on: the installation is looked up for the gated org and nothing else, and a coordinate outside
// that org is refused before any installation lookup happens. (Before this composer the routes
// passed a bare string to requirePrWriteContext, and ai-stance/apply passed the wrong one.)

import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("@/lib/db/org-admission", () => ({ orgTracksRepo: vi.fn(async () => false) }));

import { requirePrWriteTarget } from "./pr-route";
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
});

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
