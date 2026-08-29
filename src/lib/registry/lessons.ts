// `skills/<name>/LESSONS.md` — the append-only reflection lane, parsed into rows (#36).
//
// Until now the indexer only COUNTED these (`countLessons`), so an org could see that it had 47
// lessons and read none of them. The count is what this file has to stay exactly equal to: it cuts
// on the SAME `^##\s+\S` regex, so `splitLessonEntries(text).length === countLessons(text)` holds by
// construction. Two surfaces disagreeing about how many lessons a skill has is precisely the failure
// this item exists to end, and it would be an easy one to introduce with a second, cleverer regex.
//
// TOLERANT, ON PURPOSE. The heading contract (`../ai-registry/docs/skills-lane.md` §LESSONS.md) is
// `## <version used> - <YYYY-MM-DD> - <project>`, where the separator may be a hyphen or an em dash,
// the version may be a range (`0.1-1.0`) or two-part, and lessons arrive from installations that
// write either. A heading that does not match still produces a ROW: losing somebody's written
// reflection because its heading is odd is far worse than storing an under-parsed one, and
// `headingRaw` always carries what was actually there so a reader can see what the parser was given.
//
// PURE — no db import, safe for a client bundle.

import { contentDigest } from "./parse";

/** `source` on the memory candidates a lesson produces. One constant, so a dedup window and a
 *  provenance filter cannot drift apart. */
export const SKILL_LESSON_SOURCE = "skill-lessons";

/** Body cap per entry. A lesson is a paragraph of reflection; 8KB is a very long one. */
export const MAX_LESSON_BODY = 8 * 1024;

export interface LessonEntry {
  /** Heading slot 1, VERBATIM. `""` = the heading carried no readable version — never the skill's
   *  current version, which would attribute a lesson to a method that did not produce it. */
  versionUsed: string;
  /** Heading slot 2 as an ISO date, or null when it carried no readable date. Never "today". */
  learnedOn: string | null;
  /** Heading slot 3, verbatim. `""` = absent. */
  project: string;
  /** The whole `## …` line, so a reader can always see what was parsed. */
  headingRaw: string;
  /** The bullets under it, capped. */
  body: string;
  /** contentDigest over `headingRaw + "\n" + body` — the idempotency key for the row. */
  entryHash: string;
  /** 0-based order in the file. The lane is append-only, so this is stable history. */
  position: number;
}

/** The heading regex, shared with `countLessons` in ./index-walk — one definition, one meaning. */
const HEADING = /^##\s+\S/;

/** Separator between the heading's three slots: hyphen, en dash or em dash, always space-padded. */
const SLOT_SPLIT = /\s+[-–—]\s+/;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse one heading line into its three slots.
 *
 * The slots are split on the padded separator, NOT on a bare hyphen: a version range (`0.1-1.0`) and
 * a project name with a hyphen both contain hyphens, and splitting on those would shred the two
 * fields the reader most wants. A heading with fewer than three slots fills what it can and leaves
 * the rest empty/null rather than shuffling values into the wrong fields.
 */
export function parseLessonHeading(line: string): Pick<LessonEntry, "versionUsed" | "learnedOn" | "project" | "headingRaw"> {
  const headingRaw = line.trimEnd();
  const text = headingRaw.replace(/^#+\s*/, "").trim();
  const slots = text.split(SLOT_SPLIT).map((s) => s.trim());

  // The DATE is found by shape rather than by position, because a heading that omitted the version
  // slot would otherwise put its date in `versionUsed` and its project in `learnedOn`.
  let learnedOn: string | null = null;
  let dateAt = -1;
  for (let i = 0; i < slots.length; i++) {
    const m = ISO_DATE.exec(slots[i]!);
    if (!m) continue;
    const iso = `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
    if (!Number.isFinite(Date.parse(iso))) continue;
    learnedOn = iso;
    dateAt = i;
    break;
  }
  const versionUsed = dateAt > 0 ? slots.slice(0, dateAt).join(" - ") : dateAt === 0 ? "" : (slots[0] ?? "");
  const project = dateAt >= 0 ? slots.slice(dateAt + 1).join(" - ") : slots.slice(1).join(" - ");
  return { versionUsed: versionUsed.trim(), learnedOn, project: project.trim(), headingRaw };
}

/**
 * Cut a `LESSONS.md` into entries, one per `## ` heading, in file order.
 *
 * Text before the first heading (the file's own title and format note) is not an entry and is
 * dropped — it belongs to nobody's run.
 */
export function splitLessonEntries(text: string): LessonEntry[] {
  const lines = text.split(/\r?\n/);
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (HEADING.test(lines[i]!)) starts.push(i);

  return starts.map((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    const headingLine = lines[start]!;
    const body = lines
      .slice(start + 1, end)
      .join("\n")
      .trim()
      .slice(0, MAX_LESSON_BODY);
    const head = parseLessonHeading(headingLine);
    return {
      ...head,
      body,
      entryHash: contentDigest(`${head.headingRaw}\n${body}`),
      position,
    };
  });
}

/**
 * One warning per FILE, never per entry — a `LESSONS.md` with forty odd headings would otherwise
 * bury every other complaint the pass has to make. Null when every heading parsed cleanly.
 */
export function lessonWarning(path: string, entries: LessonEntry[]): string | null {
  const odd = entries.filter((e) => !e.versionUsed || e.learnedOn === null).length;
  if (!odd) return null;
  return `${path}: ${odd} of ${entries.length} lesson headings did not match "## <version> - <YYYY-MM-DD> - <project>" — stored verbatim`;
}
