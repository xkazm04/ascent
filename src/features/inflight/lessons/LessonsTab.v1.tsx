// The Altimeter composition of the Lessons tab: the former LessonsTab markup, moved here unchanged.
import { SectionEmpty, SectionHeader } from "@/components/shared/dashboard/ui";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { LessonsWorklist } from "./LessonsWorklist";
import type { LessonsTabData } from "./lessonsTabData";

export function lessonsV1({ slug, lessons, counts: c }: LessonsTabData) {
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
      {lessons.length > 0 && <NextMoveLink href={orgTabHref(slug, "live")} to="live" />}
    </div>
  );
}
