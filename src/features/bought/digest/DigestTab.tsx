// Org dashboard "Weekly digest" tab (id: digest) — the trailing 7 calendar days as one page a lead
// can read in a minute and paste into a leadership update.
//
// The Briefing's sibling, not its replacement: the Briefing answers "where do we stand" over the
// SELECTED period; this answers "what happened this week" over a FIXED one. That fixity is the whole
// design — a weekly update whose window silently followed a period cookie would compare different
// spans week to week and nobody would notice.
//
// SERVER component (docs/ORG-TABS-REFACTOR.md): no "use client" here or in any co-located part —
// including every chart the /org redesign added, which is deliberately hook-free and motionless (a
// digest is a static artifact people paste; an entrance animation on a document is noise). The only
// client components on the page are `CopyForLlm` and the kit's `WhyChip`, each of which is already a
// client component and crosses the boundary by itself.

import { buildWeeklyDigest } from "@/lib/org/digest";
import { weeklyDigestMarkdown } from "@/lib/org/digest-markdown";
import { SectionEmpty } from "@/components/shared/dashboard/ui";
import { getTheme } from "@/lib/theme/server";
import { digestV1 } from "./DigestTab.v1";
import { digestV2 } from "./DigestTab.v2";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function DigestTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // `sp` is accepted for shell uniformity (every panel takes the same two props) and is DELIBERATELY
  // unused: this page's window is fixed at the trailing 7 calendar days, so it reads neither the
  // period selector's `?range=`/`?from=`/`?to=` nor the period cookie. A digest that moved with the
  // selector would not be a weekly digest.
  void sp;
  const d = await buildWeeklyDigest(slug);

  if (!d) {
    // (O) The two causes of "no digest" say DIFFERENT things and this state has to cover both, because
    // `buildWeeklyDigest` collapses them: an org with nothing scanned, and an org that is scanned but
    // has no fleet GRADE — every repo sitting on the deterministic mock floor, which `hasFleetGrade`
    // now refuses (org-shared.ts). The old wording asserted only the first ("No scanned repositories
    // yet"), which was flatly wrong for the second and told a team with twelve mock-scored repos that
    // it had none.
    return (
      <SectionEmpty>
        No fleet grade for this week yet. A digest needs at least one repository scored by a live engine —
        repositories still on the mock floor are excluded from every average, so a fleet of nothing but
        mock scores has a standing of nothing rather than a standing of zero.
      </SectionEmpty>
    );
  }

  const md = weeklyDigestMarkdown(d);

  return (await getTheme()) === "prism" ? digestV2(slug, d, md) : digestV1(slug, d, md);
}
