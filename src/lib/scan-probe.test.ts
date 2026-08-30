// The probe runner (moonshot #10). What must hold:
//
//   • A PROBE IS NOT A SCAN — no inference, no Scan row, no credit. Asserted structurally: the module
//     imports neither the scanner nor the credit core.
//   • A DENIED read is `unmeasurable`, never `fail` (the guard the whole ledger's honesty rests on).
//   • A 404 IS an observation — it flags `missingSince`; any OTHER failure leaves it alone, so a
//     GitHub blip can never mark a live repo as gone.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  fetchBranchGovernance: vi.fn(),
  fetchSecurityPosture: vi.fn(),
  ghFetch: vi.fn(),
  latestObservations: vi.fn(),
  recordObservations: vi.fn(),
  setRepoMissing: vi.fn(),
  resolveRepoJobRef: vi.fn(),
}));

vi.mock("@/lib/github/governance", () => ({ fetchBranchGovernance: h.fetchBranchGovernance }));
vi.mock("@/lib/github/security-posture", () => ({ fetchSecurityPosture: h.fetchSecurityPosture }));
vi.mock("@/lib/github/host", () => ({ ghFetch: h.ghFetch, githubApiBase: () => "https://api.github.com" }));
vi.mock("@/lib/db/control-observations", () => ({
  latestObservations: h.latestObservations,
  recordObservations: h.recordObservations,
}));
vi.mock("@/lib/db/org-watch", () => ({ setRepoMissing: h.setRepoMissing }));
vi.mock("@/lib/db/scan-jobs", () => ({ resolveRepoJobRef: h.resolveRepoJobRef }));

import { probeRepository } from "./scan-probe";
import { CONTROL_IDS } from "./scan-probe-controls";

const okMeta = (body: Record<string, unknown>) => ({ status: 200, ok: true, json: async () => body });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.latestObservations.mockResolvedValue([]);
  h.recordObservations.mockResolvedValue({ written: 0, transitions: 0 });
  h.resolveRepoJobRef.mockResolvedValue({ orgId: "org_1", repoId: "repo_1" });
  h.setRepoMissing.mockResolvedValue(undefined);
});

/** The samples handed to recordObservations, keyed by control id. */
function written(): Map<string, { state: string; value: string | null }> {
  const samples = h.recordObservations.mock.calls[0]![2] as { controlId: string; state: string; value: string | null }[];
  return new Map(samples.map((s) => [s.controlId, s]));
}

describe("a probe is not a scan", () => {
  it("imports neither the scanner nor the credit core — no inference and no money can happen here", () => {
    const src = readFileSync(new URL("./scan-probe.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "@\/lib\/scan"/);
    expect(src).not.toMatch(/scan-credit/);
    expect(src).not.toMatch(/persistScanReport/);
  });
});

describe("honest nulls", () => {
  it("a DENIED governance read records unmeasurable for every governance control, no fail", async () => {
    h.ghFetch.mockResolvedValue(okMeta({ private: false, archived: false, default_branch: "main" }));
    h.fetchBranchGovernance.mockResolvedValue(null); // 403 on the protection-bearing call
    h.fetchSecurityPosture.mockResolvedValue({ advisoryCount: 0, advisoryCapped: false, orgSecurityPolicy: false });

    const res = await probeRepository({ orgSlug: "acme", fullName: "acme/api", token: "t" });

    const rows = written();
    expect(rows.get(CONTROL_IDS.branchProtection)).toMatchObject({ state: "unmeasurable", value: null });
    expect(rows.get(CONTROL_IDS.requiredApprovals)!.state).toBe("unmeasurable");
    expect(res.unmeasurable).toBeGreaterThan(0);
  });

  it("with NO token the private controls are unmeasurable rather than absent", async () => {
    h.ghFetch.mockResolvedValue(okMeta({ private: false, archived: false, default_branch: "main" }));
    await probeRepository({ orgSlug: "acme", fullName: "acme/api" });
    expect(h.fetchBranchGovernance).not.toHaveBeenCalled();
    expect(written().get(CONTROL_IDS.branchProtection)!.state).toBe("unmeasurable");
  });
});

describe("repo presence", () => {
  it("a 404 records repo-present:fail AND stamps missingSince", async () => {
    h.ghFetch.mockResolvedValue({ status: 404, ok: false, json: async () => null });

    const res = await probeRepository({ orgSlug: "acme", fullName: "acme/gone", token: "t" });

    expect(written().get(CONTROL_IDS.repoPresent)).toMatchObject({ state: "fail" });
    expect(h.setRepoMissing).toHaveBeenCalledWith("repo_1", true);
    expect(res.present).toBe(false);
    // Nothing else was even attempted — a repo we cannot see has no branch to read.
    expect(h.fetchBranchGovernance).not.toHaveBeenCalled();
  });

  it("a 500 leaves missingSince untouched — unknown is not 'gone'", async () => {
    h.ghFetch.mockResolvedValue({ status: 500, ok: false, json: async () => null });

    const res = await probeRepository({ orgSlug: "acme", fullName: "acme/api", token: "t" });

    expect(res.present).toBeNull();
    expect(h.setRepoMissing).not.toHaveBeenCalled();
    expect(written().get(CONTROL_IDS.repoPresent)!.state).toBe("unmeasurable");
  });

  it("a repo that came back clears an existing missingSince stamp", async () => {
    h.ghFetch.mockResolvedValue(okMeta({ private: true, archived: false, default_branch: "main" }));
    h.fetchBranchGovernance.mockResolvedValue(null);
    h.fetchSecurityPosture.mockResolvedValue(null);
    await probeRepository({ orgSlug: "acme", fullName: "acme/api", token: "t" });
    expect(h.setRepoMissing).toHaveBeenCalledWith("repo_1", false);
    expect(written().get(CONTROL_IDS.repoVisibility)).toMatchObject({ state: "pass", value: "private" });
  });
});

describe("provenance", () => {
  it("stamps the job and the delivery so every row can be traced to what produced it", async () => {
    h.ghFetch.mockResolvedValue(okMeta({ private: false, archived: false, default_branch: "main" }));
    h.fetchBranchGovernance.mockResolvedValue(null);
    h.fetchSecurityPosture.mockResolvedValue(null);

    await probeRepository({ orgSlug: "acme", fullName: "acme/api", token: "t", jobId: "job_9", deliveryId: "d-3" });

    expect(h.recordObservations.mock.calls[0]![3]).toMatchObject({ source: "probe", jobId: "job_9", deliveryId: "d-3" });
  });
});
