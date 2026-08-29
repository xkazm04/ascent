// getFoundationRollout — the honest-null contract and the wire-safe timestamp contract, both of which
// are invisible until they are wrong in production:
//
//   • a never-reported repo is `conformance: null`, NOT 0. Rendering 0% for "never ran the doctor"
//     invents a basis the org would act on (G4).
//   • a revoked repo is `reportBackAt: null`, and a re-provision after a revoke is live again.
//   • every timestamp on the row is a `string`. This type crosses to a client component, where a
//     declared `Date` type-checks and then throws at runtime.
//   • batch and single-repo installs write the SAME `foundation.pr_opened` action, so the read cannot
//     tell them apart — the panel must not care which door a repo came through.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({
  getOrgId: async (slug: string) => (slug === "acme" ? "org_acme" : null),
}));

import { getFoundationRollout } from "@/lib/db/org-foundation";

const T = (iso: string) => new Date(iso);

interface RepoRow {
  fullName: string;
  aiConformance: number | null;
  aiConformanceAt: Date | null;
}
interface AuditRow {
  action: string;
  meta: string;
  at: Date;
}

function db(repos: RepoRow[], events: AuditRow[]) {
  mockGetPrisma.mockReturnValue({
    repository: { findMany: vi.fn(async () => repos) },
    // The module relies on newest-first ordering; the fake honours it so the test exercises the real
    // "first sighting wins" fold rather than an accidentally-sorted fixture.
    auditLog: { findMany: vi.fn(async () => [...events].sort((a, b) => b.at.getTime() - a.at.getTime())) },
  });
}

const repo = (fullName: string, conformance: number | null = null, at: Date | null = null): RepoRow => ({
  fullName,
  aiConformance: conformance,
  aiConformanceAt: at,
});
const ev = (action: string, repoName: string, at: string): AuditRow => ({
  action,
  meta: JSON.stringify({ repo: repoName }),
  at: T(at),
});

beforeEach(() => vi.clearAllMocks());

describe("honest nulls", () => {
  it("a never-reported repo is conformance:null, NOT 0", async () => {
    db([repo("acme/app")], []);
    const rows = await getFoundationRollout("acme");
    expect(rows[0]!.conformance).toBeNull();
    expect(rows[0]!.conformance).not.toBe(0);
    expect(rows[0]!.conformanceAt).toBeNull();
  });

  it("a genuine 0% report is preserved as 0, not flattened to null", async () => {
    db([repo("acme/app", 0, T("2026-08-01T00:00:00Z"))], []);
    const rows = await getFoundationRollout("acme");
    expect(rows[0]!.conformance).toBe(0);
  });

  it("an un-provisioned repo is reportBackAt:null (not 'off')", async () => {
    db([repo("acme/app")], []);
    expect((await getFoundationRollout("acme"))[0]!.reportBackAt).toBeNull();
  });

  it("a repo never installed through Ascent is foundationPrAt:null", async () => {
    db([repo("acme/app")], []);
    expect((await getFoundationRollout("acme"))[0]!.foundationPrAt).toBeNull();
  });
});

describe("report-back lifecycle", () => {
  it("provisioned then revoked → reportBackAt:null", async () => {
    db(
      [repo("acme/app")],
      [
        ev("foundation.reportback_provisioned", "acme/app", "2026-08-01T00:00:00Z"),
        ev("foundation.reportback_revoked", "acme/app", "2026-08-02T00:00:00Z"),
      ],
    );
    expect((await getFoundationRollout("acme"))[0]!.reportBackAt).toBeNull();
  });

  it("revoked then RE-provisioned → live again", async () => {
    db(
      [repo("acme/app")],
      [
        ev("foundation.reportback_provisioned", "acme/app", "2026-08-01T00:00:00Z"),
        ev("foundation.reportback_revoked", "acme/app", "2026-08-02T00:00:00Z"),
        ev("foundation.reportback_provisioned", "acme/app", "2026-08-03T00:00:00Z"),
      ],
    );
    expect((await getFoundationRollout("acme"))[0]!.reportBackAt).toBe("2026-08-03T00:00:00.000Z");
  });

  it("one repo's revoke never affects another's", async () => {
    db(
      [repo("acme/app"), repo("acme/api")],
      [
        ev("foundation.reportback_provisioned", "acme/app", "2026-08-01T00:00:00Z"),
        ev("foundation.reportback_provisioned", "acme/api", "2026-08-01T00:00:00Z"),
        ev("foundation.reportback_revoked", "acme/app", "2026-08-02T00:00:00Z"),
      ],
    );
    const byRepo = Object.fromEntries((await getFoundationRollout("acme")).map((r) => [r.repo, r.reportBackAt]));
    expect(byRepo["acme/app"]).toBeNull();
    expect(byRepo["acme/api"]).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("installs", () => {
  it("takes the LATEST foundation.pr_opened, whichever door wrote it", async () => {
    db(
      [repo("acme/app")],
      [
        // A single-repo install, then a batch re-run. Same action, so the read cannot tell them apart.
        ev("foundation.pr_opened", "acme/app", "2026-07-01T00:00:00Z"),
        { action: "foundation.pr_opened", meta: JSON.stringify({ repo: "acme/app", batch: true }), at: T("2026-08-01T00:00:00Z") },
      ],
    );
    expect((await getFoundationRollout("acme"))[0]!.foundationPrAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("matches repo names case-insensitively", async () => {
    db([repo("Acme/App")], [ev("foundation.pr_opened", "acme/app", "2026-08-01T00:00:00Z")]);
    expect((await getFoundationRollout("acme"))[0]!.foundationPrAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("ignores an unparseable or repo-less audit meta instead of throwing", async () => {
    db(
      [repo("acme/app")],
      [
        { action: "foundation.pr_opened", meta: "{not json", at: T("2026-08-05T00:00:00Z") },
        { action: "foundation.pr_opened", meta: JSON.stringify({ repos: 3 }), at: T("2026-08-04T00:00:00Z") },
      ],
    );
    expect((await getFoundationRollout("acme"))[0]!.foundationPrAt).toBeNull();
  });
});

describe("wire safety + degradation", () => {
  it("every timestamp on the row is a string, never a Date", async () => {
    db(
      [repo("acme/app", 82, T("2026-08-10T09:00:00Z"))],
      [
        ev("foundation.pr_opened", "acme/app", "2026-08-01T00:00:00Z"),
        ev("foundation.reportback_provisioned", "acme/app", "2026-08-02T00:00:00Z"),
      ],
    );
    const row = (await getFoundationRollout("acme"))[0]!;
    for (const v of [row.foundationPrAt, row.reportBackAt, row.conformanceAt]) {
      expect(typeof v).toBe("string");
      expect(v).not.toBeInstanceOf(Date);
    }
    expect(row.conformance).toBe(82);
  });

  it("an unknown org yields [] rather than throwing", async () => {
    db([repo("acme/app")], []);
    expect(await getFoundationRollout("nope")).toEqual([]);
  });

  it("an org with no repos yields []", async () => {
    db([], [ev("foundation.pr_opened", "acme/app", "2026-08-01T00:00:00Z")]);
    expect(await getFoundationRollout("acme")).toEqual([]);
  });
});
