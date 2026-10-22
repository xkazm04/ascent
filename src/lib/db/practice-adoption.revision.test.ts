// playbooks-1: a landed playbook REVISION. The ledger row is `adopted`, Ascent re-proposed v3 over it
// (proposedHash + patternVersion moved), and the rescan now sees exactly the v3 bytes. The row
// rebaselines (stays adopted, new baseline) and the repo's PlaybookApplication.appliedVersion moves to
// the version the revision carried, so the card stops listing it as behind.

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

const PATH = "docs/playbooks/pb1-old.md";
const shape = (bodyHash: string): RepoPracticeShape => ({
  version: "2",
  entries: [],
  artifacts: [{ path: PATH, bodyHash, outlineHash: "sha256-n1:out3" }],
  truncated: false,
});
const row = {
  id: "row1",
  artifactPath: PATH,
  state: "adopted",
  adoptedHash: "sha256-n1:v1",
  adoptedOutline: "sha256-n1:out1",
  proposedHash: "sha256-n1:v3",
  patternVersion: 3,
  practiceId: "playbook:pb1",
};

beforeEach(() => {
  vi.clearAllMocks();
  improvementPr.findMany.mockResolvedValue([]);
  playbook.findFirst.mockResolvedValue({ id: "pb1" });
  playbookApplication.upsert.mockResolvedValue({});
});

describe("reconcilePracticeAdoption: a landed playbook revision", () => {
  it("rebaselines the row and stamps appliedVersion = the row's patternVersion", async () => {
    practiceAdoption.findMany.mockResolvedValue([row]);
    const out = await reconcilePracticeAdoption("org1", "acme/api", "scan1", shape("sha256-n1:v3"));
    expect(out).toEqual({ adopted: 1, drifted: 0, removed: 0 });
    const data = practiceAdoption.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ state: "adopted", adoptedHash: "sha256-n1:v3", adoptedOutline: "sha256-n1:out3" });
    // The adoption date is history: a rebaseline is not a new adoption.
    expect(data).not.toHaveProperty("adoptedAt");
    const up = playbookApplication.upsert.mock.calls[0]![0];
    expect(up.where).toEqual({ playbookId_repoFullName: { playbookId: "pb1", repoFullName: "acme/api" } });
    expect(up.update).toEqual({ appliedVersion: 3 });
    expect(up.create).toMatchObject({ orgId: "org1", appliedBy: "scan", appliedVersion: 3 });
    expect(playbook.findFirst.mock.calls[0]![0].where).toEqual({ id: "pb1", orgId: "org1" });
  });

  it("guard: bytes that are neither the baseline nor the revision are drift, and stamp nothing", async () => {
    practiceAdoption.findMany.mockResolvedValue([row]);
    await reconcilePracticeAdoption("org1", "acme/api", "scan1", shape("sha256-n1:hand-edit"));
    expect(practiceAdoption.update.mock.calls[0]![0].data.state).toBe("drifted");
    expect(playbookApplication.upsert).not.toHaveBeenCalled();
  });

  it("guard: a rebaselined row with no version (a house or pre-revision row) stamps nothing", async () => {
    practiceAdoption.findMany.mockResolvedValue([{ ...row, patternVersion: null }]);
    await reconcilePracticeAdoption("org1", "acme/api", "scan1", shape("sha256-n1:v3"));
    expect(practiceAdoption.update.mock.calls[0]![0].data.state).toBe("adopted");
    expect(playbookApplication.upsert).not.toHaveBeenCalled();
  });
});
