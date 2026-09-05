// The UsageEvent writer + readers. Prisma is mocked; a fakePrisma captures the query shapes so the
// three properties that actually matter are pinned:
//   - the write is BEST-EFFORT: off when persistence is off, skipped for an unknown org, and a P2002
//     on `idemKey` (the at-least-once retry collision the unique index exists to absorb) is swallowed;
//   - `laneTotals` buckets over the HALF-OPEN window and reports `unpricedCalls` per lane;
//   - `teamTotals` keeps a team-less event in the explicit org-wide bucket instead of dropping it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured, mockGetOrgId } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => true),
  mockGetOrgId: vi.fn(async (slug: string) => (slug === "acme" ? "org_acme" : null)),
}));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import {
  ORG_WIDE_TEAM_LABEL,
  defaultOwnerTeamForRepo,
  laneTotals,
  recordUsageEvent,
  teamTotals,
} from "@/lib/db/usage-events";
import type { UsageEventInput } from "@/lib/llm/meter";

type Args = Record<string, unknown>;

function fakePrisma(
  opts: {
    createThrows?: unknown;
    groups?: Args[];
    unpriced?: Args[];
    teams?: Args[];
    /** The org row `recordUsageEvent` resolves. `null` = no such org. */
    org?: { id: string; kind: string } | null;
    /** The repo row `defaultOwnerTeamForRepo` resolves. */
    repo?: { teams: { slug: string }[] } | null;
  } = {},
) {
  const calls = { create: [] as Args[], groupBy: [] as Args[], repoFindFirst: [] as Args[] };
  const usageEvent = {
    create: vi.fn(async (args: Args) => {
      calls.create.push(args);
      if (opts.createThrows) throw opts.createThrows;
      return { id: "ue_1" };
    }),
    groupBy: vi.fn(async (args: Args) => {
      calls.groupBy.push(args);
      const by = (args.by as string[])[0];
      if (by === "teamKey") return opts.teams ?? [];
      const where = args.where as Args;
      return "costMicros" in where ? (opts.unpriced ?? []) : (opts.groups ?? []);
    }),
  };
  const organization = {
    findUnique: vi.fn(async (args: Args) => {
      const where = args.where as { slug: string };
      if (opts.org !== undefined) return opts.org;
      return where.slug === "acme" ? { id: "org_acme", kind: "org" } : null;
    }),
  };
  const repository = {
    findFirst: vi.fn(async (args: Args) => {
      calls.repoFindFirst.push(args);
      return opts.repo ?? null;
    }),
  };
  mockGetPrisma.mockReturnValue({ usageEvent, organization, repository });
  return calls;
}

const EVENT: UsageEventInput = {
  orgSlug: "acme",
  lane: "athena",
  legKind: "athena_turn",
  refId: null,
  provider: "gemini",
  model: "gemini-3.7-flash",
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  costMicros: 375,
  status: "success",
  idemKey: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgId.mockImplementation(async (slug: string) => (slug === "acme" ? "org_acme" : null));
});

describe("recordUsageEvent", () => {
  it("no-ops when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const calls = fakePrisma();
    await recordUsageEvent(EVENT);
    expect(calls.create).toHaveLength(0);
  });

  it("skips an event whose org slug matches no row rather than inventing an owner", async () => {
    const calls = fakePrisma();
    await recordUsageEvent({ ...EVENT, orgSlug: "ghost" });
    expect(calls.create).toHaveLength(0);
  });

  // MC-B20 (VICTOR-L2-01): the "do not meter this org" decision used to be `orgSlug === "public"` in
  // meter(), so a TENANT on that slug burned inference and showed $0 forever, silently. It is now a
  // property of the org ROW, asked where the row is actually known.
  it("does not ledger the anonymous funnel - decided from the org row kind, not its slug", async () => {
    const calls = fakePrisma({ org: { id: "org_funnel", kind: "public" } });
    await recordUsageEvent({ ...EVENT, orgSlug: "public" });
    expect(calls.create).toHaveLength(0);
  });

  it("DOES ledger a tenant whose slug happens to be public", async () => {
    const calls = fakePrisma({ org: { id: "org_tenant", kind: "org" } });
    await recordUsageEvent({ ...EVENT, orgSlug: "public" });
    expect(calls.create).toHaveLength(1);
    expect(((calls.create[0]!.data ?? {}) as Args).orgId).toBe("org_tenant");
  });

  it("resolves the slug to an org id and writes the honest nulls through", async () => {
    const calls = fakePrisma();
    await recordUsageEvent({ ...EVENT, inputTokens: null, outputTokens: null, costMicros: null });
    expect(calls.create).toHaveLength(1);
    const data = (calls.create[0]!.data ?? {}) as Args;
    expect(data.orgId).toBe("org_acme");
    expect(data.lane).toBe("athena");
    expect(data.inputTokens).toBeNull();
    expect(data.costMicros).toBeNull();
  });

  it("swallows the P2002 a retried write hits on idemKey — no double count, no throw", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    fakePrisma({ createThrows: p2002 });
    await expect(recordUsageEvent({ ...EVENT, idemKey: "local:lane_7" })).resolves.toBeUndefined();
  });
});

