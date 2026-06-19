// getPlaybookAdoption lift-math honesty (Test Mastery — Playbooks, critical #2). Pins the
// "only-after-a-later-scan" invariant: lift is credited ONLY from a scan dated strictly AFTER the
// adoption (`current.at > baseline.at`), where the baseline is the latest scan at-or-before
// `appliedAt`. A repo whose only post-apply data is actually a pre-adoption scan yields no lift —
// not a fabricated improvement. Also pins the genuine before→after delta, the never-rescanned
// "pending" case, and cross-repo aggregation (avg lift + distinct repo count). Read-only function,
// in-memory Prisma fake (no DB), mirrors src/lib/db/credits.test.ts harness.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { getPlaybookAdoption, createPlaybook, getPlaybook } from "./playbooks";

// ---- fixture types (only the fields getPlaybookAdoption selects) ----
interface PlaybookFx {
  id: string;
  dimId: string;
}
interface AppFx {
  playbookId: string;
  repoFullName: string;
  appliedAt: Date;
}
interface RepoFx {
  id: string;
  fullName: string;
}
interface ScanFx {
  repoId: string;
  scannedAt: Date;
  dimensions: { dimId: string; score: number }[];
}

/**
 * In-memory Prisma fake for getPlaybookAdoption. The function only READS: one org findUnique, then
 * findMany over playbook / playbookApplication / repository / scan. We honor the `where`/`in` filters
 * the function relies on (orgId match, fullName ∈ set, repoId ∈ set) so the fixture behaves like the
 * real query layer; ordering is applied for the scan timeline (scannedAt asc) since the function trusts
 * it. `org: null` simulates an unknown slug (early {} return).
 */
function fakePrisma(opts: {
  orgId?: string | null;
  playbooks: PlaybookFx[];
  apps: AppFx[];
  repos: RepoFx[];
  scans: ScanFx[];
}) {
  const orgId = opts.orgId === undefined ? "org_1" : opts.orgId;
  return {
    organization: {
      findUnique: vi.fn(async () => (orgId === null ? null : { id: orgId })),
    },
    playbook: {
      findMany: vi.fn(async () => opts.playbooks.map((p) => ({ id: p.id, dimId: p.dimId }))),
    },
    playbookApplication: {
      findMany: vi.fn(async () =>
        opts.apps.map((a) => ({
          playbookId: a.playbookId,
          repoFullName: a.repoFullName,
          appliedAt: a.appliedAt,
        })),
      ),
    },
    repository: {
      findMany: vi.fn(async ({ where }: { where: { fullName: { in: string[] } } }) => {
        const wanted = new Set(where.fullName.in);
        return opts.repos
          .filter((r) => wanted.has(r.fullName))
          .map((r) => ({ id: r.id, fullName: r.fullName }));
      }),
    },
    scan: {
      findMany: vi.fn(async ({ where }: { where: { repoId: { in: string[] } } }) => {
        const wanted = new Set(where.repoId.in);
        return opts.scans
          .filter((s) => wanted.has(s.repoId))
          .slice()
          .sort((a, b) => a.scannedAt.getTime() - b.scannedAt.getTime())
          .map((s) => ({
            repoId: s.repoId,
            scannedAt: s.scannedAt,
            dimensions: s.dimensions.map((d) => ({ dimId: d.dimId, score: d.score })),
          }));
      }),
    },
  };
}

