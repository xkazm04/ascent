// A READ MUST NOT SEED (moonshot #8).
//
// `listOrgAdmissions` was a plain `findMany` over `RepoAdmission`, and nothing in the product writes
// those rows on the path a person takes: the lazy seed in `getRepoAdmission` is reached only from the
// gate, /admission/propose, /admission/ruleset and the MCP tools. So an org that had never called a
// gate opened the Governance tab, saw "no repository has an admission decision yet", and had no repo
// to click — the decision layer was reachable only after some other surface incidentally seeded it.
//
// The fix is the tracked repository set with the derived state computed IN MEMORY. Both halves are
// asserted here: the list covers every tracked repo, and reading it issues no write. The second is
// the one that would rot silently — a `create` slipped back into this path would still make the column
// look right, while a page view manufactured a decision-shaped row for every repository an org owns.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async (slug: string) => (slug === "acme" ? { id: "org1" } : null)) }));

import { deriveRepoAdmission, getRepoAdmission, listOrgAdmissions, readRepoAdmission } from "./org-admission";
import { deriveAutonomyForStored, parsePassportJson } from "@/lib/analyze/passport";

/** A stored passport the parser accepts. Only the fields it demands — the TIER is not asserted from
 *  here: `derivedTierFor` re-derives through `deriveAutonomyForStored` rather than reading
 *  `autonomy.tier`, precisely so a row written before that block existed resolves like every other
 *  surface. The expectation below runs the same resolver, so the test pins the SHARED path. */
const passport = () =>
  JSON.stringify({
    passport: "app-passport",
    identity: { name: "x" },
    automationReadiness: {},
    productionReadiness: {},
    evidence: { source: "github tree" },
  });

/** What the shared resolver says about that passport — the tier the list must carry. */
const RESOLVED_TIER = deriveAutonomyForStored(parsePassportJson(passport())!).tier;

const admissionRow = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  repoFullName: "acme/billing",
  stanceVersion: 4,
  derivedTier: "T1",
  grantedTier: "T3",
  mode: "agents-allowed",
  decidedBy: "octocat",
  decidedAt: new Date("2026-08-30T00:00:00.000Z"),
  rationale: "mature suite",
  rulesetId: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-30T00:00:00.000Z"),
  ...over,
});

const create = vi.fn();
const upsert = vi.fn();

function prismaWith(repos: { fullName: string; passportJson: string | null }[], admissions: Record<string, unknown>[]) {
  return {
    repository: { findMany: vi.fn(async () => repos), findFirst: vi.fn(async () => repos[0] ?? null) },
    repoAdmission: { findMany: vi.fn(async () => admissions), findFirst: vi.fn(async () => null), create, upsert },
    orgAiStance: { findFirst: vi.fn(async () => ({ version: 7 })) },
  };
}

