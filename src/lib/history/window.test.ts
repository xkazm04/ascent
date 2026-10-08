// The history window rule (a-d) in src/lib/history/window.ts: which `since` a history read gets.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgs = vi.hoisted(() => ({ rows: new Map<string, { plan: string; kind: string }>() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, dbReadStrict: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async (slug: string) => orgs.rows.get(slug) ?? null }));

import { historyOutsideWindowNote, historyWindowNote, resolveHistoryWindow } from "@/lib/history/window";

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86_400_000;

beforeEach(() => {
  vi.stubEnv("ASCENT_SELF_HOSTED", "0"); // enforce plans
  orgs.rows.clear();
  orgs.rows.set("kaz", { plan: "free", kind: "personal" });
  orgs.rows.set("acme", { plan: "team", kind: "team" });
  orgs.rows.set("bigco", { plan: "enterprise", kind: "team" });
  orgs.rows.set("starter", { plan: "pro", kind: "team" });
});
afterEach(() => vi.unstubAllEnvs());

describe("resolveHistoryWindow", () => {
  it("a/b: a Free personal-workspace viewer on the public org gets 30 days", async () => {
    const w = await resolveHistoryWindow("public", "Kaz", NOW);
    expect(w.since).toEqual(new Date(NOW - 30 * DAY));
    expect(w).toMatchObject({ days: 30, planLabel: "Free" });
  });

  it("a: a Team tenant org read has a 365-day floor, Starter 180", async () => {
    expect((await resolveHistoryWindow("acme", null, NOW)).since).toEqual(new Date(NOW - 365 * DAY));
    expect((await resolveHistoryWindow("starter", "kaz", NOW)).since).toEqual(new Date(NOW - 180 * DAY));
  });

  it("a: an enterprise plan (retentionDays null) has no floor", async () => {
    expect((await resolveHistoryWindow("bigco", "kaz", NOW)).since).toBeNull();
  });

  it("c: a signed-out reader, or a viewer with no personal workspace, is unclamped", async () => {
    expect((await resolveHistoryWindow("public", null, NOW)).since).toBeNull();
    expect((await resolveHistoryWindow("public", "stranger", NOW)).since).toBeNull();
    orgs.rows.set("member", { plan: "free", kind: "team" }); // a same-named non-personal org is not a workspace
    expect((await resolveHistoryWindow("public", "member", NOW)).since).toBeNull();
  });

  it("d: self-host is unchanged on every plan", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    for (const [org, viewer] of [["public", "kaz"], ["acme", "kaz"], ["starter", null]] as const) {
      expect((await resolveHistoryWindow(org, viewer, NOW)).since).toBeNull();
    }
  });
});

describe("window notes", () => {
  it("names the window and the plan; says nothing when unclamped", async () => {
    const w = await resolveHistoryWindow("public", "kaz", NOW);
    expect(historyWindowNote(w)).toBe("Showing the last 30 days: the Free plan's history window.");
    expect(historyOutsideWindowNote(w, "o/r")).toMatch(/older than the last 30 days/);
    expect(historyWindowNote(await resolveHistoryWindow("public", null, NOW))).toBeNull();
  });
});
