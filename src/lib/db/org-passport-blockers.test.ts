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

    // `findings` rides along (card ai-native-passports#A): the badge keys a blocker on its minted id.
    // This stored row predates 0.4.0, so `upgradePassport` back-fills positional `unclassified` ids —
    // ids `passportJudgmentKey` refuses to key on, so these two keep the legacy prose key.
    expect(await getOrgPassportBlockers("acme")).toEqual([
      {
        fullName: "acme/a",
        blockers: ["no CI", "no runbook"],
        findings: [
          { id: "auto.unclassified.0", text: "no CI" },
          { id: "prod.unclassified.0", text: "no runbook" },
        ],
      },
    ]);
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

// ── The badge reads the ONE judgment key (card ai-native-passports#A, challenge-2026-09-23) ──────────
//
// The drawer writes a passport decision under the minted-id key (`acme/api::auto.self-verify-gaps`).
// The badge used to be fed blockers with NO findings, so it keyed on a hash of the CURRENT sentence and
// bridged to the id key only through `resolvedKeys`' alias, which hashes the decision's stored TITLE —
// the sentence as it was on decision day. The self-verify blocker interpolates the missing-script list,
// so the day a repo added one script the alias went stale and the decided blocker was back in the rail
// badge while the drawer still showed it Dismissed.

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/org/security", () => ({ buildSecurityOverview: async () => null }));

const SV_OLD = "Agent can't self-verify: missing build, lint script(s).";
const SV_NEW = "Agent can't self-verify: missing build script(s).";

function currentPassportJson(autoText: string): string {
  const pp = JSON.parse(passportJson([autoText], [])) as Record<string, Record<string, unknown>>;
  pp.passportVersion = "0.4.0" as unknown as Record<string, unknown>;
  pp.automationReadiness!.findings = [{ id: "auto.self-verify-gaps", code: "self-verify-gaps", text: autoText, severity: "block" }];
  pp.productionReadiness!.findings = [];
  return JSON.stringify(pp);
}

function badgePrisma(decisions: { itemKey: string; title: string; status: string }[]) {
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme" })) },
    repository: {
      findMany: vi.fn(async () => [
        { fullName: "acme/api", passportJson: currentPassportJson(SV_NEW), passportOverridesJson: null },
      ]),
    },
    orgDecision: {
      findMany: vi.fn(async () =>
        decisions.map((d) => ({
          module: "passports",
          rationale: "we ship without lint",
          decidedBy: "alice",
          snoozedUntil: null,
          updatedAt: new Date("2026-09-01T00:00:00Z"),
          ...d,
        })),
      ),
    },
  };
}

describe("passports badge — decision key stability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getOrgPassportBlockers carries the minted findings[] per repo", async () => {
    mockGetPrisma.mockReturnValue(badgePrisma([]));
    const [r] = await getOrgPassportBlockers("acme");
    expect(r!.findings).toEqual([{ id: "auto.self-verify-gaps", text: SV_NEW }]);
  });

  it("a blocker dismissed under its id key stays decided after its sentence is reworded", async () => {
    mockGetPrisma.mockReturnValue(
      badgePrisma([{ itemKey: "acme/api::auto.self-verify-gaps", title: SV_OLD, status: "dismissed" }]),
    );
    const { getOrgFindingCounts } = await import("@/lib/org/nav-counts");
    expect((await getOrgFindingCounts("acme")).passports).toBe(0);
  });

  it("guard: an undecided blocker is still counted", async () => {
    mockGetPrisma.mockReturnValue(badgePrisma([]));
    const { getOrgFindingCounts } = await import("@/lib/org/nav-counts");
    expect((await getOrgFindingCounts("acme")).passports).toBe(1);
  });

  it("guard: a decision stored under the legacy prose key of the CURRENT sentence still resolves in the badge", async () => {
    const { blockerKey } = await import("@/lib/org/findings");
    // Title deliberately blank, so the resolvedKeys title alias cannot be what matches it.
    mockGetPrisma.mockReturnValue(badgePrisma([{ itemKey: blockerKey("acme/api", SV_NEW), title: "", status: "accepted" }]));
    const { getOrgFindingCounts } = await import("@/lib/org/nav-counts");
    expect((await getOrgFindingCounts("acme")).passports).toBe(0);
  });
});
