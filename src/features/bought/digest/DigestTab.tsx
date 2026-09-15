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

import Link from "next/link";
import { buildWeeklyDigest } from "@/lib/org/digest";
import { weeklyDigestMarkdown } from "@/lib/org/digest-markdown";
import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { chipButtonClass } from "@/components/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { orgTabHref } from "@/lib/org/orgTabs";
import { DigestHeadline } from "./DigestHeadline";
import { DigestDimensions } from "./DigestDimensions";
import { DigestFollowups } from "./DigestFollowups";
import { DigestActions } from "./DigestActions";
import { DigestMovement } from "./DigestMovement";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The description is the WINDOW and nothing else. What the page contains is the page (a table
            of contents above one screen is chrome), and "copy it as markdown to paste into a
            leadership update" was already the copy chip's own `title`, on the control that does it. */}
        <SectionHeader title="Weekly digest" description={d.window.title} />
        <div className="flex flex-wrap items-center gap-2">
          {/* The standing read, over the selected period — where a reader goes when a week is not
              enough context. */}
          <Link
            href={orgTabHref(slug, "executive")}
            className={chipButtonClass()}
            title="Open the executive briefing: the same fleet over the period you have selected"
          >
            Full briefing
          </Link>
          <CopyForLlm
            text={md}
            label="Copy as markdown"
            ariaLabel="Copy the weekly digest as markdown"
            title="Copy this digest as markdown to paste into a leadership update"
          />
        </div>
      </div>

      <DigestHeadline headline={d.headline} />
      <DigestDimensions dims={d.dims} />
      <DigestFollowups slug={slug} followups={d.followups} />
      <DigestActions actions={d.actions} />
      <DigestMovement movement={d.movement} />

      {/* Provenance — printed, never swallowed. A digest is pasted into a room where nobody can ask
          the database a follow-up question, so every degraded read and every mock-engine score has to
          travel WITH the numbers rather than being quietly dropped from them. */}
      <div className="space-y-1 type-caption text-slate-500">
        <p>
          {d.provenance.scansInWindow == null
            ? "Scans in this window: could not be read."
            : `${d.provenance.scansInWindow} ${d.provenance.scansInWindow === 1 ? "scan" : "scans"} finished in this window.`}
        </p>
        {d.provenance.engineCaveat && (
          <p>
            <span aria-hidden>⚠</span> {d.provenance.engineCaveat}
          </p>
        )}
        {d.provenance.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </div>
  );
}
