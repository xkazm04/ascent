// Pure tests for the LESSONS.md parser (#36).
//
// The load-bearing assertion is the LAST one: `splitLessonEntries(text).length === countLessons(text)`
// for every fixture. The dashboard number and the lesson ledger come from one scan of the file, and
// two surfaces disagreeing about how many lessons a skill has is the failure this item exists to end.

import { describe, expect, it } from "vitest";
import { countLessons } from "./index-walk";
import { lessonWarning, parseLessonHeading, splitLessonEntries } from "./lessons";

const FIXTURE = `# Lessons - forge

Append-only reflection lane. One entry per run that taught something, newest last.
Format: \`## <version used> - <YYYY-MM-DD> - <project>\` followed by \`- \` bullets.

## 2.0.0 - 2026-08-19 - gravitone-gcloud

- Scale observed: 8 scouts over 120 contexts.
- The two-phase order held its promise measurably.

## 2.0.0 — 2026-08-21 — politicas

- An em dash separator, which installations do write.

## 2.1.0 - 2026-08-25 - grant-writing-nonprofits

- The third run.
`;

describe("splitLessonEntries", () => {
  it("produces one row per heading, in file order, ignoring the preamble", () => {
    const entries = splitLessonEntries(FIXTURE);
    expect(entries.map((e) => e.versionUsed)).toEqual(["2.0.0", "2.0.0", "2.1.0"]);
    expect(entries.map((e) => e.project)).toEqual([
      "gravitone-gcloud",
      "politicas",
      "grant-writing-nonprofits",
    ]);
    expect(entries.map((e) => e.position)).toEqual([0, 1, 2]);
  });

  it("parses an em-dash separator as well as a hyphen", () => {
    const e = splitLessonEntries(FIXTURE)[1]!;
    expect(e.learnedOn).toBe("2026-08-21T00:00:00.000Z");
    expect(e.project).toBe("politicas");
  });

  it("keeps a range version verbatim rather than shredding it on its own hyphen", () => {
    const e = splitLessonEntries("## 0.1-1.0 - 2026-08-01 - arc\n\n- covered an arc\n")[0]!;
    expect(e.versionUsed).toBe("0.1-1.0");
    expect(e.project).toBe("arc");
  });

  it("keeps a hyphenated project name whole", () => {
    const e = splitLessonEntries("## 1.0.0 - 2026-08-01 - grant-writing-nonprofits\n")[0]!;
    expect(e.project).toBe("grant-writing-nonprofits");
  });

  it("STILL produces a row for a heading with no readable date, with learnedOn null", () => {
    // Losing somebody's written reflection because its heading is odd is worse than an
    // under-parsed row — and `learnedOn` is null, never "today".
    const entries = splitLessonEntries("## some free-form heading\n\n- the lesson survives\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ learnedOn: null, versionUsed: "some free-form heading", project: "" });
    expect(entries[0]!.body).toBe("- the lesson survives");
  });

  it("never substitutes the skill's current version for a missing one", () => {
    const e = splitLessonEntries("## 2026-08-01 - a project\n\n- no version slot\n")[0]!;
    expect(e.versionUsed).toBe("");
    expect(e.learnedOn).toBe("2026-08-01T00:00:00.000Z");
    expect(e.project).toBe("a project");
  });

  it("carries the whole heading line verbatim, whatever it parsed", () => {
    const e = splitLessonEntries("## 1.0.0 - 2026-08-01 - proj\n")[0]!;
    expect(e.headingRaw).toBe("## 1.0.0 - 2026-08-01 - proj");
  });

  it("hashes heading + body, so an edited entry replaces itself and a re-index does not", () => {
    const a = splitLessonEntries("## 1.0.0 - 2026-08-01 - p\n\n- one\n")[0]!;
    const same = splitLessonEntries("## 1.0.0 - 2026-08-01 - p\n\n- one\n")[0]!;
    const edited = splitLessonEntries("## 1.0.0 - 2026-08-01 - p\n\n- one, revised\n")[0]!;
    expect(a.entryHash).toBe(same.entryHash);
    expect(a.entryHash).not.toBe(edited.entryHash);
  });

  it("caps a runaway body without dropping the entry", () => {
    const body = Array.from({ length: 2000 }, (_, i) => `- bullet ${i}`).join("\n");
    const e = splitLessonEntries(`## 1.0.0 - 2026-08-01 - p\n\n${body}\n`)[0]!;
    expect(e.body.length).toBe(8 * 1024);
  });

  it("returns nothing for a file with no headings", () => {
    expect(splitLessonEntries("# Lessons\n\nNothing yet.\n")).toEqual([]);
  });

  it("INVARIANT: the row count equals the dashboard count, for every fixture", () => {
    for (const text of [FIXTURE, "## a\n## b\n", "# no headings\n", "", "## 1.0.0 - 2026-08-01 - p\n- x\n"]) {
      expect(splitLessonEntries(text).length).toBe(countLessons(text));
    }
  });
});

describe("parseLessonHeading", () => {
  it("finds the date by SHAPE, so a missing slot cannot shift the others", () => {
    expect(parseLessonHeading("## 2026-08-01 - proj")).toMatchObject({ versionUsed: "", project: "proj" });
    expect(parseLessonHeading("## 1.0.0 - 2026-08-01")).toMatchObject({ versionUsed: "1.0.0", project: "" });
  });

  it("rejects a date-shaped string that is not a real date", () => {
    expect(parseLessonHeading("## 1.0.0 - 2026-13-45 - p").learnedOn).toBeNull();
  });
});

describe("lessonWarning", () => {
  it("warns ONCE per file, not once per entry", () => {
    const entries = splitLessonEntries("## odd one\n## odd two\n## 1.0.0 - 2026-08-01 - p\n");
    const w = lessonWarning("skills/x/LESSONS.md", entries)!;
    expect(w).toContain("2 of 3 lesson headings");
  });

  it("is silent when every heading parsed", () => {
    expect(lessonWarning("skills/x/LESSONS.md", splitLessonEntries(FIXTURE))).toBeNull();
  });
});
