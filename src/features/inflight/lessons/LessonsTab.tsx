// Org dashboard "Lessons" tab (In flight) — the loop agents' lesson candidates as a decision ledger.
// Split out of the Live cockpit on 2026-09-15 (it was the `CockpitLessons` list under the outcome
// sheet): a review queue deserves the same ledger shape the Proposals tab has, not a footnote.
//
// SERVER component, filename PINNED as LessonsTab.tsx. One read — every candidate, any status — so
// the settled archive is the same rows filtered client-side, never a second round trip.
//
// THEME DUALITY: the theme picks the composition (LessonsTab.v1.tsx Altimeter, LessonsTab.v2.tsx Prism).

import { SectionEmpty } from "@/components/shared/dashboard/ui";
import { isPersonalOrg } from "@/lib/db";
import { listLoopLessons } from "@/lib/db/loop-lessons";
import { getTheme } from "@/lib/theme/server";
import { lessonsV1 } from "./LessonsTab.v1";
import { lessonsV2 } from "./LessonsTab.v2";
import { lessonCounts } from "./lessonsModel";
import type { LessonsTabData } from "./lessonsTabData";

export async function LessonsTab({ slug }: { slug: string }) {
  // A personal workspace runs no loop, so it has no candidates; the rail hides the tab, this is the
  // deep-link backstop.
  if (await isPersonalOrg(slug)) {
    return <SectionEmpty>Lesson candidates come from loop runs over an organization&apos;s fleet.</SectionEmpty>;
  }
  const [lessons, theme] = await Promise.all([listLoopLessons(slug, undefined, 200), getTheme()]);
  const data: LessonsTabData = { slug, lessons, counts: lessonCounts(lessons) };
  return theme === "prism" ? lessonsV2(data) : lessonsV1(data);
}
