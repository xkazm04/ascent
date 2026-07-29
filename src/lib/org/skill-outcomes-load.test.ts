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

const { mockHistory, mockAdoptions } = vi.hoisted(() => ({ mockHistory: vi.fn(), mockAdoptions: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getRepositoryHistory: mockHistory,
  listOrgSkillAdoptionRows: mockAdoptions,
}));

import { getOrgSkillOutcomes, HISTORY_CONCURRENCY } from "./skill-outcomes-load";

const T = (iso: string) => new Date(iso).toISOString();

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
    return { repo: { owner, name, fullName }, scans: scansFor(fullName) };
  });
  return state;
}

const adoption = (skillId: string, repoFullName: string, adoptedAt: string) => ({ skillId, repoFullName, adoptedAt });

beforeEach(() => {
  vi.clearAllMocks();
});

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
          { id: "a1", scannedAt: T("2026-06-01T00:00:00Z"), overallScore: 40 },
          { id: "a2", scannedAt: T("2026-07-01T00:00:00Z"), overallScore: 55 },
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
