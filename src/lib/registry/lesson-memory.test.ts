// Lesson → memory candidate policy (#36). The mapping is pure so the four decisions that make a
// lesson recallable WITHOUT distorting recall — its namespace, its kind, its confidence band and the
// per-pass cap — are pinned where they are decided rather than inside a writer.

import { describe, expect, it, vi } from "vitest";
import * as lessonsDb from "@/lib/db/org-skill-lessons";
import * as scanFeed from "@/lib/memory/scan-feed";
import { SKILL_LESSON_SOURCE } from "./lessons";
import { ingestSkillLessons, LESSON_MEMORY_CAP, lessonMemoryCandidates, type LessonLike } from "./lesson-memory";

const lesson = (over: Partial<LessonLike> = {}): LessonLike => ({
  id: "l1",
  versionUsed: "2.1.0",
  learnedOn: "2026-08-20T00:00:00.000Z",
  project: "checkout-service",
  headingRaw: "## 2.1.0 - 2026-08-20 - checkout-service",
  body: "- Verify the instrument before reporting a content gap.",
  memoryId: null,
  ...over,
});

describe("lessonMemoryCandidates", () => {
  it("files a lesson under the SKILL's namespace, as procedural, from the skill-lessons source", () => {
    const [c] = lessonMemoryCandidates("forge", [lesson()]);
    expect(c).toMatchObject({
      lessonId: "l1",
      // The skill, not a repo: a lesson is about the METHOD, and a repo namespace would surface it
      // to one project and hide it from every other user of the skill.
      namespace: "forge",
      kind: "procedural",
      source: SKILL_LESSON_SOURCE,
      confidence: 0.6,
      tags: ["forge", "2.1.0"],
    });
  });

  it("carries the heading into the content, so a recalled note knows which version taught it", () => {
    const [c] = lessonMemoryCandidates("forge", [lesson()]);
    expect(c!.content).toContain("2.1.0 - 2026-08-20 - checkout-service");
    expect(c!.content).toContain("Verify the instrument");
  });

  it("tags an unversioned lesson as such rather than leaving the slot empty", () => {
    expect(lessonMemoryCandidates("forge", [lesson({ versionUsed: "" })])[0]!.tags).toEqual(["forge", "unversioned"]);
  });

  it("SKIPS a lesson that already produced a memory", () => {
    // FAIL-BEFORE, in the design sense: without this skip every index pass would re-offer every
    // lesson the registry has ever held, and the door would absorb the duplicates silently while
    // the cost grew with history.
    expect(lessonMemoryCandidates("forge", [lesson({ memoryId: "mem-1" })])).toEqual([]);
  });

  it("skips a heading with no body — there is nothing to recall", () => {
    expect(lessonMemoryCandidates("forge", [lesson({ body: "   " })])).toEqual([]);
  });

  it("takes the newest first and holds the per-skill cap", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      lesson({ id: `l${i}`, learnedOn: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const out = lessonMemoryCandidates("forge", many);
    expect(out).toHaveLength(LESSON_MEMORY_CAP);
    expect(out[0]!.lessonId).toBe("l24");
  });

  it("sorts an undated lesson LAST — a missing date is not evidence of recency", () => {
    const out = lessonMemoryCandidates("forge", [
      lesson({ id: "undated", learnedOn: null }),
      lesson({ id: "dated", learnedOn: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(out.map((c) => c.lessonId)).toEqual(["dated", "undated"]);
  });

  it("honours a caller-supplied cap", () => {
    expect(lessonMemoryCandidates("forge", [lesson({ id: "a" }), lesson({ id: "b" })], 1)).toHaveLength(1);
  });
});

describe("ingestSkillLessons", () => {
  // Wired at wave-1 integration: the ingest goes through THE one door (`writeMemoryCandidate` in
  // scan-feed.ts) — never a private writer. `held: true` (the pre-wiring no-op) is the OLD
  // expression and is forbidden below; a regression back to the hold would fail these.
  it("writes through the one door and stamps the lesson with its memory id", async () => {
    const door = vi.spyOn(scanFeed, "writeMemoryCandidate").mockResolvedValue({ id: "mem-1" });
    const stamp = vi.spyOn(lessonsDb, "setLessonMemoryId").mockResolvedValue();
    const tally = await ingestSkillLessons("org-1", "forge", [lesson()]);
    expect(tally).toEqual({ offered: 1, written: 1, held: false });
    expect(door).toHaveBeenCalledTimes(1);
    expect(door.mock.calls[0]![0]).toMatchObject({ orgId: "org-1", namespace: "forge", kind: "procedural" });
    // the door's input must not carry the row id — that is the stamp's job, not the memory's body
    expect(door.mock.calls[0]![0]).not.toHaveProperty("lessonId");
    expect(stamp).toHaveBeenCalledWith("l1", "mem-1");
    door.mockRestore();
    stamp.mockRestore();
  });

  it("a declined candidate (door returns null) counts as offered, never as written", async () => {
    const door = vi.spyOn(scanFeed, "writeMemoryCandidate").mockResolvedValue(null);
    const stamp = vi.spyOn(lessonsDb, "setLessonMemoryId").mockResolvedValue();
    const tally = await ingestSkillLessons("org-1", "forge", [lesson()]);
    expect(tally).toEqual({ offered: 1, written: 0, held: false });
    expect(stamp).not.toHaveBeenCalled();
    door.mockRestore();
    stamp.mockRestore();
  });

  it("still counts what it WOULD offer, so the hold is visible rather than silent", async () => {
    const tally = await ingestSkillLessons("org-1", "forge", [lesson({ id: "a" }), lesson({ id: "b", memoryId: "m" })]);
    expect(tally.offered).toBe(1);
  });
});
