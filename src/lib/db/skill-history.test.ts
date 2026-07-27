// Unit test for the onboarding-skill generation history (STD-6). This module had no direct test, yet
// three of its properties are what make the history trustworthy rather than noisy:
//
//  1. generationId DETERMINISM + ORDER-INSENSITIVITY. The id is the dedup identity, and it is a
//     primary-key upsert — so if the same (repo, commit, track-SET) hashed differently because the
//     tracks arrived in a different order, every refresh/prefetch/CDN revalidation would insert a new
//     "no-change" row and the track diff would report churn that never happened. Conversely, if two
//     genuinely different generations collided, one would be silently swallowed.
//  2. parseTrackIds TOLERANCE. `trackIds` is a JSON string column. A malformed or wrong-shaped blob
//     (an old row, a hand-edit, a partial write) must degrade to [] — a history read must never throw
//     and take the report page down with it.
//  3. diffTrackSets CORRECTNESS. added/dropped/kept is what the report renders as the program's story.
//
// generationId and parseTrackIds are private, so they are exercised through the public surface:
// the id via the `where`/`create` the upsert is called with, the parser via getSkillHistory's rows.

import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn();
const findMany = vi.fn();
const isDbConfigured = vi.fn();

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => isDbConfigured(),
  getPrisma: () => ({ skillGeneration: { upsert, findMany } }),
}));

import { recordSkillGeneration, getSkillHistory, diffTrackSets } from "./skill-history";
import { PRACTICES } from "@/lib/practices";

/** The deterministic id the module derived for this write. */
async function idFor(repo: string, sha: string | null, tracks: string[]): Promise<string> {
  upsert.mockClear();
  await recordSkillGeneration(repo, sha, tracks);
  return (upsert.mock.calls[0]![0] as { where: { id: string } }).where.id;
}

/** The `create` payload the module built for this write. */
async function createFor(repo: string, sha: string | null, tracks: string[]) {
  upsert.mockClear();
  await recordSkillGeneration(repo, sha, tracks);
  return (upsert.mock.calls[0]![0] as { create: Record<string, unknown> }).create;
}

beforeEach(() => {
  vi.clearAllMocks();
  isDbConfigured.mockReturnValue(true);
  upsert.mockResolvedValue({});
  findMany.mockResolvedValue([]);
});

