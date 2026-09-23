// POST /api/org/admission/ruleset — the dry run the header promised.
//
// The header says "A DRY RUN FIRST — GET the observed rulesets and return them beside the proposal".
// Until `dryRun: true`, the typed confirm ran before anything was read and `observed` was read in the
// same call that applied, so an owner saw the rulesets already on the repo only after adding one.

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
  getRepoAdmission: vi.fn(async () => ({ derivedTier: "T1", grantedTier: "T1", mode: "assisted-only", rulesetId: null })),
  setAdmissionRulesetId: vi.fn(async () => true),
  orgTracksRepo: vi.fn(async () => true),
}));
vi.mock("@/lib/org/admission", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/org/admission")>();
  return {
    ...real,
    compileStance: vi.fn((_s: unknown, _a: unknown, facts: { fullName: string }) => ({
      ruleset: real.renderRulesetProposal(facts.fullName, "T1", "assisted-only"),
      tier: "T1",
      mode: "assisted-only",
    })),
  };
});
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: vi.fn() }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "priya") }));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  getInstallationToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/github/admission-write", () => ({
  listRulesets: vi.fn(async () => [{ id: 1, name: "legacy-main", enforcement: "active" }]),
  applyRuleset: vi.fn(async () => "rs-9"),
  revertRuleset: vi.fn(async () => undefined),
}));

import { POST } from "./route";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { applyRuleset, listRulesets } from "@/lib/github/admission-write";
import { setAdmissionRulesetId } from "@/lib/db/org-admission";
import { recordOrgAudit } from "@/lib/db";

async function post(body: Record<string, unknown>) {
  vi.mocked(requireOrgOwnerPost).mockResolvedValue({ org: "xkazm04", body } as never);
  const res = await POST(new Request("http://localhost/api/org/admission/ruleset", { method: "POST" }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => vi.clearAllMocks());

describe("ruleset: a real dry run", () => {
  it("dryRun:true with no typed confirm returns the proposal and the observed rulesets, writing nothing", async () => {
    const res = await post({ repo: "xkazm04/kp", dryRun: true });

    expect(res.status).toBe(200);
    expect((res.json.proposal as { name: string }).name).toBe("ascent:ai-oversight (xkazm04/kp)");
    expect(res.json.observed).toEqual([{ id: 1, name: "legacy-main", enforcement: "active" }]);
    expect(listRulesets).toHaveBeenCalledWith("tok", "xkazm04", "kp");
    expect(applyRuleset).not.toHaveBeenCalled();
    expect(setAdmissionRulesetId).not.toHaveBeenCalled();
    // Reuses the existing action with dryRun meta, like propose's dry runs: "who looked" is a record.
    expect(vi.mocked(recordOrgAudit).mock.calls[0]![2]).toMatchObject({ dryRun: true });
  });

  it("guard: without dryRun, a wrong typed confirm is still a 400 carrying confirmWith, before any read", async () => {
    const res = await post({ repo: "xkazm04/kp", confirm: "xkazm04/KP" });

    expect(res.status).toBe(400);
    expect(res.json.confirmWith).toBe("xkazm04/kp");
    expect(listRulesets).not.toHaveBeenCalled();
    expect(applyRuleset).not.toHaveBeenCalled();
  });

  it("guard: dryRun must be the boolean true — a truthy string does not skip the typed confirm", async () => {
    const res = await post({ repo: "xkazm04/kp", dryRun: "yes" });
    expect(res.status).toBe(400);
    expect(listRulesets).not.toHaveBeenCalled();
  });

  it("the confirmed apply still applies and records the id", async () => {
    const res = await post({ repo: "xkazm04/kp", confirm: "xkazm04/kp" });
    expect(res.status).toBe(200);
    expect(applyRuleset).toHaveBeenCalledTimes(1);
    expect(setAdmissionRulesetId).toHaveBeenCalledWith("xkazm04", "xkazm04/kp", "rs-9");
  });
});
