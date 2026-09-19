// Pure tests for the skill Trace fold (#36).
//
// Two fabrications are what these guard against, and both would look like MORE history rather than
// less: carrying a resolved version backwards over the commits whose blobs were never read, and
// attaching a lesson to the nearest commit instead of to the version it itself declares.

import { describe, expect, it } from "vitest";
import { buildTrace, groupLessonsByVersion, traceGroupLabel, TRACE_COMMITS, type PathCommit } from "./trace";

const commit = (sha: string, day: string, over: Partial<PathCommit> = {}): PathCommit => ({
  sha,
  authoredAt: `2026-08-${day}T00:00:00.000Z`,
  authorLogin: "someone",
  message: "skills: sharpen the checklist",
  ...over,
});

const lesson = (id: string, versionUsed: string) => ({ id, versionUsed, learnedOn: "2026-08-20T00:00:00.000Z" });

describe("buildTrace", () => {
  it("resolves a version only where one was read, and leaves the rest NULL", () => {
    const entries = buildTrace(
      [commit("c3", "25"), commit("c2", "20"), commit("c1", "10")],
      new Map([
        ["c3", "2.1.0"],
        ["c2", "2.0.0"],
      ]),
    );
    expect(entries.map((e) => [e.sha, e.version])).toEqual([
      ["c3", "2.1.0"],
      ["c2", "2.0.0"],
      // NOT "2.0.0". Carrying the neighbouring version backwards would invent exactly the history
      // this timeline exists to make trustworthy.
      ["c1", null],
    ]);
  });

  it("sorts newest first whatever order the API returned", () => {
    const entries = buildTrace([commit("old", "01"), commit("new", "28")], new Map());
    expect(entries.map((e) => e.sha)).toEqual(["new", "old"]);
  });

  it("keeps the subject line only, capped", () => {
    const entries = buildTrace([commit("c", "01", { message: `subject\n\n${"x".repeat(500)}` })], new Map());
    expect(entries[0]!.message).toBe("subject");
  });

  it("keeps a null authorLogin as null — never substituted from the git author name", () => {
    expect(buildTrace([commit("c", "01", { authorLogin: null })], new Map())[0]!.authorLogin).toBeNull();
  });
});

describe("groupLessonsByVersion", () => {
  const entries = buildTrace(
    [commit("c3", "25"), commit("c2", "20"), commit("c1", "10")],
    new Map([
      ["c3", "2.1.0"],
      ["c2", "2.0.0"],
    ]),
  );

  it("hangs each lesson on the version IT declares", () => {
    const groups = groupLessonsByVersion(entries, [lesson("l1", "2.0.0"), lesson("l2", "2.1.0")]);
    expect(groups.map((g) => [g.version, g.lessons.map((l) => l.id)])).toEqual([
      ["2.1.0", ["l2"]],
      ["2.0.0", ["l1"]],
      [null, []],
    ]);
  });

  it("puts a lesson whose version matches no resolved commit in an explicit `unplaced` group", () => {
    // FAIL-BEFORE, in the design sense: a nearest-commit heuristic would silently file this under
    // 2.0.0 and the attribution would look authoritative while being invented.
    const groups = groupLessonsByVersion(entries, [lesson("l1", "1.2.0")]);
    const unplaced = groups.find((g) => g.unplaced)!;
    expect(unplaced.lessons.map((l) => l.id)).toEqual(["l1"]);
    expect(traceGroupLabel(unplaced)).toBe(`version not in the last ${TRACE_COMMITS} commits`);
  });

  it("treats a lesson with no declared version as unplaced rather than guessing", () => {
    const groups = groupLessonsByVersion(entries, [lesson("l1", "")]);
    expect(groups.find((g) => g.unplaced)!.lessons.map((l) => l.id)).toEqual(["l1"]);
  });

  it("collapses the unresolved commits into ONE trailing group, not one group each", () => {
    const many = buildTrace([commit("a", "05"), commit("b", "04"), commit("c", "03")], new Map());
    const groups = groupLessonsByVersion(many, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.map((e) => e.sha)).toEqual(["a", "b", "c"]);
    expect(traceGroupLabel(groups[0]!)).toBe("version not resolved");
  });

  it("keeps two commits of the same version in one group", () => {
    const same = buildTrace(
      [commit("c2", "25"), commit("c1", "24")],
      new Map([
        ["c2", "2.1.0"],
        ["c1", "2.1.0"],
      ]),
    );
    const groups = groupLessonsByVersion(same, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it("returns nothing for an empty history and no lessons", () => {
    expect(groupLessonsByVersion([], [])).toEqual([]);
  });
});
