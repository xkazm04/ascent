// The FAN-OUT half of the adoption→outcome loop. skill-outcomes.test.ts covers the pairing math (pure);
// this covers the only thing the load module adds: how many history reads it issues, and how many of
// them are in flight at once.
//
// Why the bound needs its own test: getOrgSkillOutcomes used to fire one getRepositoryHistory per
// distinct adopted repo through an uncapped `Promise.all`, so a widely-adopted skill in a large org meant
// hundreds of concurrent DB round-trips from one page render — the page got slower precisely as a skill
// succeeded and spread. Asserting only the RESULT numbers would let that regress silently (an unbounded
// fan-out returns exactly the same answers), so these tests assert the concurrency and the call count.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHistory, mockAdoptions, mockRecordOutcomes, mockResolveOrgId } = vi.hoisted(() => ({
  mockHistory: vi.fn(),
  mockAdoptions: vi.fn(),
  mockRecordOutcomes: vi.fn(async () => {}),
  mockResolveOrgId: vi.fn(async () => "org_1" as string | null),
}));
vi.mock("@/lib/db", () => ({
  getRepositoryHistory: mockHistory,
  listOrgSkillAdoptionRows: mockAdoptions,
}));
vi.mock("@/lib/db/outcomes", () => ({ recordOutcomes: mockRecordOutcomes }));
vi.mock("@/lib/db/scans-shared", () => ({ resolveOrgId: mockResolveOrgId }));

import { getOrgSkillOutcomes, HISTORY_CONCURRENCY } from "./skill-outcomes-load";

const T = (iso: string) => new Date(iso).toISOString();

/** Points default to one matching instrument (same rubric revision, same engine family) so these
 *  pooling tests exercise the pooling. A pair whose instruments differ — or are unknown — is
 *  refused a delta by `skillOutcomesFor`, which is asserted directly in skill-outcomes.test.ts. */
const INSTRUMENT = { rubricVersion: "r6", engineProvider: "anthropic" } as const;

/** A history reader that records peak in-flight depth and resolves on the microtask queue. */
function trackingHistory(scansFor: (fullName: string) => { id: string; scannedAt: string; overallScore: number }[] = () => []) {
  const state = { inFlight: 0, peak: 0, calls: [] as string[] };
  mockHistory.mockImplementation(async (owner: string, name: string) => {
    const fullName = `${owner}/${name}`;
    state.calls.push(fullName);
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    // Two awaits so a lane genuinely yields — a single microtask can hide a serialization bug.
    await Promise.resolve();
    await Promise.resolve();
    state.inFlight -= 1;
    return { repo: { owner, name, fullName }, scans: scansFor(fullName).map((p) => ({ ...p, ...INSTRUMENT })) };
  });
  return state;
}

const adoption = (skillId: string, repoFullName: string, adoptedAt: string) => ({ skillId, repoFullName, adoptedAt });

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordOutcomes.mockResolvedValue(undefined);
  mockResolveOrgId.mockResolvedValue("org_1");
});

/** The ledger mirror is fire-and-forget, so let its promise chain settle before asserting on it. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** The single recordOutcomes payload, flattened. */
const mirrored = () => (mockRecordOutcomes.mock.calls[0]?.[0] ?? []) as Record<string, unknown>[];

describe("getOrgSkillOutcomes — bounded fan-out", () => {
  it("never runs more than HISTORY_CONCURRENCY history reads at once", async () => {
    const repos = Array.from({ length: 50 }, (_, i) => `acme/repo-${i}`);
    mockAdoptions.mockResolvedValue(repos.map((r, i) => adoption(`s${i}`, r, T("2026-07-01T00:00:00Z"))));
    const state = trackingHistory();

    await getOrgSkillOutcomes("acme");

    expect(state.calls).toHaveLength(50); // every repo is still visited — a bound, not a cap
    expect(state.peak).toBeLessThanOrEqual(HISTORY_CONCURRENCY);
    expect(state.peak).toBeGreaterThan(1); // …and it is genuinely parallel, not accidentally serial
  });

  it("issues ONE read per distinct repo, however many skills adopted it", async () => {
    // 20 skills adopted into the same 2 repos: 40 adoptions, 2 reads.
    const adoptions = Array.from({ length: 20 }, (_, i) => [
      adoption(`s${i}`, "acme/api", T("2026-07-01T00:00:00Z")),
      adoption(`s${i}`, "acme/web", T("2026-07-01T00:00:00Z")),
    ]).flat();
    mockAdoptions.mockResolvedValue(adoptions);
    const state = trackingHistory();

    await getOrgSkillOutcomes("acme");

    expect(state.calls.sort()).toEqual(["acme/api", "acme/web"]);
  });

  it("reads nothing at all when nothing has been adopted", async () => {
    mockAdoptions.mockResolvedValue([]);
    const state = trackingHistory();
    expect(await getOrgSkillOutcomes("acme")).toEqual({});
    expect(state.calls).toHaveLength(0);
  });
});