describe("recordSkillGeneration — the deterministic dedup identity", () => {
  it("is stable across calls for the same (repo, commit, track set)", async () => {
    expect(await idFor("acme/api", "abc123", ["D2", "D9"])).toBe(await idFor("acme/api", "abc123", ["D2", "D9"]));
  });

  it("is ORDER-INSENSITIVE — the tracks describe a set, not a sequence", async () => {
    const a = await idFor("acme/api", "abc123", ["D2", "D9", "D4"]);
    const b = await idFor("acme/api", "abc123", ["D4", "D2", "D9"]);
    expect(a).toBe(b);
  });

  it("is insensitive to DUPLICATES within the selection", async () => {
    expect(await idFor("acme/api", "abc123", ["D2", "D2", "D9"])).toBe(await idFor("acme/api", "abc123", ["D9", "D2"]));
  });

  it("differs on a different track set, commit, or repo (no collisions across generations)", async () => {
    const base = await idFor("acme/api", "abc123", ["D2", "D9"]);
    expect(await idFor("acme/api", "abc123", ["D2"])).not.toBe(base); // different set
    expect(await idFor("acme/api", "def456", ["D2", "D9"])).not.toBe(base); // different commit
    expect(await idFor("other/api", "abc123", ["D2", "D9"])).not.toBe(base); // different repo
    expect(await idFor("acme/api", null, ["D2", "D9"])).not.toBe(base); // no commit
  });

  it("guards the comma-join precondition: no real track id may contain the key delimiter", () => {
    // The id joins the sorted track set with "," — so a track id CONTAINING a comma would make
    // ["D2,D9"] hash identically to the two-track set ["D2","D9"] and silently swallow one of the two
    // generations. Track ids are practice slugs, which is what makes the join safe; this pins that
    // precondition at its source rather than at the hash (changing the delimiter would re-key every
    // history row already written). Introduce a comma-bearing practice id and this fails here.
    for (const p of PRACTICES) expect(p.id).not.toContain(",");
  });

  it("is a prefixed, fixed-width id (a stable primary-key shape)", async () => {
    expect(await idFor("acme/api", "abc123", ["D2"])).toMatch(/^sg_[0-9a-f]{32}$/);
  });

  it("upserts with a NO-OP update so a concurrent duplicate collapses without touching generatedAt", async () => {
    await recordSkillGeneration("acme/api", "abc123", ["D2"]);
    expect(upsert.mock.calls[0]![0]).toMatchObject({ update: {} });
  });

  it("serializes the track ids as JSON and caps the set at 30", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const created = (await createFor("acme/api", "abc", many)) as { trackIds: string };
    expect(JSON.parse(created.trackIds)).toHaveLength(30);
  });

  it("caps an over-long repo name at 200 chars (column bound), consistently in id and row", async () => {
    const long = "o".repeat(300);
    const created = (await createFor(long, "abc", ["D2"])) as { repoFullName: string };
    expect(created.repoFullName).toHaveLength(200);
    // The id is derived from the SAME capped name, so a re-record of the same repo still dedups.
    expect(await idFor(long, "abc", ["D2"])).toBe(await idFor("o".repeat(200), "abc", ["D2"]));
  });

  it("normalizes an undefined commit to null in the row", async () => {
    const created = (await createFor("acme/api", null, ["D2"])) as { headSha: string | null };
    expect(created.headSha).toBeNull();
  });

  it("is a no-op when persistence is off", async () => {
    isDbConfigured.mockReturnValue(false);
    await recordSkillGeneration("acme/api", "abc", ["D2"]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("SWALLOWS a write failure — the file download must never depend on the history", async () => {
    upsert.mockRejectedValue(new Error("unique constraint"));
    await expect(recordSkillGeneration("acme/api", "abc", ["D2"])).resolves.toBeUndefined();
  });
});

describe("getSkillHistory — tolerant parseTrackIds", () => {
  const row = (trackIds: string) => ({
    id: "sg_x",
    repoFullName: "acme/api",
    headSha: "abc",
    trackIds,
    generatedAt: new Date("2026-06-01T00:00:00.000Z"),
  });

  it("parses a well-formed JSON array of ids", async () => {
    findMany.mockResolvedValue([row(JSON.stringify(["D2", "D9"]))]);
    expect((await getSkillHistory("acme/api"))[0]!.trackIds).toEqual(["D2", "D9"]);
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON object", '{"a":1}'],
    ["a bare string", '"D2"'],
    ["null", "null"],
    ["an empty column", ""],
  ])("degrades to [] for %s instead of throwing", async (_label, raw) => {
    findMany.mockResolvedValue([row(raw)]);
    const rows = await getSkillHistory("acme/api");
    expect(rows[0]!.trackIds).toEqual([]);
  });

  it("drops non-string members of an otherwise-valid array", async () => {
    findMany.mockResolvedValue([row('["D2",7,null,{"x":1},"D9"]')]);
    expect((await getSkillHistory("acme/api"))[0]!.trackIds).toEqual(["D2", "D9"]);
  });

  it("serializes generatedAt to an ISO string", async () => {
    findMany.mockResolvedValue([row("[]")]);
    expect((await getSkillHistory("acme/api"))[0]!.generatedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("reads newest-first, scoped to the repo, with the limit bounded to 1..50", async () => {
    await getSkillHistory("acme/api");
    expect(findMany).toHaveBeenCalledWith({
      where: { repoFullName: "acme/api" },
      orderBy: { generatedAt: "desc" },
      take: 10,
    });
    for (const [asked, expected] of [
      [0, 1],
      [-5, 1],
      [999, 50],
      [25, 25],
    ] as const) {
      findMany.mockClear();
      await getSkillHistory("acme/api", asked);
      expect(findMany.mock.calls[0]![0].take).toBe(expected);
    }
  });

  it("returns [] without querying when persistence is off", async () => {
    isDbConfigured.mockReturnValue(false);
    expect(await getSkillHistory("acme/api")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("diffTrackSets", () => {
  it("splits a change into added / dropped / kept", () => {
    expect(diffTrackSets(["D2", "D4", "D9"], ["D4", "D9", "D1"])).toEqual({
      added: ["D1"],
      dropped: ["D2"],
      kept: ["D4", "D9"],
    });
  });

  it("reports no change when the same set is regenerated in a different order", () => {
    expect(diffTrackSets(["D2", "D9"], ["D9", "D2"])).toEqual({ added: [], dropped: [], kept: ["D9", "D2"] });
  });

  it("handles an empty older set (first generation — everything is added)", () => {
    expect(diffTrackSets([], ["D2"])).toEqual({ added: ["D2"], dropped: [], kept: [] });
  });

  it("handles an empty newer set (all gaps closed — everything is dropped)", () => {
    expect(diffTrackSets(["D2"], [])).toEqual({ added: [], dropped: ["D2"], kept: [] });
  });

  it("preserves the NEWER set's order in added/kept (that is the order the report renders)", () => {
    expect(diffTrackSets(["D9"], ["D1", "D9", "D2"])).toEqual({
      added: ["D1", "D2"],
      dropped: [],
      kept: ["D9"],
    });
  });
});
