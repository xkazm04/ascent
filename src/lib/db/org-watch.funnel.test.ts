// The FUNNEL ORG'S IDENTITY, as this module's writer applies it.
//
// `Organization.kind` is the tenant-flavor column, and `kind: "public"` is what marks the shared
// anonymous funnel. It is not decoration: the LLM usage ledger's "do not meter this org" decision
// reads the KIND, not the slug (usage-events.ts `UNMETERED_ORG_KIND`, UAT MC-B20 — the decision used
// to be `orgSlug === "public"` as a string, so a tenant on that slug burned inference and showed $0
// forever). `ensureOrgId` (scans-shared.ts, RC3-N1) therefore stamps the funnel row on create AND
// repairs an existing unstamped one, because the schema defaults `kind` to "org" and an unstamped
// funnel gets METERED.
//
// Six writers can materialize an Organization row. This one — the watch path — already knew the slug
// was special enough to rename ("Public Scans") and did not stamp the kind, so on a deployment where
// a repo is watched under the funnel before anything is scanned, the funnel row lands as "org" and
// stays there until some later scan repairs it. Everything in that window is ledgered as a tenant's
// usage. This file pins the half that was missing.
//
// Sibling theme file of org-watch.test.ts (701 LOC), per AGENTS.md's split rule.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));
vi.mock("@/lib/db/org-shared", () => ({
  segmentScope: () => ({}),
  getOrgBySlug: vi.fn(async () => ({ id: "org_1" })),
}));

import { setRepoWatch } from "./org-watch";

interface UpsertArgs {
  where?: unknown;
  update?: Record<string, unknown>;
  create?: Record<string, unknown>;
}

let orgUpserts: UpsertArgs[];

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
  orgUpserts = [];
  mockGetPrisma.mockReturnValue({
    organization: {
      upsert: vi.fn(async (args: UpsertArgs) => {
        orgUpserts.push(args);
        return { id: "org_1" };
      }),
    },
    repository: { upsert: vi.fn(async () => ({ id: "repo_1" })) },
  });
});

const REPO = { owner: "acme", name: "web", fullName: "acme/web", url: "https://github.com/acme/web" };

describe("ensureOrg stamps the funnel org's kind", () => {
  it("creates the shared funnel org as kind:public, not the schema default", async () => {
    await setRepoWatch("public", REPO, true);
    expect(orgUpserts).toHaveLength(1);
    // The ledger's skip decision reads this column. Without it the anonymous funnel is metered as a
    // tenant until some later scan's ensureOrgId repairs the row.
    expect(orgUpserts[0]!.create).toMatchObject({ slug: "public", kind: "public" });
  });

  it("still names it 'Public Scans' — the half that was already right", async () => {
    await setRepoWatch("public", REPO, true);
    expect(orgUpserts[0]!.create).toMatchObject({ name: "Public Scans", plan: "free" });
  });

  it("does NOT stamp a real tenant, whatever it is called", async () => {
    await setRepoWatch("acme", REPO, true);
    expect(orgUpserts[0]!.create).toMatchObject({ slug: "acme", name: "acme", plan: "free" });
    expect(orgUpserts[0]!.create).not.toHaveProperty("kind");
  });

  it("leaves an EXISTING row alone — repair stays the scan path's job, not the watch path's", async () => {
    // `update: {}` is deliberate. ensureOrgId (scans-shared.ts) owns the repair of a legacy unstamped
    // funnel row, because it is the hot path every scan already goes through; duplicating an
    // updateMany here would add a write to every watch toggle to fix a row the next scan fixes anyway.
    // What this writer owes is not creating the problem in the first place.
    await setRepoWatch("public", REPO, true);
    expect(orgUpserts[0]!.update).toEqual({});
  });
});