describe("getOrgSkillOutcomes — results are unchanged by the bound", () => {
  it("pairs each adoption against its own repo's history (no cross-repo leakage from pooling)", async () => {
    mockAdoptions.mockResolvedValue([
      adoption("s1", "acme/api", T("2026-06-15T00:00:00Z")),
      adoption("s1", "acme/web", T("2026-06-15T00:00:00Z")),
    ]);
    trackingHistory((fullName) =>
      fullName === "acme/api"
        ? [
            { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40 },
            { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55 },
          ]
        : [{ id: "w1", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 80 }],
    );

    const out = await getOrgSkillOutcomes("acme");
    const byRepo = Object.fromEntries(out.s1!.map((o) => [o.repoFullName, o]));
    expect(byRepo["acme/api"]!.status).toBe("measured");
    expect(byRepo["acme/api"]!.overallDelta).toBe(15);
    // The web repo has no scan BEFORE the adoption — an honest gap, never a fabricated 0.
    expect(byRepo["acme/web"]!.status).toBe("no-before-scan");
    expect(byRepo["acme/web"]!.overallDelta).toBeNull();
  });

  it("one failing repo costs only its own outcomes, never the whole pool", async () => {
    mockAdoptions.mockResolvedValue([
      adoption("s1", "acme/api", T("2026-06-15T00:00:00Z")),
      adoption("s1", "acme/boom", T("2026-06-15T00:00:00Z")),
    ]);
    mockHistory.mockImplementation(async (owner: string, name: string) => {
      if (name === "boom") throw new Error("db exploded");
      return {
        repo: { owner, name, fullName: `${owner}/${name}` },
        scans: [
          { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40, ...INSTRUMENT },
          { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55, ...INSTRUMENT },
        ],
      };
    });

    const out = await getOrgSkillOutcomes("acme");
    const byRepo = Object.fromEntries(out.s1!.map((o) => [o.repoFullName, o]));
    expect(byRepo["acme/api"]!.overallDelta).toBe(15);
    expect(byRepo["acme/boom"]!.status).toBe("no-before-scan");
  });

  it("skips a malformed repo full name without issuing a read", async () => {
    mockAdoptions.mockResolvedValue([adoption("s1", "not-a-full-name", T("2026-06-15T00:00:00Z"))]);
    const state = trackingHistory();
    const out = await getOrgSkillOutcomes("acme");
    expect(state.calls).toHaveLength(0);
    expect(out.s1![0]!.status).toBe("no-before-scan");
  });
});

// ── The intervention outcome ledger mirror (moonshot #9) ─────────────────────────────────────────
// The ONLY status that may cross into a fact table is `measured`. Every other one is an honest gap,
// and a ledger that accepted them would be diluted by rows that measured nothing — which is exactly
// the dilution the whole table exists to prevent. That refusal is invisible in the UI (the Skills
// page renders the same either way), so it is asserted here.

