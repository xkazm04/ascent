// The `passports` nav badge used to buy a full unscoped getOrgRollup — per-repo latest scan WITH its
// dimension rows, governance/techStack/passport parsing, plus two unbounded scan.findMany sweeps — and
// then read exactly one field off it. Because the badge renders in the org SHELL, every tab paid for it.
//
// getOrgPassportBlockers is the narrow replacement. Two properties matter and neither is visible in the
// UI, which is why they are pinned here: the query must stay SCAN-FREE (a scan join creeping back in
// would silently restore most of the cost), and the blocker list must stay IDENTICAL to what the rollup
// produced (same repo set, same override composition, both readiness axes) — a cheaper query that
// changes the badge number is not an optimization, it is a bug.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { getOrgPassportBlockers } from "@/lib/db/org-nav-counts";

type Where = Record<string, unknown>;
type RepoRow = { fullName: string; passportJson: string | null; passportOverridesJson: string | null };

/** A stored passport blob shaped enough for parsePassportJson's guard, carrying real blockers. */
function passportJson(automation: string[], production: string[]): string {
  return JSON.stringify({
    passport: "app-passport",
    passportVersion: "1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generatedBy: "test",
    identity: { name: "r", slug: "r", purpose: "p", archetype: "team", visibility: "public", license: null },
    stack: { languages: [], frameworks: [], persistence: [] },
    automationReadiness: { grade: "C", score: 50, blockers: automation },
    productionReadiness: { grade: "C", score: 50, blockers: production },
  });
}

function fakePrisma(rows: RepoRow[], org: { id: string } | null = { id: "org_1" }) {
  const calls = { repoFindMany: [] as { where: Where; select: Record<string, unknown> }[] };
  return {
    calls,
    client: {
      organization: { findUnique: vi.fn(async () => org) },
      repository: {
        findMany: vi.fn(async (args: { where: Where; select: Record<string, unknown> }) => {
          calls.repoFindMany.push(args);
          return rows;
        }),
      },
    },
  };
}

describe("getOrgPassportBlockers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty list for an unknown org instead of throwing the shell", async () => {
    const fake = fakePrisma([], null);
    mockGetPrisma.mockReturnValue(fake.client);
    expect(await getOrgPassportBlockers("nope")).toEqual([]);
  });

  it("reads NO scan data — the whole point of not calling getOrgRollup", async () => {
    const fake = fakePrisma([]);
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgPassportBlockers("acme");

    expect(fake.calls.repoFindMany).toHaveLength(1); // one query, not a per-repo fan-out
    const select = fake.calls.repoFindMany[0]!.select;
    expect(Object.keys(select).sort()).toEqual(["fullName", "passportJson", "passportOverridesJson"]);
    expect(select).not.toHaveProperty("scans");
  });

  it("mirrors getOrgRollup's repo set (watched OR has-scans) so the badge counts the same repos", async () => {
    const fake = fakePrisma([]);
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgPassportBlockers("acme");

    expect(fake.calls.repoFindMany[0]!.where).toEqual({
      orgId: "org_1",
      OR: [{ watched: true }, { scans: { some: {} } }],
    });
  });

  it("concatenates BOTH readiness axes — a blocker on either one is a finding", async () => {
    const fake = fakePrisma([
      { fullName: "acme/a", passportJson: passportJson(["no CI"], ["no runbook"]), passportOverridesJson: null },
    ]);
    mockGetPrisma.mockReturnValue(fake.client);

    expect(await getOrgPassportBlockers("acme")).toEqual([{ fullName: "acme/a", blockers: ["no CI", "no runbook"] }]);
  });

  it("drops repos with no passport, and a malformed blob, rather than badging a phantom", async () => {
    const fake = fakePrisma([
      { fullName: "acme/none", passportJson: null, passportOverridesJson: null },
      { fullName: "acme/broken", passportJson: "{not json", passportOverridesJson: null },
      { fullName: "acme/wrong-shape", passportJson: JSON.stringify({ hello: "world" }), passportOverridesJson: null },
      { fullName: "acme/ok", passportJson: passportJson(["no CI"], []), passportOverridesJson: null },
    ]);
    mockGetPrisma.mockReturnValue(fake.client);

    const out = await getOrgPassportBlockers("acme");
    expect(out.map((r) => r.fullName)).toEqual(["acme/ok"]);
  });
});
