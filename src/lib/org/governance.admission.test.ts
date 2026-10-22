// FLEET PARITY WITH THE CHECK RUN. The governance tab's pass rate claims to be the CI bar, and the
// merge-blocking check folds each repo's admission layer over the org bar. So must the fleet view:
// a repo the check blocks for its tier floor cannot be counted in `passing` here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RepoAdmissionRow } from "@/lib/org/admission";

const { mockGetOrgRollup, mockGetOrgGatePolicy, mockList } = vi.hoisted(() => ({
  mockGetOrgRollup: vi.fn(),
  mockGetOrgGatePolicy: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getOrgRollup: mockGetOrgRollup, getOrgGatePolicy: mockGetOrgGatePolicy }));
vi.mock("@/lib/db/org-admission", () => ({ listOrgAdmissions: mockList }));

import { buildGovernanceOverview } from "./governance";

const admission = (repoFullName: string, over: Partial<RepoAdmissionRow>): RepoAdmissionRow => ({
  id: "",
  repoFullName,
  stanceVersion: 0,
  derivedTier: "T3",
  grantedTier: "T3",
  mode: "assisted-only",
  decidedBy: "owner",
  decidedAt: null,
  rationale: "",
  rulesetId: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const dims = [{ dimId: "D1", score: 70 }, { dimId: "D9", score: 70 }];
const repo = (name: string, latest: Record<string, unknown>) => ({
  name,
  fullName: `acme/${name}`,
  latest: { level: "L3", overall: 70, posture: "governed", dims, ...latest },
});

function fleet(...repos: ReturnType<typeof repo>[]) {
  mockGetOrgRollup.mockResolvedValue({ scannedCount: repos.length, repos });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgGatePolicy.mockResolvedValue({ minLevel: "L2" });
  mockList.mockResolvedValue([]);
});

describe("buildGovernanceOverview folds each repo's admission layer", () => {
  it("tier floor: a T2 repo below 90% AI-governed fails provenance though the org bar sets no AI bar", async () => {
    fleet(repo("a", { aiGovernedRate: 80, aiPrSample: 10 }), repo("clean", {}));
    mockList.mockResolvedValue([admission("acme/a", { derivedTier: "T2", grantedTier: "T2" })]);

    const o = (await buildGovernanceOverview("acme"))!;
    expect(o.passing).toBe(1);
    expect(o.failing).toBe(1);
    expect(o.byReason.provenance).toBe(1);
    const a = o.failures.find((f) => f.fullName === "acme/a")!;
    expect(a.reasons.some((r) => r.includes("below the required 90%"))).toBe(true);
    // A bar a repo's own admission set is a bar that was set: a zero beside it would mislead.
    expect(o.barSet.provenance).toBe(true);
    expect(o.admissionUnread).toBe(false);
  });

  it("posture: a T0 repo with an ungoverned posture fails posture under an org bar that allows it", async () => {
    fleet(repo("b", { posture: "ungoverned" }));
    mockList.mockResolvedValue([admission("acme/b", { derivedTier: "T0", grantedTier: "T0" })]);

    const o = (await buildGovernanceOverview("acme"))!;
    expect(o.passing).toBe(0);
    expect(o.byReason.posture).toBe(1);
  });

  it("the advertised org bar (policy text, gate query, CI snippet) stays the org-wide one", async () => {
    fleet(repo("a", { aiGovernedRate: 80, aiPrSample: 10 }));
    mockList.mockResolvedValue([admission("acme/a", { derivedTier: "T2", grantedTier: "T2" })]);
    const o = (await buildGovernanceOverview("acme"))!;
    expect(o.gateQuery).toBe("min_level=L2");
    expect(o.savedPolicy).toEqual({ minLevel: "L2" });
  });

  it("an unreadable admission list is LOUD: admissionUnread is true", async () => {
    fleet(repo("a", { aiGovernedRate: 80, aiPrSample: 10 }));
    mockList.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const o = (await buildGovernanceOverview("acme"))!;
    expect(o.admissionUnread).toBe(true);
  });
});