const D = (iso: string) => new Date(iso);

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getPlaybookAdoption — only-after-adoption lift invariant", () => {
  it("credits NO lift when the only post-apply data is actually a PRE-adoption scan (no fabricated improvement)", async () => {
    // Repo's single (and newest) scan predates the apply date. baseline === current === that scan,
    // so `current.at > baseline.at` is false → measured stays 0, lift null. A naive impl that diffed
    // "current − apply-time baseline" would invent a number here; this pins that it must not.
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") }],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [{ repoId: "repo_1", scannedAt: D("2026-02-01T00:00:00Z"), dimensions: [{ dimId: "D5", score: 80 }] }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toEqual({
      repos: 1,
      appliedRepos: ["acme/repo"],
      lift: null,
      measured: 0,
    });
  });

  it("a scan dated exactly AT the apply time is a baseline, never an 'after' (boundary: <= apply, strict > baseline)", async () => {
    // Two scans: one exactly at appliedAt (baseline) and... nothing later. current === baseline → no lift.
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") }],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [{ repoId: "repo_1", scannedAt: D("2026-02-10T00:00:00Z"), dimensions: [{ dimId: "D5", score: 50 }] }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toMatchObject({ lift: null, measured: 0 });
  });

  it("a genuine before(pre-apply)→after(post-apply) pair yields the correct lift delta (40→70 = 30)", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") }],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [
        { repoId: "repo_1", scannedAt: D("2026-02-05T00:00:00Z"), dimensions: [{ dimId: "D5", score: 40 }] }, // baseline (pre-apply)
        { repoId: "repo_1", scannedAt: D("2026-02-20T00:00:00Z"), dimensions: [{ dimId: "D5", score: 70 }] }, // after
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toEqual({
      repos: 1,
      appliedRepos: ["acme/repo"],
      lift: 30,
      measured: 1,
    });
  });

  it("picks the LATEST pre-apply scan as baseline and the NEWEST scan as current (60→90 = +30, ignoring older 40)", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") }],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [
        { repoId: "repo_1", scannedAt: D("2026-01-01T00:00:00Z"), dimensions: [{ dimId: "D5", score: 40 }] }, // older pre-apply (ignored as baseline)
        { repoId: "repo_1", scannedAt: D("2026-02-08T00:00:00Z"), dimensions: [{ dimId: "D5", score: 60 }] }, // latest pre-apply → baseline
        { repoId: "repo_1", scannedAt: D("2026-03-01T00:00:00Z"), dimensions: [{ dimId: "D5", score: 90 }] }, // newest → current
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toMatchObject({ lift: 30, measured: 1 });
  });

  it("a repo adopted but NEVER re-scanned is 'pending' — no scan at all means no-lift (null), not a confident number", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") }],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [], // never scanned
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toEqual({
      repos: 1,
      appliedRepos: ["acme/repo"],
      lift: null,
      measured: 0,
    });
  });

  it("a playbook with no matching dimId contributes null lift (the dim never moved because it isn't scored)", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D9" }], // D9 dimension is never present in any scan
      apps: [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") }],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [
        { repoId: "repo_1", scannedAt: D("2026-02-05T00:00:00Z"), dimensions: [{ dimId: "D5", score: 40 }] },
        { repoId: "repo_1", scannedAt: D("2026-02-20T00:00:00Z"), dimensions: [{ dimId: "D5", score: 70 }] },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toMatchObject({ lift: null, measured: 0 });
  });
});

