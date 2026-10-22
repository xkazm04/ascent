// playbooks-1: the revision rollout's bounds. GET is a member read of who is behind; POST is an
// ADMIN-only fan-out (requireOrgAdmin, which refuses the public org), capped at 25, restricted to the
// playbook's own revisable set, with a zero-GitHub dry-run, and refused for an archived playbook.
// GitHub, the db and the apply pipeline are mocked: this asserts the gate, never the network.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/github/source", () => ({ parseRepoUrl: () => null }));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {
    constructor(readonly status: number, readonly path: string, readonly body: string) {
      super(`GitHub App API ${status}`);
    }
  },
  isAppConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/github/pr-route", () => ({
  repoUnderOrg: vi.fn(async () => true),
  requirePrWriteTarget: vi.fn(async (_org: string, repos: string[]) => ({
    targets: repos.map((r) => ({ fullName: r, owner: r.split("/")[0], repo: r.split("/")[1], token: "tok" })),
  })),
  classifyPrWriteError: vi.fn(() => ({ status: 409, message: "conflict" })),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getPlaybookOrgSlug: vi.fn(async () => "acme"),
  getOrgId: vi.fn(async () => "org1"),
  getPlaybook: vi.fn(),
  recordOrgAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/playbook-revision", () => ({ readPlaybookRevision: vi.fn() }));
vi.mock("@/lib/org/playbook-apply", () => ({
  applyPlaybookToRepo: vi.fn(async (i: { parsed: { fullName: string } }) => ({
    pr: { url: "https://github.com/pr/1", number: 1, branch: "b", reused: false },
    fullName: i.parsed.fullName,
  })),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => true }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => true, resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireOrgRole: vi.fn(async () => null),
  requireOrgAdmin: vi.fn(async () => null),
}));

import { GET, POST } from "./route";
import { getPlaybook, recordOrgAudit } from "@/lib/db";
import { readPlaybookRevision } from "@/lib/db/playbook-revision";
import { applyPlaybookToRepo } from "@/lib/org/playbook-apply";
import { requireOrgAdmin } from "@/lib/authz";
import { isAppConfigured } from "@/lib/github/app";
import { requirePrWriteTarget } from "@/lib/github/pr-route";

const pb = (over = {}) => ({
  id: "pb1",
  title: "CI standard",
  dimId: "D3",
  summary: "s",
  steps: ["lint"],
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  version: 3,
  updatedAt: "2026-02-01T00:00:00.000Z",
  ...over,
});

function revisionOf(n: number) {
  const behind = Array.from({ length: n }, (_, i) => ({ repo: `acme/r${i}`, appliedVersion: 1 + (i % 2) }));
  return {
    sets: { version: 3, behind, diverged: [{ repo: "acme/edited", state: "drifted" }], unversioned: [], current: [], inFlight: [] },
    targets: behind.map((b) => ({ ...b, artifactPath: `docs/playbooks/pb1-old.md`, adoptedHash: `h-${b.repo}` })),
  };
}

const ctx = { params: Promise.resolve({ id: "pb1" }) };
const post = (body: unknown) =>
  POST(new Request("http://x/api/org/playbooks/pb1/revise", { method: "POST", body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPlaybook).mockResolvedValue(pb() as never);
  vi.mocked(readPlaybookRevision).mockResolvedValue(revisionOf(3) as never);
  vi.mocked(requireOrgAdmin).mockResolvedValue(null);
  vi.mocked(isAppConfigured).mockReturnValue(true);
});

describe("GET /api/org/playbooks/:id/revise", () => {
  it("returns the version and the behind / diverged / unversioned sets to a member", async () => {
    const res = await GET(new Request("http://x"), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.version).toBe(3);
    expect(json.behind).toEqual([
      { repo: "acme/r0", appliedVersion: 1 },
      { repo: "acme/r1", appliedVersion: 2 },
      { repo: "acme/r2", appliedVersion: 1 },
    ]);
    expect(json.diverged).toEqual([{ repo: "acme/edited", state: "drifted" }]);
    expect(json.unversioned).toEqual([]);
    // Ledger digests and paths stay server-side.
    expect(JSON.stringify(json)).not.toContain("adoptedHash");
  });
});

describe("POST /api/org/playbooks/:id/revise", () => {
  it("a member is refused (403) through requireOrgAdmin and nothing is attempted", async () => {
    vi.mocked(requireOrgAdmin).mockResolvedValue(Response.json({ error: "admin" }, { status: 403 }) as never);
    const res = await post({ repos: ["acme/r0"] });
    expect(res.status).toBe(403);
    expect(vi.mocked(requireOrgAdmin)).toHaveBeenCalledWith("acme", "admin");
    expect(applyPlaybookToRepo).not.toHaveBeenCalled();
    expect(readPlaybookRevision).not.toHaveBeenCalled();
  });

  it("30 behind repos -> 25 attempted, 5 skipped, each in revision mode with its landed digest", async () => {
    vi.mocked(readPlaybookRevision).mockResolvedValue(revisionOf(30) as never);
    const res = await post({ repos: Array.from({ length: 30 }, (_, i) => `acme/r${i}`) });
    const json = await res.json();
    expect(json.attempted).toBe(25);
    expect(json.skipped).toBe(5);
    expect(applyPlaybookToRepo).toHaveBeenCalledTimes(25);
    const first = vi.mocked(applyPlaybookToRepo).mock.calls[0]![0];
    expect(first.revision).toEqual({ artifactPath: "docs/playbooks/pb1-old.md", baseDigest: "h-acme/r0" });
    expect(recordOrgAudit).toHaveBeenCalledWith(
      "playbook.revision_opened",
      "acme",
      expect.objectContaining({ playbookId: "pb1", toVersion: 3, fromVersion: 1, attempted: 25, skipped: 5 }),
      "alice",
    );
  });

  it("a repo outside the behind set is a refused row and gets no PR", async () => {
    const res = await post({ repos: ["acme/r0", "acme/edited", "acme/elsewhere"] });
    const json = await res.json();
    expect(json.attempted).toBe(1);
    const refused = json.results.filter((r: { ok: boolean }) => !r.ok).map((r: { repo: string }) => r.repo);
    expect(refused).toEqual(["acme/edited", "acme/elsewhere"]);
    expect(applyPlaybookToRepo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requirePrWriteTarget).mock.calls[0]![1]).toEqual(["acme/r0"]);
  });

  it("dryRun returns { repos, fromVersions, starter } with zero GitHub calls", async () => {
    vi.mocked(isAppConfigured).mockReturnValue(false);
    const res = await post({ repos: ["acme/r0", "acme/r1"], dryRun: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.repos).toEqual(["acme/r0", "acme/r1"]);
    expect(json.fromVersions).toEqual({ "acme/r0": 1, "acme/r1": 2 });
    expect(json.toVersion).toBe(3);
    expect(typeof json.starter).toBe("string");
    expect(requirePrWriteTarget).not.toHaveBeenCalled();
    expect(applyPlaybookToRepo).not.toHaveBeenCalled();
  });

  it("an archived playbook is refused (409)", async () => {
    vi.mocked(getPlaybook).mockResolvedValue(pb({ archived: true }) as never);
    const res = await post({ repos: ["acme/r0"] });
    expect(res.status).toBe(409);
    expect(applyPlaybookToRepo).not.toHaveBeenCalled();
  });

  it("an empty request is a 400", async () => {
    expect((await post({ repos: [] })).status).toBe(400);
  });
});
