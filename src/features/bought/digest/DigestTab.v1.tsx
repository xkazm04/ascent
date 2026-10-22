// The Altimeter composition of the Weekly digest tab (moved unchanged from DigestTab.tsx). Server-safe:
// no hooks here; CopyForLlm and WhyChip are client components that cross the boundary themselves.
import Link from "next/link";
import { SectionHeader } from "@/components/org/shared/ui";
import { chipButtonClass } from "@/components/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { WeeklyDigest } from "@/lib/org/digest-types";
import { DigestHeadline } from "./DigestHeadline";
import { DigestDimensions } from "./DigestDimensions";
import { DigestFollowups } from "./DigestFollowups";
import { DigestActions } from "./DigestActions";
import { DigestMovement } from "./DigestMovement";

export function digestV1(slug: string, d: WeeklyDigest, md: string) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The description is the WINDOW and nothing else. What the page contains is the page (a table
            of contents above one screen is chrome), and "copy it as markdown to paste into a
            leadership update" was already the copy chip's own `title`, on the control that does it. */}
        <SectionHeader title="Weekly digest" description={d.window.title} />
        <div className="flex flex-wrap items-center gap-2">
          {/* The standing read, over the selected period: where a reader goes when a week is not
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

      <Provenance p={d.provenance} />
      <NextMoveLink href={orgTabHref(slug, "overview")} to="overview" />
    </div>
  );
}

// Provenance is printed, never swallowed. A digest is pasted into a room where nobody can ask the database
// a follow-up question, so every degraded read and every mock-engine score travels WITH the numbers.
function Provenance({ p }: { p: WeeklyDigest["provenance"] }) {
  return (
    <div className="space-y-1 type-caption text-slate-500">
      <p>
        {p.scansInWindow == null
          ? "Scans in this window: could not be read."
          : `${p.scansInWindow} ${p.scansInWindow === 1 ? "scan" : "scans"} finished in this window.`}
      </p>
      {p.engineCaveat && (
        <p>
          <span aria-hidden>⚠</span> {p.engineCaveat}
        </p>
      )}
      {p.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}
