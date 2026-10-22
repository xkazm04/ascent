// Playbook lift read through the latest-scan door (playbooks-0, challenge-2026-10-22e). The double is
// org-rollup-latest-scans.test-helpers.ts's in-memory Scan table, which answers groupBy and the pair
// fetch the way Postgres would, so these cases assert on the rows a real database would hand back -
// and on how many of them crossed the wire.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { latestScanReads, type FakeScan } from "./org-rollup-latest-scans.test-helpers";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: mockGetPrisma }));

import { getPlaybookAdoption } from "./playbooks";

type App = { playbookId: string; repoFullName: string; appliedAt: Date; appliedBy?: string | null };
type Scan = { repoId: string; scannedAt: Date; score: number; dimId?: string; engineProvider?: string };

function fake(playbooks: { id: string; dimId: string }[], apps: App[], repos: { id: string; fullName: string }[], scans: Scan[]) {
  const table: FakeScan[] = scans.map((s, i) => ({
    id: `${s.repoId}-${String(i).padStart(5, "0")}`,
    repoId: s.repoId,
    scannedAt: s.scannedAt,
    engineProvider: s.engineProvider ?? "anthropic",
    dimensions: [{ dimId: s.dimId ?? "D5", score: s.score }],
  }));
  const reads = latestScanReads(() => table, () => table); // a non-pair findMany is the old whole-history read
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
    playbook: { findMany: vi.fn(async () => playbooks) },
    playbookApplication: { findMany: vi.fn(async () => apps.map((a) => ({ appliedBy: null, ...a }))) },
    practiceAdoption: { findMany: vi.fn(async () => []) },
    repository: {
      findMany: vi.fn(async ({ where }: { where: { fullName: { in: string[] } } }) => repos.filter((r) => where.fullName.in.includes(r.fullName))),
    },
    scan: reads,
    /** Scan rows every scan.findMany returned (the wire volume). */
    scanRowsFetched: async () => {
      let n = 0;
      for (const res of reads.findMany.mock.results) n += ((await res.value) as unknown[]).length;
      return n;
    },
  };
}

const day = 86_400_000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const T = new Date("2026-02-10T00:00:00Z");
const pb = [{ id: "pb_1", dimId: "D5" }];
const repo = [{ id: "repo_1", fullName: "acme/repo" }];

beforeEach(() => mockGetPrisma.mockReset());

describe("getPlaybookAdoption: lift is a before/after pair with a named status", () => {
  it("a reading AT the adoption instant is after-side (40 @ T-1d, 60 @ T, 70 @ T+5d -> +30, not +10)", async () => {
    const scans = [40, 60, 70].map((score, i) => ({ repoId: "repo_1", scannedAt: [at(T, -day), T, at(T, 5 * day)][i]!, score }));
    mockGetPrisma.mockReturnValue(fake(pb, [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: T }], repo, scans));
    expect((await getPlaybookAdoption("acme"))["pb_1"]).toMatchObject({ lift: 30, measured: 1 });
  });

  it("a scan-stamped mark: the landing scan (L, mark at L+2s) is after-side -> before 40, +30 (not +5)", async () => {
    const L = new Date("2026-03-01T00:00:00Z");
    const scans = [
      { repoId: "repo_1", scannedAt: at(L, -7 * day), score: 40 },
      { repoId: "repo_1", scannedAt: L, score: 65 },
      { repoId: "repo_1", scannedAt: at(L, 7 * day), score: 70 },
    ];
    mockGetPrisma.mockReturnValue(fake(pb, [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: at(L, 2000), appliedBy: "scan" }], repo, scans));
    expect((await getPlaybookAdoption("acme"))["pb_1"]).toMatchObject({ lift: 30, measured: 1 });
  });

  it("a mock latest reading is excluded and counted, not swapped for the older live scan", async () => {
    const scans = [
      { repoId: "repo_1", scannedAt: at(T, -day), score: 40 },
      { repoId: "repo_1", scannedAt: at(T, day), score: 75 },
      { repoId: "repo_1", scannedAt: at(T, 2 * day), score: 0, engineProvider: "mock" },
    ];
    mockGetPrisma.mockReturnValue(fake(pb, [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: T }], repo, scans));
    expect((await getPlaybookAdoption("acme"))["pb_1"]).toMatchObject({
      lift: null,
      measured: 0,
      unpaired: { noBefore: 0, noAfter: 0, mock: 1, noDimension: 0 },
    });
  });

  it("no-before / no-after / no-dimension are each counted, and measured + sum(unpaired) = applications", async () => {
    const repos = ["a", "b", "c", "d"].map((x) => ({ id: `r_${x}`, fullName: `acme/${x}` }));
    const apps = repos.map((r) => ({ playbookId: "pb_1", repoFullName: r.fullName, appliedAt: T }));
    const scans: Scan[] = [
      { repoId: "r_a", scannedAt: at(T, -day), score: 40 },
      { repoId: "r_a", scannedAt: at(T, day), score: 60 }, // paired +20
      { repoId: "r_b", scannedAt: at(T, day), score: 60 }, // no-before
      { repoId: "r_c", scannedAt: at(T, -day), score: 60 }, // no-after
      { repoId: "r_d", scannedAt: at(T, -day), score: 40, dimId: "D2" },
      { repoId: "r_d", scannedAt: at(T, day), score: 60 }, // no-dimension
    ];
    mockGetPrisma.mockReturnValue(fake(pb, apps, repos, scans));
    const out = (await getPlaybookAdoption("acme"))["pb_1"]!;
    expect(out).toMatchObject({ lift: 20, measured: 1, unpaired: { noBefore: 1, noAfter: 1, mock: 0, noDimension: 1 } });
    expect(out.measured + Object.values(out.unpaired!).reduce((a, b) => a + b, 0)).toBe(apps.length);
  });
});

describe("getPlaybookAdoption: the lift read is constant in history depth", () => {
  async function volume(perRepo: number) {
    const t0 = Date.parse("2025-01-01T00:00:00Z");
    const repos = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, fullName: `acme/r${i}` }));
    const scans: Scan[] = repos.flatMap((r, i) =>
      Array.from({ length: perRepo }, (_, j) => ({ repoId: r.id, scannedAt: new Date(t0 + j * day + i * 60_000), score: (i + j) % 100 })),
    );
    const mid = new Date(t0 + Math.floor(perRepo / 2) * day + 30 * 60_000);
    const apps = repos.flatMap((r) => [
      { playbookId: "pb_1", repoFullName: r.fullName, appliedAt: mid },
      { playbookId: "pb_2", repoFullName: r.fullName, appliedAt: at(mid, 3 * day) },
    ]);
    const prisma = fake([{ id: "pb_1", dimId: "D5" }, { id: "pb_2", dimId: "D5" }], apps, repos, scans);
    mockGetPrisma.mockReturnValue(prisma);
    const out = await getPlaybookAdoption("acme");
    return { fetched: await prisma.scanRowsFetched(), out };
  }

  it("10 repos x 60 scans, 2 playbooks per repo -> at most 2 Scan rows per application (<= 40), not 600", async () => {
    const { fetched, out } = await volume(60);
    expect(fetched).toBeLessThanOrEqual(40);
    expect(out["pb_1"]!.measured + out["pb_2"]!.measured).toBe(20);
  });

  it("doubling the history to 120 scans/repo leaves the fetched count unchanged", async () => {
    const a = await volume(60);
    const b = await volume(120);
    expect(b.fetched).toBe(a.fetched);
  });
});