describe("laneTotals", () => {
  it("buckets by lane over the half-open window and reports unpriced calls", async () => {
    const calls = fakePrisma({
      groups: [
        { lane: "athena", _count: 4, _sum: { inputTokens: 400, outputTokens: 80, costMicros: 1_500 } },
        { lane: "memory", _count: 2, _sum: { inputTokens: null, outputTokens: null, costMicros: null } },
        { lane: "not-a-lane", _count: 9, _sum: { inputTokens: 1, outputTokens: 1, costMicros: 1 } },
      ],
      unpriced: [{ lane: "memory", _count: 2 }],
    });
    const since = new Date("2026-08-01T00:00:00Z");
    const before = new Date("2026-08-30T00:00:00Z");
    const rows = await laneTotals("acme", since, before);

    // Half-open: `gte` on the lower bound, `lt` on the upper — the same bounds the summary uses.
    const where = calls.groupBy[0]!.where as { createdAt: { gte: Date; lt: Date } };
    expect(where.createdAt.gte).toBe(since);
    expect(where.createdAt.lt).toBe(before);

    // MC-B31: a lane string this build does not know is FOLDED into an explicit `unknown` bucket, not
    // dropped - teamTotals counts those same rows, and two panels on one page must not disagree about
    // the period call total with nothing on screen to explain the gap.
    expect(rows.map((r) => r.lane)).toEqual(["athena", "memory", "unknown"]);
    expect(rows[0]).toMatchObject({ calls: 4, estimatedCostUsd: 0.0015, unpricedCalls: 0 });
    // A lane nothing could price reports null cost + null tokens, NEVER 0.
    expect(rows[1]).toMatchObject({ calls: 2, inputTokens: null, estimatedCostUsd: null, unpricedCalls: 2 });
    expect(rows[2]).toMatchObject({ calls: 9, estimatedCostUsd: 0.000001 });
  });

  it("folds EVERY unrecognized lane into one bucket, and unknown + known cost stays unknown", async () => {
    fakePrisma({
      groups: [
        { lane: "from-the-future", _count: 3, _sum: { inputTokens: 30, outputTokens: 3, costMicros: 2_000 } },
        { lane: "rolled-back", _count: 2, _sum: { inputTokens: null, outputTokens: null, costMicros: null } },
      ],
      unpriced: [{ lane: "rolled-back", _count: 2 }],
    });
    const rows = await laneTotals("acme", new Date(0), new Date(1));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lane: "unknown",
      calls: 5,
      inputTokens: 30,
      estimatedCostUsd: null, // half of it could not be priced, so the fold refuses to state a total
      unpricedCalls: 2,
    });
  });

  it("returns nothing for an unknown org", async () => {
    fakePrisma();
    expect(await laneTotals("ghost", new Date(0), new Date(1))).toEqual([]);
  });
});

describe("teamTotals", () => {
  it("keeps a team-less event in the explicit org-wide bucket instead of dropping it", async () => {
    fakePrisma({
      teams: [
        { teamKey: "@acme/platform", _count: 3, _sum: { costMicros: 2_000 } },
        { teamKey: null, _count: 5, _sum: { costMicros: null } },
      ],
    });
    const rows = await teamTotals("acme", new Date(0), new Date(1));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ teamKey: null, label: ORG_WIDE_TEAM_LABEL, calls: 5, estimatedCostUsd: null });
  });
});

// MC-B19 (VICTOR-L1-04): the lanes that know their repo never resolved its owning team, so "Spend by
// team" read 100 % org-wide for every non-scan lane while the scan lane split reported real teams.
describe("defaultOwnerTeamForRepo", () => {
  it("returns the repo CODEOWNERS default owner, scoped to the org", async () => {
    const calls = fakePrisma({ repo: { teams: [{ slug: "@acme/platform" }] } });
    expect(await defaultOwnerTeamForRepo("acme", "acme/api")).toBe("@acme/platform");
    const where = calls.repoFindFirst[0]!.where as { orgId: string; fullName: string };
    expect(where).toEqual({ orgId: "org_acme", fullName: "acme/api" });
  });

  it("a repo with no default owner is org-wide (null), not an error", async () => {
    fakePrisma({ repo: { teams: [] } });
    expect(await defaultOwnerTeamForRepo("acme", "acme/api")).toBeNull();
  });

  it("an unknown org or an empty repo name resolves to null without querying", async () => {
    const calls = fakePrisma();
    expect(await defaultOwnerTeamForRepo("ghost", "ghost/api")).toBeNull();
    expect(await defaultOwnerTeamForRepo("acme", "")).toBeNull();
    expect(calls.repoFindFirst).toHaveLength(0);
  });
});
