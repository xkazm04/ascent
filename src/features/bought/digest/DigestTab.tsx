// Org dashboard "Weekly digest" tab (id: digest) — the trailing 7 calendar days as one page a lead
// can read in a minute and paste into a leadership update.
//
// The Briefing's sibling, not its replacement: the Briefing answers "where do we stand" over the
// SELECTED period; this answers "what happened this week" over a FIXED one. That fixity is the whole
// design — a weekly update whose window silently followed a period cookie would compare different
// spans week to week and nobody would notice.
//
// SERVER component (docs/ORG-TABS-REFACTOR.md): no "use client" here or in any co-located part. The
// one client thing on the page is `CopyForLlm`, which is already a client component and crosses the
// boundary by itself.

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
    return (
      <SectionEmpty>
        No scanned repositories yet. Scan some of this org&apos;s repos to generate a weekly digest.
      </SectionEmpty>
    );
  }

  const md = weeklyDigestMarkdown(d);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Weekly digest"
          description={`${d.window.title}: how every dimension moved, which follow-ups closed and opened, and the next three actions. Copy it as markdown to paste into a leadership update.`}
        />
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
