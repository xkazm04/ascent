// GET /api/recommendations — the `expectedLift` contract (moonshot #9).
//
// Two things here are worth a test and neither is visible in the response of a fresh org, which is
// exactly why they rot silently:
//   1. `expectedLift` is NULL where nothing has been measured. A `0` would tell every client "we
//      measured closing this gap and it moved nothing" — a finding nobody made (G4).
//   2. `sort=measured` over an EMPTY ledger does not reorder. Re-ranking a list by evidence that does
//      not exist is a quiet lie, so the route falls back to the order the read layer produced and says
//      so in the `sort` field rather than reporting the sort it was asked for.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: vi.fn(() => null) }));
vi.mock("@/lib/authz", () => ({ canReadOrg: vi.fn(async () => true) }));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));
vi.mock("@/lib/db", () => ({ getLatestRecommendations: vi.fn() }));
vi.mock("@/lib/outcomes/expected-lift-load", () => ({ getOrgExpectedLifts: vi.fn() }));

import { GET } from "./route";
import { getLatestRecommendations } from "@/lib/db";
import { getOrgExpectedLifts } from "@/lib/outcomes/expected-lift-load";
import { roadmapLiftKey } from "@/components/report/roadmapPriority";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";

const rec = (id: string, title: string, dimension: string, impact: string, effort: string) =>
  ({ id, title, dimension, impact, effort, rationale: "", explore: [], status: "open" }) as never;

const ITEMS = [
  rec("r1", "adopt review checklist", "D2", "medium", "high"),
  rec("r2", "write an ADR log", "D1", "high", "low"),
  rec("r3", "pin the model version", "D3", "low", "low"),
];

const dist = (identityKey: string, medianDim: number): LiftDistribution => ({
  identityKey,
  dimId: "D2",
  n: 9,
  orgs: 1,
  medianDim,
  p25: medianDim,
  p75: medianDim,
  medianOverall: 2,
  instrument: { rubricVersion: "r10", engineProvider: "claude" },
});

const req = (qs: string) => new Request(`https://x.test/api/recommendations${qs}`);
const body = async (r: Response) => (await r.json()) as { items: { id: string; expectedLift: string | null }[]; sort: string };

beforeEach(() => {
  vi.mocked(getLatestRecommendations).mockResolvedValue({ scanId: "s1", items: ITEMS } as never);
  vi.mocked(getOrgExpectedLifts).mockResolvedValue(new Map());
});

describe("GET /api/recommendations — expectedLift", () => {
  it("attaches expectedLift: null to every item when nothing has been measured", async () => {
    const res = await GET(req("?repo=acme/web"));
    const { items } = await body(res);
    expect(items).toHaveLength(3);
    for (const it of items) expect(it.expectedLift).toBeNull();
    // …and specifically not a zero in any string form.
    expect(JSON.stringify(items)).not.toContain('"expectedLift":0');
    expect(JSON.stringify(items)).not.toContain('"+0"');
  });

  it("attaches the full basis clause — median, n and instrument together — where there is evidence", async () => {
    const key = roadmapLiftKey({ dimension: "D2" as never, title: "adopt review checklist" });
    vi.mocked(getOrgExpectedLifts).mockResolvedValue(new Map([[key, dist(key, 11)]]));
    const { items } = await body(await GET(req("?repo=acme/web")));
    const measured = items.find((i) => i.id === "r1")!;
    expect(measured.expectedLift).toContain("+11 median");
    expect(measured.expectedLift).toContain("9 measured closes");
    expect(measured.expectedLift).toContain("r10");
    expect(items.find((i) => i.id === "r2")!.expectedLift).toBeNull();
  });
});

describe("GET /api/recommendations — ?sort=measured", () => {
  it("with no ledger rows returns the read layer's order and reports sort: priority", async () => {
    const { items, sort } = await body(await GET(req("?repo=acme/web&sort=measured")));
    expect(sort).toBe("priority");
    expect(items.map((i) => i.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("reorders only when something is measured, and reports the sort it actually applied", async () => {
    const key = roadmapLiftKey({ dimension: "D2" as never, title: "adopt review checklist" });
    vi.mocked(getOrgExpectedLifts).mockResolvedValue(new Map([[key, dist(key, 16)]]));
    const { items, sort } = await body(await GET(req("?repo=acme/web&sort=measured")));
    expect(sort).toBe("measured");
    // The high-impact unmeasured item still leads: measurement re-orders inside the impact band.
    expect(items[0]!.id).toBe("r2");
    // …and the measured medium-impact gap is lifted above the unmeasured low-impact one.
    expect(items.map((i) => i.id)).toEqual(["r2", "r1", "r3"]);
  });

  it("ignores an unknown sort value rather than erroring", async () => {
    const { sort } = await body(await GET(req("?repo=acme/web&sort=banana")));
    expect(sort).toBe("priority");
  });

  it("still requires a repo, and reports an empty result honestly", async () => {
    expect((await GET(req(""))).status).toBe(400);
    vi.mocked(getLatestRecommendations).mockResolvedValue(null as never);
    const res = await GET(req("?repo=acme/web"));
    expect(await res.json()).toEqual({ scanId: null, items: [], sort: "priority" });
  });
});
