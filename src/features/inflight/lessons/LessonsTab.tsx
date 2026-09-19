// Org dashboard "Lessons" tab (In flight) — the loop agents' lesson candidates as a decision ledger.
// Split out of the Live cockpit on 2026-09-15 (it was the `CockpitLessons` list under the outcome
// sheet): a review queue deserves the same ledger shape the Proposals tab has, not a footnote.
//
// SERVER component, filename PINNED as LessonsTab.tsx. One read — every candidate, any status — so
// the settled archive is the same rows filtered client-side, never a second round trip.

import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { isPersonalOrg } from "@/lib/db";
import { listLoopLessons } from "@/lib/db/loop-lessons";
import { LessonsWorklist } from "./LessonsWorklist";
import { lessonCounts } from "./lessonsModel";

export async function LessonsTab({ slug }: { slug: string }) {
  // A personal workspace runs no loop, so it has no candidates; the rail hides the tab, this is the
  // deep-link backstop.
  if (await isPersonalOrg(slug)) {
    return <SectionEmpty>Lesson candidates come from loop runs over an organization&apos;s fleet.</SectionEmpty>;
  }
  const lessons = await listLoopLessons(slug, undefined, 200);
  const c = lessonCounts(lessons);

  return (
    <div className="stagger-children space-y-5">
      <SectionHeader
        title="Lessons"
        description="What the loop's agents say this fleet taught them, held for a decision."
        right={
          <span className="type-mono-sm text-slate-400">
            <span className="tabular-nums text-slate-100">{c.pending}</span> awaiting review ·{" "}
            <span className="tabular-nums text-accent">{c.kept}</span> kept · <span className="tabular-nums">{c.discarded}</span> discarded
          </span>
        }
      />
      {lessons.length === 0 ? (
        <SectionEmpty>No lesson candidates yet. When a loop run&apos;s agent reports something a repository taught it, it lands here for review.</SectionEmpty>
      ) : (
        <LessonsWorklist org={slug} initial={lessons} />
      )}
    </div>
  );
}
