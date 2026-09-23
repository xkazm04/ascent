// The admission WRITERS (CODEOWNERS proposal, branch ruleset apply + revert) must write to the repo
// that was ADMITTED, not to `<org>/<name>`. Since UAT PRIYA-L2-C5 an org admits a repo it tracks
// under another owner namespace (org `kiro` over `xkazm04/kp`). Before the pr-route composer these
// routes accepted that repo and then passed `org` as the GitHub owner, so every write went to
// `kiro/kp`, a repository that does not exist. The token is still the gated org's.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new this(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  recordOrgAudit: vi.fn(async () => true),
  getInstallationIdForOwner: vi.fn(async (owner: string) => `inst-${owner}`),
}));
vi.mock("@/lib/db/org-stance", () => ({ getActiveOrgStance: vi.fn(async () => ({ version: 4, stance: {} })) }));
vi.mock("@/lib/db/org-admission", () => ({
  getRepoAdmission: vi.fn(),
  setAdmissionRulesetId: vi.fn(async () => true),
  orgTracksRepo: vi.fn(async () => true),
  upsertRepoAdmission: vi.fn(),
  deleteRepoAdmission: vi.fn(),
  listOrgAdmissions: vi.fn(async () => []),
  MAX_RATIONALE: 500,
}));
vi.mock("@/lib/org/admission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/admission")>()),
  compileStance: vi.fn(() => ({
    codeownersBlock: "/billing/ @kiro/platform",
    ruleset: { name: "ascent", rules: [] },
    tier: "T1",
    mode: "assisted-only",
  })),
}));
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: vi.fn() }));
vi.mock("@/lib/github/admission-write", () => ({
  proposeManagedBlock: vi.fn(async () => ({ diff: "+x", willCreate: false, willModify: true, pr: null })),
  listRulesets: vi.fn(async () => []),
  applyRuleset: vi.fn(async () => "rs-9"),
  revertRuleset: vi.fn(async () => undefined),
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  getInstallationToken: vi.fn(async (id: string) => `token-for-${id}`),
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "priya") }));

import { POST as propose } from "./propose/route";
import { POST as applyRs, DELETE as revertRs } from "./ruleset/route";
import { POST as decide, DELETE as withdraw } from "./route";
import { getInstallationIdForOwner } from "@/lib/db";
import { getRepoAdmission, orgTracksRepo, upsertRepoAdmission, deleteRepoAdmission } from "@/lib/db/org-admission";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { applyRuleset, listRulesets, proposeManagedBlock, revertRuleset } from "@/lib/github/admission-write";

const ROW = {
  id: "a1",
  repoFullName: "xkazm04/kp",
  stanceVersion: 4,
  derivedTier: "T1" as const,
  grantedTier: "T1" as const,
  mode: "assisted-only" as const,
  decidedBy: "priya",
  decidedAt: "2026-09-01T00:00:00.000Z",
  rationale: "",
  rulesetId: null as string | null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const req = (method: string) => new Request("http://localhost/api/org/admission", { method });
function asKiro(body: Record<string, unknown>) {
  vi.mocked(requireOrgOwnerPost).mockResolvedValue({ org: "kiro", body } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orgTracksRepo).mockResolvedValue(true);
  vi.mocked(getRepoAdmission).mockResolvedValue({ ...ROW } as never);
  vi.mocked(upsertRepoAdmission).mockResolvedValue(ROW as never);
  vi.mocked(deleteRepoAdmission).mockResolvedValue(ROW as never);
});

describe("admission writers target the admitted repo's real owner", () => {
  it("propose: CODEOWNERS is read and written in xkazm04/kp, with kiro's token", async () => {
    asKiro({ repo: "xkazm04/kp", owners: ["@kiro/platform"], confirm: true });
    const res = await propose(req("POST"));
    expect(res.status).toBe(200);
    const input = vi.mocked(proposeManagedBlock).mock.calls[0]![0];
    expect({ owner: input.owner, repo: input.repo, token: input.token }).toEqual({
      owner: "xkazm04",
      repo: "kp",
      token: "token-for-inst-kiro",
    });
    expect(vi.mocked(getInstallationIdForOwner).mock.calls).toEqual([["kiro"]]);
  });

  it("ruleset POST: observe + apply against xkazm04/kp", async () => {
    asKiro({ repo: "xkazm04/kp", confirm: "xkazm04/kp" });
    const res = await applyRs(req("POST"));
    expect(res.status).toBe(200);
    expect(vi.mocked(listRulesets).mock.calls[0]!.slice(1)).toEqual(["xkazm04", "kp"]);
    expect(vi.mocked(applyRuleset).mock.calls[0]!.slice(1, 3)).toEqual(["xkazm04", "kp"]);
  });

  it("ruleset DELETE: revert against xkazm04/kp", async () => {
    vi.mocked(getRepoAdmission).mockResolvedValue({ ...ROW, rulesetId: "rs-9" } as never);
    asKiro({ repo: "xkazm04/kp", confirm: "xkazm04/kp" });
    const res = await revertRs(req("DELETE"));
    expect(res.status).toBe(200);
    expect(vi.mocked(revertRuleset).mock.calls[0]!.slice(1)).toEqual(["xkazm04", "kp", "rs-9"]);
  });

  it("guard: an untracked foreign repo is still refused before any write", async () => {
    vi.mocked(orgTracksRepo).mockResolvedValue(false);
    asKiro({ repo: "facebook/react", owners: ["@kiro/platform"], confirm: true });
    const res = await propose(req("POST"));
    expect(res.status).toBe(400);
    expect(proposeManagedBlock).not.toHaveBeenCalled();
    expect(getInstallationIdForOwner).not.toHaveBeenCalled();
  });
});

describe("guard: the decision routes still admit a tracked foreign-owner repo (PRIYA-L2-C5)", () => {
  it("POST records a decision for xkazm04/kp under kiro", async () => {
    asKiro({ repo: "xkazm04/kp", grantedTier: "T1", mode: "assisted-only" });
    const res = await decide(req("POST"));
    expect(res.status).toBe(200);
    expect(vi.mocked(upsertRepoAdmission).mock.calls[0]!.slice(0, 2)).toEqual(["kiro", "xkazm04/kp"]);
  });

  it("DELETE withdraws the decision for xkazm04/kp under kiro", async () => {
    asKiro({ repo: "xkazm04/kp" });
    const res = await withdraw(req("DELETE"));
    expect(res.status).toBe(200);
    expect(deleteRepoAdmission).toHaveBeenCalledWith("kiro", "xkazm04/kp");
  });
});
