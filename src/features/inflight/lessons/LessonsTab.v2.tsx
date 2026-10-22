// The Prism composition of the Lessons tab: a masthead that states what is held for a decision, then one
// ruled Frame holding the ledger. Same data and same ledger behaviour as v1.
import { Frame, Masthead } from "@/components/kit";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { LessonsWorklistV2 } from "./LessonsWorklist.v2";
import type { LessonsTabData } from "./lessonsTabData";

export function lessonsV2({ slug, lessons, counts: c }: LessonsTabData) {
  return (
    <div data-role="lessons-v2" className="stagger-children space-y-8">
      <Masthead
        eyebrow="In flight"
        statement="What the loop learned,"
        named="held for a decision."
        lede="What the loop's agents say this fleet taught them. Nothing here is memory until you keep it."
        figures={[
          { label: "Awaiting review", value: c.pending },
          { label: "Kept", value: c.kept },
          { label: "Discarded", value: c.discarded },
        ]}
      />
      <Frame aria-label="Lesson candidates">
        {lessons.length === 0 ? (
          <p className="type-body text-slate-300">No lesson candidates yet. When a loop run&apos;s agent reports something a repository taught it, it lands here for review.</p>
        ) : (
          <LessonsWorklistV2 org={slug} initial={lessons} />
        )}
      </Frame>
      {lessons.length > 0 && <NextMoveLink href={orgTabHref(slug, "live")} to="live" />}
    </div>
  );
}
