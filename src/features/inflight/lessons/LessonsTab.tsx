// Org dashboard "Lessons" tab (In flight) — the loop agents' lesson candidates as a decision ledger.
// Split out of the Live cockpit on 2026-09-15 (it was the `CockpitLessons` list under the outcome
// sheet): a review queue deserves the same ledger shape the Proposals tab has, not a footnote.
//
// SERVER component, filename PINNED as LessonsTab.tsx. One read — every candidate, any status — so
// the settled archive is the same rows filtered client-side, never a second round trip.

import { SectionEmpty } from "@/components/shared/dashboard/ui";
import { isPersonalOrg } from "@/lib/db";
import { listLoopLessons } from "@/lib/db/loop-lessons";
import { lessonsView } from "./LessonsTabView";
import { lessonCounts } from "./lessonsModel";
import type { LessonsTabData } from "./lessonsTabData";

export async function LessonsTab({ slug }: { slug: string }) {
  // A personal workspace runs no loop, so it has no candidates; the rail hides the tab, this is the
  // deep-link backstop.
  if (await isPersonalOrg(slug)) {
    return <SectionEmpty>Lesson candidates come from loop runs over an organization&apos;s fleet.</SectionEmpty>;
  }
  const lessons = await listLoopLessons(slug, undefined, 200);
  const data: LessonsTabData = { slug, lessons, counts: lessonCounts(lessons) };
  return lessonsView(data);
}
