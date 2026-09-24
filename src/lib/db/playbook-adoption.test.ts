// Row 40 (backlog develop-2026-09-17): an opened-but-unmerged playbook PR reads as PROPOSED, never
// adopted. getPlaybookAdoption is the one read every adoption count goes through (the Practices tab
// card + rollout strip, the library summary, the executive briefing's proof line), so the demotion
// lives here. The open-draft fact is the #33 ledger's `playbook:<uuid>` row still in `proposed`.
// This also re-derives, on read, the marks the PR route stamped at draft-open before row 40: nothing
// is deleted, they simply stop counting until the file lands.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: mockGetPrisma }));

import { getPlaybookAdoption } from "./playbooks";

interface App {
  playbookId: string;
  repoFullName: string;
  appliedAt: Date;
  appliedBy?: string | null;
}
interface Ledger {
  practiceId: string;
  repoFullName: string;
  state: string;
}

function fake(apps: App[], ledger: Ledger[]) {
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
    playbook: { findMany: vi.fn(async () => [{ id: "pb_1", dimId: "D5" }]) },
    playbookApplication: { findMany: vi.fn(async () => apps.map((a) => ({ appliedBy: null, ...a }))) },
    practiceAdoption: {
      findMany: vi.fn(async ({ where }: { where: { state?: string } }) =>
        ledger.filter((l) => l.practiceId.startsWith("playbook:") && (!where.state || l.state === where.state)),
      ),
    },
    repository: { findMany: vi.fn(async () => []) },
    scan: { findMany: vi.fn(async () => []) },
  };
}

const at = new Date("2026-09-01T00:00:00Z");

beforeEach(() => mockGetPrisma.mockReset());

describe("getPlaybookAdoption: an open playbook PR is proposed, not adopted", () => {
  it("does not count a draft-open mark while the playbook PR has not landed", async () => {
    mockGetPrisma.mockReturnValue(
      fake(
        [{ playbookId: "pb_1", repoFullName: "acme/web", appliedAt: at, appliedBy: "alice" }],
        [{ practiceId: "playbook:pb_1", repoFullName: "acme/web", state: "proposed" }],
      ),
    );
    const out = await getPlaybookAdoption("acme");
    expect(out["pb_1"]).toEqual({ repos: 0, appliedRepos: [], lift: null, measured: 0, proposedRepos: ["acme/web"] });
  });

  it("reports a proposed-only playbook with zero adopted repos (a PR opened after row 40 writes no mark)", async () => {
    mockGetPrisma.mockReturnValue(fake([], [{ practiceId: "playbook:pb_1", repoFullName: "acme/api", state: "proposed" }]));
    const out = await getPlaybookAdoption("acme");
    expect(out["pb_1"]).toMatchObject({ repos: 0, appliedRepos: [], proposedRepos: ["acme/api"] });
  });

  it("guard: counts the mark once the ledger says the file landed", async () => {
    mockGetPrisma.mockReturnValue(
      fake(
        [{ playbookId: "pb_1", repoFullName: "acme/web", appliedAt: at, appliedBy: "scan" }],
        [{ practiceId: "playbook:pb_1", repoFullName: "acme/web", state: "adopted" }],
      ),
    );
    const out = await getPlaybookAdoption("acme");
    expect(out["pb_1"]).toMatchObject({ repos: 1, appliedRepos: ["acme/web"] });
    expect(out["pb_1"]?.proposedRepos ?? []).toEqual([]);
  });

  it("guard: a mark with no playbook PR behind it (manual mark) still counts", async () => {
    mockGetPrisma.mockReturnValue(fake([{ playbookId: "pb_1", repoFullName: "acme/web", appliedAt: at, appliedBy: "alice" }], []));
    const out = await getPlaybookAdoption("acme");
    expect(out["pb_1"]).toMatchObject({ repos: 1, appliedRepos: ["acme/web"] });
  });

  it("guard: a loop stamp (verified close) counts even beside an open playbook PR", async () => {
    mockGetPrisma.mockReturnValue(
      fake(
        [{ playbookId: "pb_1", repoFullName: "acme/web", appliedAt: at, appliedBy: "loop" }],
        [{ practiceId: "playbook:pb_1", repoFullName: "acme/web", state: "proposed" }],
      ),
    );
    const out = await getPlaybookAdoption("acme");
    expect(out["pb_1"]).toMatchObject({ repos: 1, appliedRepos: ["acme/web"] });
  });

  it("guard: an open PR on one repo does not demote the playbook's landed repos", async () => {
    mockGetPrisma.mockReturnValue(
      fake(
        [
          { playbookId: "pb_1", repoFullName: "acme/web", appliedAt: at, appliedBy: "alice" },
          { playbookId: "pb_1", repoFullName: "acme/api", appliedAt: at, appliedBy: "alice" },
        ],
        [{ practiceId: "playbook:pb_1", repoFullName: "acme/api", state: "proposed" }],
      ),
    );
    const out = await getPlaybookAdoption("acme");
    expect(out["pb_1"]).toMatchObject({ repos: 1, appliedRepos: ["acme/web"], proposedRepos: ["acme/api"] });
  });

  it("guard: still returns {} when nothing was applied or proposed", async () => {
    mockGetPrisma.mockReturnValue(fake([], []));
    expect(await getPlaybookAdoption("acme")).toEqual({});
  });
});