beforeEach(() => {
  create.mockReset();
  upsert.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("listOrgAdmissions — the org's tracked repositories, decided or not", () => {
  it("returns a derived view for every tracked repo when NOT ONE decision row exists", async () => {
    mockGetPrisma.mockReturnValue(
      prismaWith(
        [
          { fullName: "acme/web", passportJson: passport() },
          { fullName: "acme/api", passportJson: null },
        ],
        [],
      ),
    );

    const rows = await listOrgAdmissions("acme");

    expect(rows.map((r) => r.repoFullName)).toEqual(["acme/api", "acme/web"]);
    // The passport-bearing repo carries the measurement, copied to the grant exactly as the seed would.
    expect(rows[1]).toMatchObject({ derivedTier: RESOLVED_TIER, grantedTier: RESOLVED_TIER, mode: "assisted-only", decidedBy: null });
    // The HONEST NULL survives: no passport means no tier, never "T0 as measured".
    expect(rows[0]).toMatchObject({ derivedTier: null, decidedBy: null });
    // Every derived row is stamped with the ACTIVE stance, so an unwritten row can never read as stale.
    expect(rows.every((r) => r.stanceVersion === 7)).toBe(true);
  });

  it("WRITES NOTHING — a read that seeded would manufacture a decision row per page view", async () => {
    mockGetPrisma.mockReturnValue(prismaWith([{ fullName: "acme/web", passportJson: passport() }], []));
    await listOrgAdmissions("acme");
    expect(create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("overlays a stored decision on the derived one, and never returns both", async () => {
    mockGetPrisma.mockReturnValue(
      prismaWith(
        [
          { fullName: "acme/billing", passportJson: passport() },
          { fullName: "acme/web", passportJson: passport() },
        ],
        [admissionRow()],
      ),
    );

    const rows = await listOrgAdmissions("acme");

    expect(rows).toHaveLength(2);
    const billing = rows.find((r) => r.repoFullName === "acme/billing")!;
    expect(billing).toMatchObject({ id: "a1", grantedTier: "T3", derivedTier: "T1", mode: "agents-allowed", decidedBy: "octocat" });
    // The DECISION's own stance version, not the active one — that difference is what "stale" means.
    expect(billing.stanceVersion).toBe(4);
    // Wire-safe: this row crosses to the Governance client, so every timestamp is an ISO string.
    expect(billing.decidedAt).toBe("2026-08-30T00:00:00.000Z");
    expect(typeof billing.createdAt).toBe("string");
  });

  it("keeps a decision whose repository the org has stopped tracking", async () => {
    // It is a record an owner made and can still withdraw. Dropping it from the only surface that can
    // withdraw it would strand the decision with no door.
    mockGetPrisma.mockReturnValue(prismaWith([{ fullName: "acme/web", passportJson: null }], [admissionRow()]));
    const rows = await listOrgAdmissions("acme");
    expect(rows.map((r) => r.repoFullName)).toEqual(["acme/billing", "acme/web"]);
  });

  it("is empty for an unknown org and without a database — never a partial fleet", async () => {
    mockGetPrisma.mockReturnValue(prismaWith([{ fullName: "acme/web", passportJson: null }], []));
    expect(await listOrgAdmissions("nope")).toEqual([]);
    mockIsDbConfigured.mockReturnValue(false);
    expect(await listOrgAdmissions("acme")).toEqual([]);
  });
});

describe("deriveRepoAdmission — the row the seed WOULD have written", () => {
  it("copies the measurement to the grant and leaves the decision unmade", () => {
    expect(deriveRepoAdmission("acme/web", "T2", 3)).toEqual({
      id: "",
      repoFullName: "acme/web",
      stanceVersion: 3,
      derivedTier: "T2",
      grantedTier: "T2",
      mode: "assisted-only",
      decidedBy: null,
      decidedAt: null,
      rationale: "",
      rulesetId: null,
      createdAt: "",
      updatedAt: "",
    });
  });

  it("never invents a tier for an unassessed repo", () => {
    const r = deriveRepoAdmission("acme/api", null, 3);
    // `grantedTier` only satisfies the non-null column; the view renders "tier not assessed" off
    // `derivedTier`, and the gate reads no row at all for such a repo.
    expect(r.derivedTier).toBeNull();
    expect(r.decidedBy).toBeNull();
  });
});

// THE GATE'S READ MUST NOT SEED EITHER (Direction 7).
//
// `resolveAdmissionLayer` is called from the ANONYMOUS `GET /api/gate`, and it went through the
// lazy-seeding `getRepoAdmission` — so an unauthenticated CI call INSERTED a row into a governance
// table. Same argument the fleet list already made, on the other caller that reaches this path
// without anybody deciding anything. This is the half that would rot silently: a `create` slipped
// back in would still return the right bar.
describe("readRepoAdmission — the non-seeding twin the gate reads through", () => {
  it("returns the row the seed WOULD have written, and WRITES NOTHING", async () => {
    mockGetPrisma.mockReturnValue(prismaWith([{ fullName: "acme/web", passportJson: passport() }], []));

    const row = await readRepoAdmission("acme", "acme/web");

    expect(row).toMatchObject({ derivedTier: RESOLVED_TIER, grantedTier: RESOLVED_TIER, mode: "assisted-only", decidedBy: null });
    expect(create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    // Nothing was written, so nothing may claim an id or a timestamp.
    expect(row!.id).toBe("");
    expect(row!.createdAt).toBe("");
  });

  it("returns a STORED decision unchanged when one exists", async () => {
    const prisma = prismaWith([{ fullName: "acme/billing", passportJson: passport() }], []);
    prisma.repoAdmission.findFirst = vi.fn(async () => admissionRow());
    mockGetPrisma.mockReturnValue(prisma);

    const row = await readRepoAdmission("acme", "acme/billing");

    expect(row).toMatchObject({ id: "a1", grantedTier: "T3", mode: "agents-allowed", decidedBy: "octocat" });
    expect(create).not.toHaveBeenCalled();
  });

  it("is null for an unassessed repo, an unknown org and without a database — exactly like the seeding reader", async () => {
    mockGetPrisma.mockReturnValue(prismaWith([{ fullName: "acme/api", passportJson: null }], []));
    expect(await readRepoAdmission("acme", "acme/api")).toBeNull();
    expect(await readRepoAdmission("nope", "acme/api")).toBeNull();
    mockIsDbConfigured.mockReturnValue(false);
    expect(await readRepoAdmission("acme", "acme/web")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("the SEEDING reader still seeds — the authenticated admission routes depend on it", async () => {
    // /admission/propose, /admission/ruleset and the MCP tools create the row when a member acts on
    // the repo. Only the two GATE surfaces moved off it.
    const prisma = prismaWith([{ fullName: "acme/web", passportJson: passport() }], []);
    create.mockResolvedValue(admissionRow({ repoFullName: "acme/web" }));
    mockGetPrisma.mockReturnValue(prisma);

    await getRepoAdmission("acme", "acme/web");

    expect(create).toHaveBeenCalledTimes(1);
  });
});
