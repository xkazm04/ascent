// The owner-settings Save must not erase an owner's declines (card ai-native-passports#A,
// challenge-2026-09-23).
//
// PassportOwnerControls POSTs { repo, criticality, lifecycle, rollback } — no `declined` — and the
// route handed that straight to `setPassportOverrides`, which REPLACED the whole blob. Every accepted
// gap on the repo, with its reason, author and baseline, vanished on an unrelated Save. The fix stops
// the erasing write: an absent `declined` keeps what is stored. Nothing is migrated or deleted, and an
// EXPLICIT `declined: {}` still clears, so the replace semantics remain reachable on purpose.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  stored: null as string | null,
  writes: [] as (string | null)[],
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    repository: {
      findUnique: vi.fn(async () => ({ passportOverridesJson: h.stored })),
      updateMany: vi.fn(async ({ data }: { data: { passportOverridesJson: string | null } }) => {
        h.writes.push(data.passportOverridesJson);
        return { count: 1 };
      }),
    },
  }),
}));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async () => "org_1" }));

const { setPassportOverrides } = await import("@/lib/db/passport-overrides");

const DECLINE = { reason: "docs mirror", code: "ci-not-gating", severity: "block", by: "alice", at: "2026-09-01" };

const written = () => JSON.parse(h.writes.at(-1) ?? "null") as Record<string, unknown> | null;

describe("setPassportOverrides — keeps the declines it was not asked about", () => {
  beforeEach(() => {
    h.writes.length = 0;
    h.stored = JSON.stringify({ criticality: "internal", declined: { "productionReadiness.ci": DECLINE } });
  });

  it("an owner-settings Save (no `declined` in the input) keeps every stored decline", async () => {
    await setPassportOverrides("acme", "acme/web", { criticality: "business", lifecycle: "ga", rollback: false });
    expect(written()).toMatchObject({
      criticality: "business",
      lifecycle: "ga",
      rollback: false,
      declined: { "productionReadiness.ci": DECLINE },
    });
  });

  it("an explicit `declined: {}` still clears them", async () => {
    await setPassportOverrides("acme", "acme/web", { criticality: "business", declined: {} });
    expect(written()).toEqual({ criticality: "business" });
  });

  it("an explicit `declined` map replaces the stored one", async () => {
    await setPassportOverrides("acme", "acme/web", { declined: { "productionReadiness.security": { reason: "internal" } } });
    expect(written()).toEqual({ declined: { "productionReadiness.security": { reason: "internal" } } });
  });

  it("a repo with nothing stored writes just what it was given", async () => {
    h.stored = null;
    await setPassportOverrides("acme", "acme/web", { lifecycle: "beta" });
    expect(written()).toEqual({ lifecycle: "beta" });
  });
});
