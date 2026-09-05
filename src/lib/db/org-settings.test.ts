// Per-org settings storage (org-settings.ts) — the two preferences that moved into real columns.
//
// The low-balance ("auto-recharge") preference used to BE an AuditLog row (G1-39): read back with
// getAuditLog(limit 1), which cost a findMany per read and, worse, put a customer SETTING inside a table
// an audit-retention purge is allowed to delete. It now lives in `Organization.autoRechargeJson`. The
// invariants pinned here are the ones that make that move safe on a populated database:
//
//   1. The COLUMN wins when set.
//   2. A NULL column falls back to the LEGACY AUDIT ROW — no backfill was run, and an org that
//      configured a threshold before the migration must keep it working on the very next read.
//   3. Neither source → the DEFAULT, which is the feature OFF. Every failure degrades in that same
//      direction: on a money surface a blip must never spontaneously arm a nag.
//   4. Anything stored is re-normalized on read, so a legacy/hand-edited blob can't break the popover.
//
// Plus the time-zone accessor (G4-07): a NULL column means "inherit the deployment default", which is
// what every org does today, and an unusable stored zone is rejected on write rather than silently
// behaving as UTC forever.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

const { mockGetOrgId } = vi.hoisted(() => ({ mockGetOrgId: vi.fn(async () => "org_1" as string | null) }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

const { mockGetAuditLog } = vi.hoisted(() => ({ mockGetAuditLog: vi.fn() }));
vi.mock("@/lib/db/scans-audit", () => ({ getAuditLog: mockGetAuditLog }));

import {
  getOrgAutoRecharge,
  getOrgTimeZone,
  getOrgTimeZoneSetting,
  setOrgAutoRecharge,
  setOrgTimeZone,
} from "./org-settings";
import { DEFAULT_AUTO_RECHARGE } from "@/components/org/shared/CreditsControl.autorecharge";
import { __resetOrgTimeZoneCache } from "@/lib/org/timezone";

/** Fake prisma exposing just the organization read/update this module makes. */
function fakePrisma(row: Record<string, unknown> | null) {
  const findUnique = vi.fn(async () => row);
  const update = vi.fn(async () => ({ id: "org_1" }));
  return { prisma: { organization: { findUnique, update } }, findUnique, update };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgId.mockResolvedValue("org_1");
  mockGetAuditLog.mockResolvedValue(null);
  delete process.env.ASCENT_ORG_TZ;
  __resetOrgTimeZoneCache();
});

// ── Auto-recharge preference (G1-39) ──────────────────────────────────────────────────────────────

describe("getOrgAutoRecharge — column first, legacy audit row as the un-backfilled tail", () => {
  const pref = { enabled: true, threshold: 25, packProductId: "pack_a" };

  it("reads the COLUMN when it is set — one column select, and the audit log is never touched", async () => {
    const { prisma, findUnique } = fakePrisma({ autoRechargeJson: JSON.stringify(pref) });
    mockGetPrisma.mockReturnValue(prisma);

    expect(await getOrgAutoRecharge("acme")).toEqual({ pref, source: "column" });
    // The whole point of the migration: no findMany over an append-only table on the hot read path.
    expect(mockGetAuditLog).not.toHaveBeenCalled();
    // Slug is normalized, like every other org read in the db layer.
    expect((findUnique.mock.calls[0]![0] as { where: { slug: string } }).where.slug).toBe("acme");
  });

  it("FALLS BACK to the legacy audit row when the column is NULL (no backfill was run, and none is needed)", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ autoRechargeJson: null }).prisma);
    mockGetAuditLog.mockResolvedValue({ entries: [{ meta: pref }] });

    // An org that configured its threshold before the migration keeps it on the very next read.
    expect(await getOrgAutoRecharge("acme")).toEqual({ pref, source: "audit" });
  });

  it("returns the DEFAULT (feature OFF) when neither source has anything", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ autoRechargeJson: null }).prisma);
    mockGetAuditLog.mockResolvedValue({ entries: [] });

    expect(await getOrgAutoRecharge("acme")).toEqual({ pref: DEFAULT_AUTO_RECHARGE, source: "default" });
  });

  it("NORMALIZES whatever is stored — a legacy/hand-edited blob degrades, it does not break the popover", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma({ autoRechargeJson: '{"enabled":"yes","threshold":-4,"packProductId":"   "}' }).prisma,
    );

    const { pref: got } = await getOrgAutoRecharge("acme");
    expect(got.enabled).toBe(false); // only a literal true opts in
    expect(got.threshold).toBeGreaterThanOrEqual(1); // clamped, never a nonsense boundary
    expect(got.packProductId).toBeNull();
  });

  it("treats unparseable / wrong-shaped column JSON as unset and falls through to the audit row", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ autoRechargeJson: "{not json" }).prisma);
    mockGetAuditLog.mockResolvedValue({ entries: [{ meta: pref }] });
    expect(await getOrgAutoRecharge("acme")).toEqual({ pref, source: "audit" });

    mockGetPrisma.mockReturnValue(fakePrisma({ autoRechargeJson: "[1,2,3]" }).prisma);
    expect((await getOrgAutoRecharge("acme")).source).toBe("audit");
  });

  it("degrades EVERY failure to the default — a DB blip must not arm a nag on a money surface", async () => {
    const exploding = { organization: { findUnique: vi.fn(async () => { throw new Error("db down"); }) } };
    mockGetPrisma.mockReturnValue(exploding);
    mockGetAuditLog.mockRejectedValue(new Error("db down"));

    await expect(getOrgAutoRecharge("acme")).resolves.toEqual({
      pref: DEFAULT_AUTO_RECHARGE,
      source: "default",
    });
  });

  it("returns the default without touching the DB when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getOrgAutoRecharge("acme")).toEqual({ pref: DEFAULT_AUTO_RECHARGE, source: "default" });
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });
});

