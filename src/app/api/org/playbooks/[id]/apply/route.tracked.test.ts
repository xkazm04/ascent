// POST /api/org/playbooks/:id/apply on a repo the org TRACKS under another owner (backlog
// develop-2026-09-17 row 41). Org `kiro` loops and watches `xkazm04/kp`; the playbook PR must land
// there too, through the one customer-repo write door (requirePrWriteTarget, rule `tracked`). The
// token comes from the installation that covers the repo: on a hosted deployment the gated org's own
// (a hosted org can only watch its own namespace or its installation's listing), on a self-hosted one
// the repo owner's. A random owner is still a 400 before any installation lookup.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  applyPlaybook: vi.fn(async () => {}),
  getPlaybook: vi.fn(async () => ({ id: "pb_1", title: "Tighten CI", dimId: "d5", summary: "s", steps: ["lint"] })),
  getPlaybookOrgSlug: vi.fn(async () => "kiro"),
  getInstallationIdForOwner: vi.fn(async (owner: string) => `inst-${owner}`),
  getOrgId: vi.fn(async () => null),
  isDbConfigured: () => true,
  recordOrgAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/org-admission", () => ({
  orgTracksRepo: vi.fn(async (org: string, full: string) => org === "kiro" && full === "xkazm04/kp"),
}));
vi.mock("@/lib/github/source", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/source")>("@/lib/github/source");
  return { ...actual, fetchRepoContext: vi.fn(async (p: { owner: string; repo: string }) => ({ fullName: `${p.owner}/${p.repo}` })) };
});
vi.mock("@/lib/github/write", () => ({ openDraftPr: vi.fn(async () => ({ url: "u", number: 7, branch: "b", reused: false })) }));
vi.mock("@/lib/github/app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");
  return {
    AppApiError: actual.AppApiError,
    getInstallationToken: vi.fn(async (id: string) => `token-${id}`),
    isAppConfigured: () => true,
  };
});
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));

import { POST } from "./route";
import { getInstallationIdForOwner } from "@/lib/db";
import { openDraftPr } from "@/lib/github/write";

const mockInstall = vi.mocked(getInstallationIdForOwner);
const mockPr = vi.mocked(openDraftPr);

const apply = (repo: string) =>
  POST(
    new Request("http://localhost/api/org/playbooks/pb_1/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo }),
    }),
    { params: Promise.resolve({ id: "pb_1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
});
afterEach(() => vi.unstubAllEnvs());

describe("playbook apply on a tracked repo under another owner", () => {
  it("opens the PR in the tracked repo (200), never in the org slug's namespace", async () => {
    const res = await apply("xkazm04/kp");
    expect(res.status).toBe(200);
    expect(mockPr).toHaveBeenCalledTimes(1);
    expect(mockPr.mock.calls[0]![0]).toMatchObject({ owner: "xkazm04", repo: "kp" });
  });

  it("hosted: mints from the gated org's installation", async () => {
    await apply("xkazm04/kp");
    expect(mockInstall.mock.calls).toEqual([["kiro"]]);
    expect(mockPr.mock.calls[0]![0]).toMatchObject({ token: "token-inst-kiro" });
  });

  it("self-hosted: mints from the repo's own installation, not the org slug's", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    await apply("xkazm04/kp");
    expect(mockInstall.mock.calls).toEqual([["xkazm04"]]);
    expect(mockPr.mock.calls[0]![0]).toMatchObject({ token: "token-inst-xkazm04" });
  });

  it("still refuses a random owner with 400 and no installation lookup", async () => {
    const res = await apply("facebook/react");
    expect(res.status).toBe(400);
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockPr).not.toHaveBeenCalled();
  });

  it("guard: an org-owned repo mints from the org's installation", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    const res = await apply("kiro/site");
    expect(res.status).toBe(200);
    expect(mockInstall.mock.calls).toEqual([["kiro"]]);
  });
});
