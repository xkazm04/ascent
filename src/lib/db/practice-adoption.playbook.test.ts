// Row 40 (backlog develop-2026-09-17): a playbook's adoption mark is stamped when the VERIFIED RESCAN
// finds the playbook file on the default branch, not when its draft PR opens. The detector is the
// existing #33 adoption ledger (`reconcilePracticeAdoption`), whose `playbook:<uuid>` rows are admitted
// on the file's presence; this pins the write-through from that ledger transition to the
// `PlaybookApplication` mark the adoption counts read.

import { beforeEach, describe, expect, it, vi } from "vitest";

const practiceAdoption = { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
const improvementPr = { findMany: vi.fn() };
const playbook = { findFirst: vi.fn() };
const playbookApplication = { upsert: vi.fn() };

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({ practiceAdoption, improvementPr, playbook, playbookApplication }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async () => ({ id: "org1", slug: "acme" }) }));

import { reconcilePracticeAdoption } from "./practice-adoption";
import type { RepoPracticeShape } from "@/lib/analyze/practice-shape";

const PATH = "docs/playbooks/pb1-our-ci.md";

function shape(present: boolean): RepoPracticeShape {
  return {
    version: "2",
    entries: [],
    artifacts: present ? [{ path: PATH, bodyHash: "sha256-n1:landed", outlineHash: "sha256-n1:outline" }] : [],
    truncated: false,
  };
}

function ledgerRow(over: Partial<{ state: string; practiceId: string; adoptedHash: string | null }> = {}) {
  return {
    id: "row1",
    artifactPath: PATH,
    state: "proposed",
    adoptedHash: null,
    adoptedOutline: null,
    practiceId: "playbook:pb1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  improvementPr.findMany.mockResolvedValue([]);
  playbook.findFirst.mockResolvedValue({ version: 3 });
  playbookApplication.upsert.mockResolvedValue({});
});

describe("reconcilePracticeAdoption: a landed playbook PR stamps the adoption mark", () => {
  it("stamps the PlaybookApplication once the rescan finds the proposed playbook file", async () => {
    practiceAdoption.findMany.mockResolvedValue([ledgerRow()]);
    await reconcilePracticeAdoption("org1", "acme/api", "sha1", shape(true));

    expect(playbookApplication.upsert).toHaveBeenCalledTimes(1);
    const arg = playbookApplication.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ playbookId_repoFullName: { playbookId: "pb1", repoFullName: "acme/api" } });
    // Machine-stamped from the rescan, at the playbook's current version, scoped to the ledger's org.
    expect(arg.create).toMatchObject({ playbookId: "pb1", orgId: "org1", repoFullName: "acme/api", appliedBy: "scan", appliedVersion: 3 });
    // An existing mark (a human's, or a pre-row-40 PR-open stamp) is confirmed, never rewritten.
    expect(arg.update).toEqual({});
    expect(playbook.findFirst.mock.calls[0]![0].where).toEqual({ id: "pb1", orgId: "org1" });
  });

  it("guard: a proposed playbook row whose file is not on the default branch stamps nothing", async () => {
    practiceAdoption.findMany.mockResolvedValue([ledgerRow()]);
    await reconcilePracticeAdoption("org1", "acme/api", "sha1", shape(false));
    expect(playbookApplication.upsert).not.toHaveBeenCalled();
  });

  it("guard: a catalog practice landing never touches the playbook marks", async () => {
    practiceAdoption.findMany.mockResolvedValue([ledgerRow({ practiceId: "agent-guidance" })]);
    improvementPr.findMany.mockResolvedValue([{ practiceId: "agent-guidance" }]);
    await reconcilePracticeAdoption("org1", "acme/api", "sha1", shape(true));
    expect(practiceAdoption.update).toHaveBeenCalled();
    expect(playbookApplication.upsert).not.toHaveBeenCalled();
  });

  it("guard: a drifted row healing back to adopted does not re-stamp a mark someone removed", async () => {
    practiceAdoption.findMany.mockResolvedValue([ledgerRow({ state: "drifted", adoptedHash: "sha256-n1:landed" })]);
    await reconcilePracticeAdoption("org1", "acme/api", "sha1", shape(true));
    expect(practiceAdoption.update.mock.calls[0]![0].data.state).toBe("adopted");
    expect(playbookApplication.upsert).not.toHaveBeenCalled();
  });

  it("does not stamp a playbook this org does not own", async () => {
    practiceAdoption.findMany.mockResolvedValue([ledgerRow()]);
    playbook.findFirst.mockResolvedValue(null);
    await reconcilePracticeAdoption("org1", "acme/api", "sha1", shape(true));
    expect(playbook.findFirst).toHaveBeenCalledTimes(1);
    expect(playbookApplication.upsert).not.toHaveBeenCalled();
  });

  it("guard: a failed stamp never fails the reconcile (the ledger row still lands)", async () => {
    practiceAdoption.findMany.mockResolvedValue([ledgerRow()]);
    playbookApplication.upsert.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await reconcilePracticeAdoption("org1", "acme/api", "sha1", shape(true));
    errSpy.mockRestore();
    expect(out).toEqual({ adopted: 1, drifted: 0, removed: 0 });
  });
});
