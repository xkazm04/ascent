// Org dashboard "Briefing" tab (id: executive) — an exec-grade summary that assembles maturity,
// corpus benchmark, trajectory, movement and goals into one board-ready narrative, with a "Copy
// briefing for LLM" action that emits a markdown brief to paste into Claude Code (Direction #5 + the
// #6 LLM-consumption baseline).
//
// Migrated onto the org tab shell (docs/ORG-TABS-REFACTOR.md):
//   - SERVER component, filename PINNED as `ExecutiveTab.tsx`; takes `slug` + the resolved `sp` as
//     props since it is no longer a route.
//   - Its old route (src/app/org/[slug]/executive/page.tsx) is now a redirect() — 3 internal call
//     sites (incl. the digest email) go through `orgTabHref`.
//   - The shared Card blocks (briefingCards.tsx) keep their deliberately "public-by-default" prop
//     surface — this tab is the one that turns every internal-only affordance ON. The public
//     /share/briefing/[token] page is untouched and renders the same components with those props OFF.
//     ExecutiveTab.test.tsx (moved from the old page.test.tsx) pins that this tab still does so.

import { buildExecBriefing, briefingMarkdown, valueRealizedHeading, valueRealizedLine } from "@/lib/org/briefing";
import { Card, SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { PriorPeriodGrid } from "./briefingShared";
import {
  BriefingBrandHeader,
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
  hasBriefingBrand,
} from "./briefingCards";
import { BriefingProofBanner } from "./BriefingProofBanner";
import { ExecutiveTabActions } from "./ExecutiveTabActions";
import { BriefingBasisNote } from "./BriefingBasisNote";
import { ImpactLedger } from "./ImpactLedger";
import { ExecutiveSignalsStrip } from "./ExecutiveSignalsStrip";
import { ExecutiveTrajectoryCard } from "./ExecutiveTrajectoryCard";
import { BrandingSettings } from "./BrandingSettings";
import { OrgLeverageMoves } from "./OrgLeverageMoves";
import { briefingShareEnabled } from "@/lib/briefing-share";
import { getCreditState, getOrgBranding } from "@/lib/db";
import { getOrgImpactLedger } from "@/lib/db/org-impact";
import { getOrgProgram } from "@/lib/db/org-program";
import { ProgramPanel } from "./ProgramPanel";
import { resolveStackScope } from "@/lib/org/scope";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { hasOrgRole } from "@/lib/authz";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ExecutiveTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const period = await resolveOrgWindow(sp);
  // ?segment=<id> scopes the whole briefing to one segment (a reseller's per-client view).
  const segmentId = typeof sp.segment === "string" ? sp.segment : null;
  // ?stack=<key> scopes the whole briefing to one tech-stack group (Feature 3b) — a per-stack briefing.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const briefing = await buildExecBriefing(slug, orgWindowBounds(period), period.title, segmentId, techGroupId);

  if (!briefing) {
    return (
      <SectionEmpty>
        No scanned repositories yet. Scan some of this org&apos;s repos to generate an executive briefing.
      </SectionEmpty>
    );
  }

  // Highest-leverage fleet moves — the ranked, projected-gain recommendations. Moved here from the
  // Overview so the Briefing owns the "what to do next" narrative (it supersedes the old single
  // "Recommended next move" line). G5-02: this list now rides ON the briefing (already scoped to the
  // same segment/stack), rather than being queried a second time here — so the screen, the markdown
  // export and the board PDF are literally reading the same ranked rows and cannot name different
  // moves.
  const orgRecs = briefing.recommendations ?? [];

  const md = briefingMarkdown(briefing);
  const { maturity, benchmark } = briefing;
  // EXEC-6/EXEC-5: owner-gated sharing + (Team+) white-label. One ownership check feeds both.
  // White-label paints this tab's compact briefing header (logo, name, accent kicker) plus the PDF
  // and /share/briefing/[token]; OrgShell/nav stay Ascent chrome. `getOrgBranding` also prefills
  // BrandingSettings. W1d Impact Ledger is an authenticated panel (not on share/PDF). W1c programme
  // lives here as the named commitment leadership reads the briefing against.
  // Direction 3 — independent reads in one Promise.all; ownership still gates branding/credit below.
  const [impact, program, isOwner] = await Promise.all([
    getOrgImpactLedger(slug, orgWindowBounds(period)).catch(() => null),
    getOrgProgram(slug).catch(() => null),
    hasOrgRole(slug, "owner"),
  ]);
  const canShare = briefingShareEnabled() && isOwner;
  const [branding, credit] = isOwner
    ? await Promise.all([getOrgBranding(slug).catch(() => null), getCreditState(slug).catch(() => null)])
    : [null, null];
  const canBrand = isOwner && planAllowsWhiteLabel(credit?.plan);

  return (
    <div className="space-y-6">
      {canBrand && hasBriefingBrand(branding) && <BriefingBrandHeader branding={branding} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* A header is a noun phrase (docs/ORG-UX-REDESIGN.md §2.3). What the briefing contains is
            what the reader can see below it; the window is the only thing the tiles cannot state, so
            the window is all that survives. "Copy it as a markdown brief to drop into Claude Code"
            was already the copy button's own tooltip (CopyForLlm's default `title`). */}
        <SectionHeader title="Executive briefing" description={period.title} />
        <ExecutiveTabActions
          slug={slug}
          period={period}
          segmentId={segmentId}
          techGroups={techGroups}
          activeStack={activeStack}
          canShare={canShare}
          md={md}
        />
      </div>

      {/* GA: each headline tile deep-links to the tab that explains it (Tile.href — whole cell), which
          is why this authenticated view passes `orgSlug`; the public share page omits it. */}
      <BriefingTiles
        maturity={maturity}
        benchmark={benchmark}
        delta={briefing.periodDelta}
        deltaLabel={period.comparisonLabel}
        realScoredCount={briefing.realScoredCount}
        orgSlug={slug}
      />

      {/* The two denominators, right under the tiles they explain: how much of the fleet was looked
          at, and what the averages above are actually averaged over (Direction 1 + 2). */}
      <BriefingBasisNote briefing={briefing} />

      {/* UAT DANA-L1-010 — heading follows the sign; the number is never hidden (G1). */}
      {valueRealizedLine(briefing.valueRealized, briefing.realScoredCount) && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
          <span className="type-mono-sm uppercase tracking-widest text-accent">{valueRealizedHeading(briefing.valueRealized)}</span>{" "}
          <span className="type-body text-slate-200">{valueRealizedLine(briefing.valueRealized, briefing.realScoredCount)}</span>
        </div>
      )}

      {/* The rollout PROOF — previously page-local to Practices; the VP defending the AI budget
          reads this page, so the "it worked" numbers live here too (same line as PDF/markdown). */}
      <BriefingProofBanner proof={briefing.proof} loopProof={briefing.loopProof} />

      {/* W1d — the Impact Ledger. Distinct from the proof banner above it: that one is a one-line
          BREADTH read of practice rollout (how many practices travelled, mean lift); this is the
          per-PR STATEMENT OF ACCOUNT — every merged direction, its measured dimension delta, and an
          explicit count of what hasn't been re-scanned yet and therefore bought nothing. */}
      {impact && <ImpactLedger slug={slug} ledger={impact} periodTitle={period.title} />}

      {/* The programme control (start / re-target / pause / end) — the only place it can be changed. */}
      {/* `now` is the far end of the movement the programme's baseline axis draws — the same fleet
          overall the tiles above print, so the drawing and the headline cannot disagree. */}
      <ProgramPanel slug={slug} initial={program} now={briefing.realScoredCount > 0 ? maturity.overall : null} />

      {/* GB: fleet signals as ONE wrap-row strip instead of three stacked <p> lines. */}
      <ExecutiveSignalsStrip briefing={briefing} />

      <ExecutiveTrajectoryCard briefing={briefing} periodHasStart={!!period.start} />

      {briefing.priorPeriod && (
        <Card>
          {/* The description said "This period's end state against the equal-length window before
              it." That framing is now the mark itself: PriorPeriodGrid draws a hollow origin dot at
              the prior window's end and a filled dot at now, on one 0-100 track, and the sentence is
              the generated <title> on every one of them (PeriodDumbbell). */}
          <SectionHeader size="sm" title="vs previous period" />
          <PriorPeriodGrid prior={briefing.priorPeriod} now={maturity} showDimensions />
        </Card>
      )}

      {/* Highest-leverage moves — the ranked "what to do next", replacing the old single-line
          "Recommended next move" (which named only the weakest dimension). */}
      {orgRecs.length > 0 && <OrgLeverageMoves recs={orgRecs} slug={slug} />}

      {/* Practice deep-links + the security row are the two authenticated-only affordances of this
          block; the share page renders the same component without them. */}
      <BriefingDimensionCards
        strengths={briefing.strengths}
        risks={briefing.risks}
        security={briefing.security}
        practiceOrgSlug={slug}
      />

      {/* `reportLinks` opts this view into per-mover report permalinks (the share page stays static).
          The fleet-wide movement scale is deliberately NOT passed — the signals strip above has it. */}
      <BriefingMovementCard gainers={briefing.topGainers} regressions={briefing.topRegressions} reportLinks />

      {/* Goals are READ here. Their management UI retired with the Plan tab (2026-08-17); the
          transition programme above is the org's one named commitment now. */}
      <BriefingGoalsCard goals={briefing.goals} emptyText="No goals set." />

      {canBrand && <BrandingSettings slug={slug} initial={branding ?? { brandName: null, brandColor: null, logoUrl: null }} />}
    </div>
  );
}