describe("setOrgAutoRecharge — the write is the SAVE, and its failure must be visible", () => {
  it("persists the normalized preference to the column", async () => {
    const { prisma, update } = fakePrisma({});
    mockGetPrisma.mockReturnValue(prisma);

    expect(await setOrgAutoRecharge("acme", { enabled: true, threshold: 12, packProductId: null })).toBe(true);
    const data = (update.mock.calls[0]![0] as { data: { autoRechargeJson: string } }).data;
    expect(JSON.parse(data.autoRechargeJson)).toEqual({ enabled: true, threshold: 12, packProductId: null });
  });

  it("normalizes on the way IN too, so the column can never hold an out-of-range threshold", async () => {
    const { prisma, update } = fakePrisma({});
    mockGetPrisma.mockReturnValue(prisma);

    await setOrgAutoRecharge("acme", { enabled: true, threshold: 10_000_000, packProductId: null });
    const stored = JSON.parse((update.mock.calls[0]![0] as { data: { autoRechargeJson: string } }).data.autoRechargeJson);
    expect(stored.threshold).toBeLessThanOrEqual(10_000);
  });

  it("returns FALSE (never a silent success) for an unknown org, no DB, or a failed write", async () => {
    const { prisma } = fakePrisma({});
    mockGetPrisma.mockReturnValue(prisma);
    mockGetOrgId.mockResolvedValue(null);
    expect(await setOrgAutoRecharge("nope", DEFAULT_AUTO_RECHARGE)).toBe(false);

    mockGetOrgId.mockResolvedValue("org_1");
    mockGetPrisma.mockReturnValue({
      organization: { update: vi.fn(async () => { throw new Error("write failed"); }) },
    });
    expect(await setOrgAutoRecharge("acme", DEFAULT_AUTO_RECHARGE)).toBe(false);

    mockIsDbConfigured.mockReturnValue(false);
    expect(await setOrgAutoRecharge("acme", DEFAULT_AUTO_RECHARGE)).toBe(false);
  });
});

// ── Time zone (G4-07) ─────────────────────────────────────────────────────────────────────────────

describe("org time zone — the column, and the default every existing org keeps inheriting", () => {
  it("resolves the org's stored zone", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ timezone: "Asia/Tokyo" }).prisma);
    expect(await getOrgTimeZone("acme")).toBe("Asia/Tokyo");
    expect(await getOrgTimeZoneSetting("acme")).toBe("Asia/Tokyo");
  });

  it("a NULL column inherits the deployment default — the behavior of EVERY row after this migration", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ timezone: null }).prisma);
    expect(await getOrgTimeZone("acme")).toBe("UTC");
    // The setting accessor keeps "inherited" distinguishable from "explicitly set", which the settings
    // UI needs and the resolved accessor deliberately erases.
    expect(await getOrgTimeZoneSetting("acme")).toBeNull();
  });

  it("honors ASCENT_ORG_TZ as the fallback layer beneath the column", async () => {
    process.env.ASCENT_ORG_TZ = "Europe/Prague";
    __resetOrgTimeZoneCache();
    mockGetPrisma.mockReturnValue(fakePrisma({ timezone: null }).prisma);
    expect(await getOrgTimeZone("acme")).toBe("Europe/Prague");
  });

  it("never returns an unusable zone: unknown org, DB off, and a garbage column all resolve to the default", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma(null).prisma);
    expect(await getOrgTimeZone("ghost")).toBe("UTC");

    mockGetPrisma.mockReturnValue(fakePrisma({ timezone: "Mars/Olympus_Mons" }).prisma);
    expect(await getOrgTimeZone("acme")).toBe("UTC");

    mockIsDbConfigured.mockReturnValue(false);
    expect(await getOrgTimeZone("acme")).toBe("UTC");
  });

  it("REJECTS an invalid zone on write rather than storing a value the read path will silently ignore", async () => {
    const { prisma, update } = fakePrisma({});
    mockGetPrisma.mockReturnValue(prisma);

    expect(await setOrgTimeZone("acme", "Mars/Olympus_Mons")).toBeUndefined();
    expect(update).not.toHaveBeenCalled(); // a settings form that "saves" and then behaves as UTC is worse
  });

  it("stores a valid zone, and stores NULL to go back to inheriting", async () => {
    const { prisma, update } = fakePrisma({});
    mockGetPrisma.mockReturnValue(prisma);

    expect(await setOrgTimeZone("acme", "America/New_York")).toBe("America/New_York");
    expect(await setOrgTimeZone("acme", null)).toBeNull();
    expect(await setOrgTimeZone("acme", "  ")).toBeNull();
    const written = update.mock.calls.map((c) => (c[0] as { data: { timezone: string | null } }).data.timezone);
    expect(written).toEqual(["America/New_York", null, null]);
  });
});
