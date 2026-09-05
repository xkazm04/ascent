// Direction 8 — `resolvedKeys` dual-matches passport blocker keys.
//
// The passports UI now records a decision under the blocker's MINTED FINDING ID
// (`acme/api::auto.self-verify-gaps`), while the nav badge's finding derivation still computes the
// LEGACY text-hashed key from `getOrgPassportBlockers` (which carries no ids). Without the alias
// below, a blocker decided in the tab would keep counting in the rail badge — decided here, still red
// there. The decision row persists the blocker's `title` at decision time, so the legacy key it WOULD
// have had is recomputable, and a resolved decision registers under both spellings.
//
// The safety argument, pinned here: adding a key can only make the badge stop counting something a
// human already resolved. It can never hide an UNDECIDED finding, and it must not leak across modules.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { blockerKey } from "@/lib/org/findings";

interface Row {
  orgId: string;
  module: string;
  itemKey: string;
  status: string;
  rationale: string;
  title: string;
  decidedBy: string | null;
  snoozedUntil: Date | null;
  updatedAt: Date;
}

const store: Row[] = [];

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    orgDecision: {
      findMany: vi.fn(async ({ where }: { where: { orgId: string; module?: string } }) =>
        store.filter((r) => r.orgId === where.orgId && (!where.module || r.module === where.module)),
      ),
    },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({
  getOrgBySlug: async (slug: string) => (slug === "acme" ? { id: "org_1", slug: "acme" } : null),
  normalizeOrgSlug: (s: string) => s.trim().toLowerCase(),
}));
vi.mock("@/lib/db/org-memory", () => ({ createOrgMemory: async () => null }));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: async () => undefined }));

const { resolvedKeys } = await import("@/lib/db/org-decisions");

const BLOCKER = "Agent can't self-verify (missing lint, test).";

function row(over: Partial<Row> = {}): Row {
  return {
    orgId: "org_1",
    module: "passports",
    itemKey: "acme/api::auto.self-verify-gaps",
    status: "accepted",
    rationale: "we ship without lint",
    title: BLOCKER,
    decidedBy: "alice",
    snoozedUntil: null,
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  store.length = 0;
});

describe("resolvedKeys — passport blocker dual-match", () => {
  it("registers an id-keyed decision under BOTH the id key and the legacy prose key", async () => {
    store.push(row());
    const keys = (await resolvedKeys("acme"))!.get("passports")!;
    expect(keys.has("acme/api::auto.self-verify-gaps")).toBe(true);
    expect(keys.has(blockerKey("acme/api", BLOCKER))).toBe(true);
  });

  it("does NOT register anything for an UNRESOLVED decision", async () => {
    store.push(row({ status: "open" }));
    expect((await resolvedKeys("acme")).get("passports")).toBeUndefined();
  });

  it("adds no alias when the decision carries no title (nothing to recompute from)", async () => {
    store.push(row({ title: "   " }));
    const keys = (await resolvedKeys("acme"))!.get("passports")!;
    expect([...keys]).toEqual(["acme/api::auto.self-verify-gaps"]);
  });

  it("leaves other modules alone — the alias is passport-specific", async () => {
    store.push(row({ module: "security", itemKey: "acme/api::branch-protection", title: "Branch protection" }));
    const keys = (await resolvedKeys("acme"))!.get("security")!;
    expect([...keys]).toEqual(["acme/api::branch-protection"]);
  });

  it("scopes the alias to the deciding repo, never another one", async () => {
    store.push(row());
    const keys = (await resolvedKeys("acme"))!.get("passports")!;
    expect(keys.has(blockerKey("acme/web", BLOCKER))).toBe(false);
  });

  it("an EXPIRED snooze stays unresolved, so neither spelling is registered", async () => {
    store.push(row({ status: "snoozed", snoozedUntil: new Date("2020-01-01") }));
    expect((await resolvedKeys("acme", new Date("2026-09-05"))).get("passports")).toBeUndefined();
  });
});
