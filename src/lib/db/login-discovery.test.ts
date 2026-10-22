// The sign-in discovery store (oauth-1). The Supabase callback learns the viewer's ranked org
// suggestions and seeded org in after(), and the onboarding page reads them back for the SAME login.
// What must hold:
//   - the key is the lowercased GitHub login, so a mixed-case identity reads its own row;
//   - a write REPLACES the row (overwritten per sign-in), stores org names only, and is capped;
//   - a read never throws: DB off, unreachable, or a broken row all read as null.

import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn<(args: unknown) => Promise<unknown>>(async () => ({}));
const findUnique = vi.fn<(args: unknown) => Promise<unknown>>(async () => null);
let dbConfigured = true;
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => dbConfigured,
  getPrisma: () => ({ loginDiscovery: { upsert, findUnique } }),
  dbReadSafe: async <T,>(fn: () => Promise<T>) => fn(),
}));

import { getLoginDiscovery, recordLoginDiscovery } from "./login-discovery";

beforeEach(() => {
  dbConfigured = true;
  upsert.mockReset();
  upsert.mockResolvedValue({});
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
});

describe("recordLoginDiscovery", () => {
  it("upserts one row keyed on the lowercased login, overwriting the previous sign-in's result", async () => {
    await expect(recordLoginDiscovery("Dana", { suggestedOrgs: ["acme", "beta"], seededOrg: "acme" })).resolves.toBe(true);
    const args = upsert.mock.calls[0]![0] as {
      where: { login: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({ login: "dana" });
    expect(args.create).toMatchObject({ login: "dana", suggestedOrgsJson: '["acme","beta"]', seededOrg: "acme" });
    // The update writes every field, including a cleared seededOrg, so no stale value survives.
    expect(args.update).toMatchObject({ suggestedOrgsJson: '["acme","beta"]', seededOrg: "acme" });
    expect(args.update.discoveredAt).toBeInstanceOf(Date);
  });

  it("clears the seeded org when this sign-in seeded nothing", async () => {
    await recordLoginDiscovery("dana", { suggestedOrgs: [] });
    const args = upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(args.update).toMatchObject({ suggestedOrgsJson: "[]", seededOrg: null });
  });

  it("stores org names only, deduplicated and capped", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `org-${i}`);
    await recordLoginDiscovery("dana", { suggestedOrgs: [...many, "org-0", "", 7 as unknown as string] });
    const args = upsert.mock.calls[0]![0] as { create: { suggestedOrgsJson: string } };
    const stored = JSON.parse(args.create.suggestedOrgsJson) as string[];
    expect(stored).toHaveLength(8);
    expect(new Set(stored).size).toBe(8);
    expect(stored.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });

  it("is a no-op returning false when the DB is unconfigured or the write fails", async () => {
    dbConfigured = false;
    await expect(recordLoginDiscovery("dana", { suggestedOrgs: ["acme"] })).resolves.toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    dbConfigured = true;
    upsert.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordLoginDiscovery("dana", { suggestedOrgs: ["acme"] })).resolves.toBe(false);
  });
});

describe("getLoginDiscovery", () => {
  it("reads the row for the lowercased login and returns the suggestions with an ISO timestamp", async () => {
    findUnique.mockResolvedValue({
      login: "dana",
      suggestedOrgsJson: '["acme","beta"]',
      seededOrg: "acme",
      discoveredAt: new Date("2026-10-22T10:00:00.000Z"),
    });
    await expect(getLoginDiscovery("DANA")).resolves.toEqual({
      suggestedOrgs: ["acme", "beta"],
      seededOrg: "acme",
      discoveredAt: "2026-10-22T10:00:00.000Z",
    });
    expect((findUnique.mock.calls[0]![0] as { where: unknown }).where).toEqual({ login: "dana" });
  });

  it("returns null when the DB is unconfigured, without querying", async () => {
    dbConfigured = false;
    await expect(getLoginDiscovery("dana")).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the read throws (never fails the onboarding render)", async () => {
    findUnique.mockRejectedValue(new Error("relation does not exist"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getLoginDiscovery("dana")).resolves.toBeNull();
  });

  it("returns null for no row, and tolerates a corrupt suggestions column", async () => {
    await expect(getLoginDiscovery("dana")).resolves.toBeNull();
    findUnique.mockResolvedValue({ login: "dana", suggestedOrgsJson: "{not json", seededOrg: null, discoveredAt: new Date(0) });
    await expect(getLoginDiscovery("dana")).resolves.toEqual({
      suggestedOrgs: [],
      seededOrg: undefined,
      discoveredAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("returns null for an empty login", async () => {
    await expect(getLoginDiscovery("  ")).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