describe("getPlaybookAdoption — cross-repo aggregation math", () => {
  it("averages lift over only the MEASURED repos and counts distinct repos (one measured +30, one pending → avg 30, repos 2)", async () => {
    // repoA: genuine 40→70 (+30, measured). repoB: only a pre-apply scan (pending, not measured).
    // avg lift must divide by measured(1) not repos(2) → 30, NOT 15.
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [
        { playbookId: "pb_1", repoFullName: "acme/a", appliedAt: D("2026-02-10T00:00:00Z") },
        { playbookId: "pb_1", repoFullName: "acme/b", appliedAt: D("2026-02-10T00:00:00Z") },
      ],
      repos: [
        { id: "repo_a", fullName: "acme/a" },
        { id: "repo_b", fullName: "acme/b" },
      ],
      scans: [
        { repoId: "repo_a", scannedAt: D("2026-02-05T00:00:00Z"), dimensions: [{ dimId: "D5", score: 40 }] },
        { repoId: "repo_a", scannedAt: D("2026-02-20T00:00:00Z"), dimensions: [{ dimId: "D5", score: 70 }] },
        { repoId: "repo_b", scannedAt: D("2026-02-01T00:00:00Z"), dimensions: [{ dimId: "D5", score: 90 }] }, // pre-apply only → pending
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toEqual({
      repos: 2,
      appliedRepos: ["acme/a", "acme/b"],
      lift: 30,
      measured: 1,
    });
  });

  it("averages two measured deltas and ROUNDS the mean (+30 and +10 → avg 20; +30 and +20 → round(25)=25)", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [
        { playbookId: "pb_1", repoFullName: "acme/a", appliedAt: D("2026-02-10T00:00:00Z") },
        { playbookId: "pb_1", repoFullName: "acme/b", appliedAt: D("2026-02-10T00:00:00Z") },
      ],
      repos: [
        { id: "repo_a", fullName: "acme/a" },
        { id: "repo_b", fullName: "acme/b" },
      ],
      scans: [
        { repoId: "repo_a", scannedAt: D("2026-02-05T00:00:00Z"), dimensions: [{ dimId: "D5", score: 40 }] },
        { repoId: "repo_a", scannedAt: D("2026-02-20T00:00:00Z"), dimensions: [{ dimId: "D5", score: 70 }] }, // +30
        { repoId: "repo_b", scannedAt: D("2026-02-05T00:00:00Z"), dimensions: [{ dimId: "D5", score: 50 }] },
        { repoId: "repo_b", scannedAt: D("2026-02-20T00:00:00Z"), dimensions: [{ dimId: "D5", score: 60 }] }, // +10
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    // mean(30, 10) = 20
    expect(out["pb_1"]).toMatchObject({ lift: 20, measured: 2, repos: 2 });
  });

  it("counts DISTINCT repos: a double-apply to the same repo dedupes to repos:1 and is measured once", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [
        // same repo applied twice (re-apply / version bump) — must dedupe by repoFullName
        { playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") },
        { playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-12T00:00:00Z") },
      ],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [
        { repoId: "repo_1", scannedAt: D("2026-02-05T00:00:00Z"), dimensions: [{ dimId: "D5", score: 40 }] },
        { repoId: "repo_1", scannedAt: D("2026-02-20T00:00:00Z"), dimensions: [{ dimId: "D5", score: 70 }] },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    // repos dedupes to 1; both application rows measure (+30 each) so measured=2 but the average is still 30.
    expect(out["pb_1"]).toMatchObject({ repos: 1, appliedRepos: ["acme/repo"], lift: 30, measured: 2 });
  });

  it("a negative delta (regression after apply) is reported honestly, not floored at zero (70→40 = -30)", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [{ playbookId: "pb_1", repoFullName: "acme/repo", appliedAt: D("2026-02-10T00:00:00Z") }],
      repos: [{ id: "repo_1", fullName: "acme/repo" }],
      scans: [
        { repoId: "repo_1", scannedAt: D("2026-02-05T00:00:00Z"), dimensions: [{ dimId: "D5", score: 70 }] },
        { repoId: "repo_1", scannedAt: D("2026-02-20T00:00:00Z"), dimensions: [{ dimId: "D5", score: 40 }] },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out["pb_1"]).toMatchObject({ lift: -30, measured: 1 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────────
// cleanSteps / parseSteps round-trip + bounds (Test Mastery — Playbooks, HIGH #3).
//
// `cleanSteps` (serialize+bound) and `parseSteps` (deserialize+filter) are the SINGLE place `steps`
// is (de)serialized and bounded for storage — per the module header. They're module-private, so we
// exercise them through the only public surface that uses them: `createPlaybook` writes
// cleanSteps(input.steps) into `playbook.create({ data: { steps } })`, and `getPlaybook` returns
// parseSteps(stored.steps). We capture the serialized blob from the create call and feed blobs into
// the find to pin both directions without touching source.
//
// Invariants pinned:
//   • cleanSteps enforces bounds — ≤20 steps, ≤300 chars/step, trims, drops empty/non-string — so a
//     hostile/huge input can't blow up storage (DSQL row-size) or the consumer.
//   • parseSteps NEVER throws — malformed JSON, non-array, and non-string elements all yield the
//     documented safe default (filtered `string[]`, `[]` on garbage), so one bad stored row can't
//     500 the list route for a whole org.
//   • Round-trip: parseSteps(cleanSteps(xs)) === the cleaned xs (a well-formed blob survives unchanged).
//   • empty → empty.
// ──────────────────────────────────────────────────────────────────────────────────────────────

/** Prisma fake whose `playbook.create` records the serialized `steps` blob it was handed, and whose
 *  `playbook.findUnique` returns a row carrying a caller-supplied stored `steps` string. Both directions
 *  of the (de)serializer are observable this way. `organization.upsert` satisfies createPlaybook's org. */
function fakeStepsPrisma() {
  const created: { steps: string }[] = [];
  let storedSteps = "[]";
  return {
    handle: {
      organization: {
        upsert: vi.fn(async () => ({ id: "org_1" })),
        findUnique: vi.fn(async () => ({ id: "org_1" })),
      },
      playbook: {
        create: vi.fn(async ({ data }: { data: { steps: string } }) => {
          created.push({ steps: data.steps });
          return { id: "pb_new" };
        }),
        findUnique: vi.fn(async () => ({
          id: "pb_1",
          title: "T",
          dimId: "D5",
          summary: "",
          steps: storedSteps,
          createdBy: null,
          createdAt: new Date("2026-02-01T00:00:00Z"),
          version: 1,
          updatedAt: new Date("2026-02-01T00:00:00Z"),
        })),
      },
    },
    /** the JSON string cleanSteps produced for the i-th createPlaybook call */
    serialized: (i = 0) => created[i].steps,
    /** parsed array that getPlaybook returns when the stored blob is `s` */
    setStored: (s: string) => {
      storedSteps = s;
    },
  };
}

describe("playbooks steps serializer — cleanSteps bounds (via createPlaybook)", () => {
  it("caps the step COUNT at 20 (a 50-element array is truncated — storage-bomb guard)", async () => {
    const fx = fakeStepsPrisma();
    mockGetPrisma.mockReturnValue(fx.handle);

    await createPlaybook("acme", { title: "T", dimId: "D5", steps: Array(50).fill("x") });

    const out = JSON.parse(fx.serialized());
    expect(out).toHaveLength(20);
    expect(out.every((s: unknown) => s === "x")).toBe(true);
  });

  it("caps each step LENGTH at 300 chars (a 400-char step is truncated)", async () => {
    const fx = fakeStepsPrisma();
    mockGetPrisma.mockReturnValue(fx.handle);

    await createPlaybook("acme", { title: "T", dimId: "D5", steps: ["a".repeat(400)] });

    const out = JSON.parse(fx.serialized());
    expect(out).toEqual(["a".repeat(300)]);
  });

  it("trims whitespace and DROPS empty / non-string elements (['  a  ', '', 5, null] → ['a'])", async () => {
    const fx = fakeStepsPrisma();
    mockGetPrisma.mockReturnValue(fx.handle);

    // non-string junk simulates a loosely-typed caller; the serializer must defend against it.
    await createPlaybook("acme", {
      title: "T",
      dimId: "D5",
      steps: ["  a  ", "", "   ", 5, null] as unknown as string[],
    });

    expect(JSON.parse(fx.serialized())).toEqual(["a"]);
  });

  it("empty / undefined steps serialize to an empty array (empty → empty)", async () => {
    const fx = fakeStepsPrisma();
    mockGetPrisma.mockReturnValue(fx.handle);

    await createPlaybook("acme", { title: "T", dimId: "D5", steps: [] });
    await createPlaybook("acme", { title: "T", dimId: "D5" }); // steps undefined

    expect(fx.serialized(0)).toBe("[]");
    expect(fx.serialized(1)).toBe("[]");
  });
});

describe("playbooks steps serializer — parseSteps safe-default (via getPlaybook)", () => {
  it("returns [] for malformed stored JSON instead of throwing (one bad row can't 500 the route)", async () => {
    const fx = fakeStepsPrisma();
    fx.setStored("not json{");
    mockGetPrisma.mockReturnValue(fx.handle);

    const pb = await getPlaybook("pb_1");

    expect(pb?.steps).toEqual([]);
  });

  it("returns [] when stored JSON is valid but NOT an array (e.g. an object)", async () => {
    const fx = fakeStepsPrisma();
    fx.setStored('{"a":1}');
    mockGetPrisma.mockReturnValue(fx.handle);

    const pb = await getPlaybook("pb_1");

    expect(pb?.steps).toEqual([]);
  });

  it("filters non-string elements out of a stored array (['a', 5, null, 'b'] → ['a','b'])", async () => {
    const fx = fakeStepsPrisma();
    fx.setStored(JSON.stringify(["a", 5, null, "b"]));
    mockGetPrisma.mockReturnValue(fx.handle);

    const pb = await getPlaybook("pb_1");

    expect(pb?.steps).toEqual(["a", "b"]);
  });

  it("an empty stored array parses to an empty array (empty → empty)", async () => {
    const fx = fakeStepsPrisma();
    fx.setStored("[]");
    mockGetPrisma.mockReturnValue(fx.handle);

    const pb = await getPlaybook("pb_1");

    expect(pb?.steps).toEqual([]);
  });
});

describe("playbooks steps serializer — round-trip (cleanSteps → store → parseSteps)", () => {
  it("a well-formed steps blob round-trips UNCHANGED through serialize + deserialize", async () => {
    const fx = fakeStepsPrisma();
    mockGetPrisma.mockReturnValue(fx.handle);

    // 1. clean+serialize via createPlaybook
    await createPlaybook("acme", { title: "T", dimId: "D5", steps: ["lint", "test", "deploy"] });
    const serialized = fx.serialized();

    // 2. feed that exact stored blob back through getPlaybook (parseSteps)
    fx.setStored(serialized);
    const pb = await getPlaybook("pb_1");

    expect(pb?.steps).toEqual(["lint", "test", "deploy"]);
  });

  it("round-trip is idempotent on the CLEANED form: bounds applied once survive a second pass", async () => {
    const fx = fakeStepsPrisma();
    mockGetPrisma.mockReturnValue(fx.handle);

    // hostile input → cleaned (≤20, trimmed, no junk)
    await createPlaybook("acme", {
      title: "T",
      dimId: "D5",
      steps: ["  keep  ", "", Array(40).fill("y").join("")] as unknown as string[],
    });
    const cleaned: string[] = JSON.parse(fx.serialized());

    // store the cleaned blob, read it back — parseSteps must return the cleaned form verbatim
    fx.setStored(JSON.stringify(cleaned));
    const pb = await getPlaybook("pb_1");

    expect(pb?.steps).toEqual(cleaned);
    expect(pb?.steps).toEqual(["keep", "y".repeat(40)]); // trimmed; under the 300 cap so kept whole
  });
});

describe("getPlaybookAdoption — guards", () => {
  it("returns {} when the db is not configured (no prisma access)", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const out = await getPlaybookAdoption("acme");

    expect(out).toEqual({});
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("returns {} for an unknown org slug", async () => {
    const prisma = fakePrisma({ orgId: null, playbooks: [], apps: [], repos: [], scans: [] });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("ghost");

    expect(out).toEqual({});
  });

  it("returns {} when no applications exist (nothing adopted → no headline metric to fabricate)", async () => {
    const prisma = fakePrisma({
      playbooks: [{ id: "pb_1", dimId: "D5" }],
      apps: [],
      repos: [],
      scans: [],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getPlaybookAdoption("acme");

    expect(out).toEqual({});
  });
});