describe("getOrgSkillOutcomes — ledger mirror", () => {
  it("mirrors a MEASURED outcome with its deltas, its instrument and its scan bookends", async () => {
    mockAdoptions.mockResolvedValue([adoption("s1", "acme/api", T("2026-06-15T00:00:00Z"))]);
    mockHistory.mockResolvedValue({
      repo: { owner: "acme", name: "api", fullName: "acme/api" },
      scans: [
        { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40, dimensions: [{ dimId: "D2", score: 30 }], ...INSTRUMENT },
        { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55, dimensions: [{ dimId: "D2", score: 44 }], ...INSTRUMENT },
      ],
    });

    await getOrgSkillOutcomes("acme");
    await settle();

    expect(mirrored()).toHaveLength(1);
    expect(mirrored()[0]).toMatchObject({
      orgId: "org_1",
      kind: "skill",
      identityKey: "s1",
      repoFullName: "acme/api",
      beforeScanId: "a1",
      afterScanId: "a2",
      overallDelta: 15,
      dimId: "D2",
      dimDelta: 14,
      rubricVersion: INSTRUMENT.rubricVersion,
      engineProvider: INSTRUMENT.engineProvider,
    });
  });

  it("mirrors NOTHING for instrument-mismatch — a different ruler is not a measurement", async () => {
    mockAdoptions.mockResolvedValue([adoption("s1", "acme/api", T("2026-06-15T00:00:00Z"))]);
    mockHistory.mockResolvedValue({
      repo: { owner: "acme", name: "api", fullName: "acme/api" },
      scans: [
        { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40, rubricVersion: "r5", engineProvider: "anthropic" },
        { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55, rubricVersion: "r6", engineProvider: "anthropic" },
      ],
    });

    const out = await getOrgSkillOutcomes("acme");
    await settle();

    expect(out.s1![0]!.status).toBe("instrument-mismatch");
    expect(mirrored()).toHaveLength(0);
  });

  it("mirrors NOTHING for instrument-unknown — an absent rubric is not 'the same' rubric", async () => {
    mockAdoptions.mockResolvedValue([adoption("s1", "acme/api", T("2026-06-15T00:00:00Z"))]);
    mockHistory.mockResolvedValue({
      repo: { owner: "acme", name: "api", fullName: "acme/api" },
      scans: [
        { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40 },
        { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55 },
      ],
    });

    const out = await getOrgSkillOutcomes("acme");
    await settle();

    expect(out.s1![0]!.status).toBe("instrument-unknown");
    expect(mirrored()).toHaveLength(0);
  });

  it("mirrors NOTHING for a one-sided pair, and mirrors only the measured half of a mixed set", async () => {
    mockAdoptions.mockResolvedValue([
      adoption("s1", "acme/api", T("2026-06-15T00:00:00Z")),
      adoption("s1", "acme/web", T("2026-06-15T00:00:00Z")),
    ]);
    mockHistory.mockImplementation(async (owner: string, name: string) => ({
      repo: { owner, name, fullName: `${owner}/${name}` },
      scans:
        name === "api"
          ? [
              { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40, ...INSTRUMENT },
              { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55, ...INSTRUMENT },
            ]
          : [{ id: "w1", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 80, ...INSTRUMENT }],
    }));

    await getOrgSkillOutcomes("acme");
    await settle();

    expect(mirrored().map((i) => i.repoFullName)).toEqual(["acme/api"]);
  });

  it("records nothing — and never throws — when the org cannot be resolved", async () => {
    mockResolveOrgId.mockResolvedValue(null);
    mockAdoptions.mockResolvedValue([adoption("s1", "acme/api", T("2026-06-15T00:00:00Z"))]);
    mockHistory.mockResolvedValue({
      repo: { owner: "acme", name: "api", fullName: "acme/api" },
      scans: [
        { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40, ...INSTRUMENT },
        { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55, ...INSTRUMENT },
      ],
    });

    await expect(getOrgSkillOutcomes("acme")).resolves.toBeTruthy();
    await settle();
    expect(mockRecordOutcomes).not.toHaveBeenCalled();
  });

  it("a failing ledger write never costs the page its outcomes", async () => {
    mockRecordOutcomes.mockRejectedValue(new Error("ledger down"));
    mockAdoptions.mockResolvedValue([adoption("s1", "acme/api", T("2026-06-15T00:00:00Z"))]);
    mockHistory.mockResolvedValue({
      repo: { owner: "acme", name: "api", fullName: "acme/api" },
      scans: [
        { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40, ...INSTRUMENT },
        { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55, ...INSTRUMENT },
      ],
    });

    const out = await getOrgSkillOutcomes("acme");
    await settle();
    expect(out.s1![0]!.overallDelta).toBe(15);
  });
});
