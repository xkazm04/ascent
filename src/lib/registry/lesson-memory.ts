// Lesson → memory candidate (#36): what a run taught, made recallable by the agents.
//
// A lesson sitting in a row is a record; a lesson in memory is something an agent reaches for while
// working. This module is the mapping between them — pure, so the policy (namespace, kind,
// confidence, cap) is testable without a database and cannot drift into the writer.
//
// THE INSERT IS NOT HERE. It goes through the ONE ingest door in `src/lib/memory/scan-feed.ts`
// (`writeMemoryCandidate`), which owns the overlap dedup and the never-throws contract. A second
// writer beside it would be a second dedup window and a second set of rules for the same table —
// exactly the drift the one-door design exists to prevent. See `ingestSkillLessons` below for the
// seam and its current state.

import { SKILL_LESSON_SOURCE } from "./lessons";

/** Newest lessons ingested per skill per pass. The flood mitigation: a `LESSONS.md` with two years
 *  of entries would otherwise dump its whole history into memory on the first index. */
export const LESSON_MEMORY_CAP = 10;

/**
 * Confidence a lesson carries into memory. Deliberately BELOW scan-feed's 1.0.
 *
 * An observed fact about a repository ("this file exists, this check runs") is something the scanner
 * saw. A lesson is a person's claim about one run — usually true, occasionally the wrong conclusion
 * drawn from a real event, and never independently verified. The provenance band has to say so, or
 * recall will weigh a hunch as heavily as a measurement.
 */
export const LESSON_CONFIDENCE = 0.6;

export interface LessonMemoryCandidate {
  /** The `OrgSkillLesson` row this came from — stamped back as `memoryId` once written. */
  lessonId: string;
  /** The SKILL's name. Not a repo: a lesson is about the method, and filing it under a repo
   *  namespace would surface it to one project and hide it from every other user of the skill. */
  namespace: string;
  content: string;
  kind: "procedural";
  source: string;
  confidence: number;
  tags: string[];
}

/** The lesson fields this mapping needs — structurally satisfied by `SkillLessonRow`. */
export interface LessonLike {
  id: string;
  versionUsed: string;
  learnedOn: string | null;
  project: string;
  headingRaw: string;
  body: string;
  /** Non-null once this lesson has already produced a candidate. */
  memoryId: string | null;
}

/**
 * Map a skill's lessons into memory candidates, newest first, capped.
 *
 * A lesson that already carries a `memoryId` is SKIPPED. Without that skip every index pass would
 * re-ingest every lesson the registry has ever held, and the dedup door would absorb the duplicates
 * silently while the cost grew with history.
 */
export function lessonMemoryCandidates(
  skillName: string,
  lessons: LessonLike[],
  cap: number = LESSON_MEMORY_CAP,
): LessonMemoryCandidate[] {
  return lessons
    .filter((l) => !l.memoryId && l.body.trim())
    .sort((a, b) => {
      // `learnedOn` is the lesson's own claim about when the run happened. A lesson whose heading
      // carried no readable date sorts last rather than first — it is not evidence of recency.
      const at = a.learnedOn ? Date.parse(a.learnedOn) : -Infinity;
      const bt = b.learnedOn ? Date.parse(b.learnedOn) : -Infinity;
      return bt - at;
    })
    .slice(0, Math.max(0, cap))
    .map((l) => ({
      lessonId: l.id,
      namespace: skillName,
      // The heading rides along so the recalled note carries its own provenance: which version of
      // the method, on which project, taught this.
      content: `${l.headingRaw.replace(/^#+\s*/, "").trim()}\n\n${l.body.trim()}`,
      kind: "procedural" as const,
      source: SKILL_LESSON_SOURCE,
      confidence: LESSON_CONFIDENCE,
      tags: [skillName, l.versionUsed || "unversioned"],
    }));
}

export interface IngestTally {
  /** Candidates offered to the door. */
  offered: number;
  /** Candidates the door actually wrote (the rest were deduped away or persistence was off). */
  written: number;
  /** True while the ingest door does not exist in this build — see below. */
  held: boolean;
}

/**
 * Write a skill's lessons into memory through the one door.
 *
 * ── HELD, DELIBERATELY ────────────────────────────────────────────────────────────────────────────
 * The door this needs is `writeMemoryCandidate` in `src/lib/memory/scan-feed.ts` — the generalized
 * form of the existing private `writeScanMemory`, parameterized on kind/source/confidence/tags while
 * keeping its overlap prefilter and its never-throws contract. That generalization belongs to the
 * lane that owns `scan-feed.ts` and is not in this build, so this function is a NO-OP that reports
 * `held: true` rather than a second writer.
 *
 * Writing a private copy here would be the easy thing and the wrong one: two writers to `OrgMemory`
 * means two dedup windows, two confidence conventions and two definitions of "already ingested",
 * and the first symptom would be duplicate memories nobody can attribute to either path.
 *
 * TO WIRE IT (one edit, at the marked line):
 *   import { writeMemoryCandidate } from "@/lib/memory/scan-feed";
 *   const written = await writeMemoryCandidate({ orgId, ...candidate });
 *   if (written) await setLessonMemoryId(candidate.lessonId, written.id);
 *
 * Best-effort by contract either way: a memory outage must never fail an index pass.
 */
export async function ingestSkillLessons(
  _orgId: string,
  skillName: string,
  lessons: LessonLike[],
): Promise<IngestTally> {
  const candidates = lessonMemoryCandidates(skillName, lessons);
  // TODO(W1-B door): replace this block with the `writeMemoryCandidate` loop above once
  // `src/lib/memory/scan-feed.ts` exports it. Nothing else in #36 depends on this.
  return { offered: candidates.length, written: 0, held: true };
}
