// The composition of the Weekly digest tab: the week's standing is the masthead (statement, three
// figures with their movement, the actions), the population strip sits under it, and the four readings
// (dimensions, follow-ups, actions, movement) are ruled Frames. Digest, same parts; the window
// stays fixed. Server-safe: no hooks; CopyForLlm and WhyChip are client components that cross by themselves.
import { Caption, Frame, GhostAction, Masthead, Movement, type MastheadFigure } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import { WhyChip } from "@/components/shared/viz";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { WeeklyDigest } from "@/lib/org/digest-types";
import { DigestActions } from "./DigestActions";
import { DigestCoverageStrip } from "./DigestCoverageStrip";
import { DigestDimensions } from "./DigestDimensions";
import { DigestFollowups } from "./DigestFollowups";
import { cohortHint } from "./DigestHeadline";
import { DigestMovement } from "./DigestMovement";
import { coverageView } from "./digestViz";

export function digestView(slug: string, d: WeeklyDigest, md: string) {
  const h = d.headline;
  const fig = (label: string, value: number, delta: number | null): MastheadFigure => ({
    label,
    value,
    detail: h.cohortSize == null ? "No baseline this week" : delta ? <Movement delta={delta} basis="this week" /> : "Held this week",
  });
  const p = d.provenance;
  return (
    <div data-role="digest-v2" className="stagger-children space-y-10">
      <Masthead
        eyebrow={`Weekly digest · ${d.window.title}`}
        statement="The fleet stands at"
        named={`${h.levelId} · ${h.levelName}`}
        figures={[fig("Overall", h.overall, h.dOverall), fig("AI Adoption", h.adoption, h.dAdoption), fig("Engineering Rigor", h.rigor, h.dRigor)]}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <GhostAction href={orgTabHref(slug, "executive")} aria-label="Open the executive briefing: the same fleet over the period you have selected">
              Full briefing
            </GhostAction>
            <CopyForLlm
              text={md}
              label="Copy as markdown"
              ariaLabel="Copy the weekly digest as markdown"
              title="Copy this digest as markdown to paste into a leadership update"
            />
          </div>
        }
        pattern="dots"
      />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <DigestCoverageStrip view={coverageView(h)} />
        </div>
        <WhyChip hint={cohortHint(h)} label="delta cohort" align="end" className="mt-1" />
      </div>
      <Frame aria-label="Dimensions">
        <DigestDimensions dims={d.dims} />
      </Frame>
      <Frame aria-label="Follow-ups">
        <DigestFollowups slug={slug} followups={d.followups} />
      </Frame>
      <Frame aria-label="Actions">
        <DigestActions actions={d.actions} />
      </Frame>
      <Frame aria-label="Movement">
        <DigestMovement movement={d.movement} />
      </Frame>
      <Frame edge="both" pad="sm" aria-label="Provenance">
        <div className="space-y-1">
          <Caption>
            {p.scansInWindow == null
              ? "Scans in this window: could not be read."
              : `${p.scansInWindow} ${p.scansInWindow === 1 ? "scan" : "scans"} finished in this window.`}
          </Caption>
          {p.engineCaveat && (
            <Caption>
              <span aria-hidden>⚠</span> {p.engineCaveat}
            </Caption>
          )}
          {p.notes.map((note) => (
            <Caption key={note}>{note}</Caption>
          ))}
        </div>
      </Frame>
      <NextMoveLink href={orgTabHref(slug, "overview")} to="overview" />
    </div>
  );
}
