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

import Link from "next/link";
import { buildExecBriefing, briefingMarkdown, valueRealizedHeading, valueRealizedLine } from "@/lib/org/briefing";
import { Card, SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { PriorPeriodGrid } from "./briefingShared";
import {
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
} from "./briefingCards";
import { BriefingProofBanner } from "./BriefingProofBanner";
import { ImpactLedger } from "./ImpactLedger";
import { ExecutiveSignalsStrip } from "./ExecutiveSignalsStrip";
import { ExecutiveTrajectoryCard } from "./ExecutiveTrajectoryCard";
import { CopyForLlm } from "@/components/CopyForLlm";
import { DownloadButton } from "@/components/report/DownloadButton";
import { BriefingShareButton } from "./BriefingShareButton";
import { BrandingSettings } from "./BrandingSettings";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { OrgLeverageMoves } from "./OrgLeverageMoves";
import { briefingShareEnabled } from "@/lib/briefing-share";
import { getCreditState, getOrgBranding } from "@/lib/db";
import { getOrgImpactLedger } from "@/lib/db/org-impact";
import { resolveStackScope } from "@/lib/org/scope";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { hasOrgRole } from "@/lib/authz";
import { resolveOrgWindow } from "@/lib/org/period";
import { chipButtonClass } from "@/components/ui";
import { orgTabHref } from "@/lib/org/orgTabs";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ExecutiveTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const period = await resolveOrgWindow(sp);
  // ?segment=<id> scopes the whole briefing to one segment (a reseller's per-client view).
  const segmentId = typeof sp.segment === "string" ? sp.segment : null;
  // ?stack=<key> scopes the whole briefing to one tech-stack group (Feature 3b) — a per-stack briefing.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const briefing = await buildExecBriefing(slug, { start: period.start, end: period.end }, period.title, segmentId, techGroupId);

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
  // EXEC-6/EXEC-5: owner-gated sharing + (enterprise) white-label. One ownership check feeds both.
  // White-label boundary (recorded 2026-07-16): branding applies to the CLIENT-FACING deliverables —
  // the briefing PDF and the anonymous /share/briefing/[token] page — but NOT to this in-app view.
  // This tab lives inside the Ascent dashboard shell (OrgHeader, nav, credits) where the operator is
  // the audience, so it intentionally keeps Ascent chrome; `getOrgBranding` is loaded here only to
  // prefill the settings form below.
  // W1d — the Impact Ledger: what the improvement loop actually bought over the SAME period the rest
  // of this briefing is scoped to. Its own read (ImprovementPr rows), deliberately not folded into
  // buildExecBriefing: the briefing is the narrative artifact that also renders on the public share
  // page and in the board PDF, and this ledger is an authenticated in-app panel. Degrades to null
  // (panel omitted) rather than failing the tab — it is evidence, not chrome the page needs.
  const impact = await getOrgImpactLedger(slug, { start: period.start, end: period.end }).catch(() => null);

  const isOwner = await hasOrgRole(slug, "owner");
  const canShare = briefingShareEnabled() && isOwner;
  const [branding, credit] = isOwner
    ? await Promise.all([getOrgBranding(slug).catch(() => null), getCreditState(slug).catch(() => null)])
    : [null, null];
  const canBrand = isOwner && planAllowsWhiteLabel(credit?.plan);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Executive briefing"
          description={`Board-ready standing for ${slug}: maturity, benchmark, trajectory, movement and goals over ${period.title.toLowerCase()}. Copy it as a markdown brief to drop into Claude Code for next actions.`}
        />
        <div className="flex flex-wrap items-center gap-2">
          {techGroups.length > 0 && <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />}
          {/* G5-23: DownloadButton, not a bare anchor — the render is CPU-bound (and may run the
              narrative pass), so a click needs a busy state and an inline error instead of navigating
              the board reader onto a raw JSON error page. Matches the sibling security tab. */}
          <DownloadButton
            // EXEC #1: carry the active ?segment= (and the ?stack= tech scope, 3b) into the export so a
            // per-client / per-stack briefing downloads the SAME scope being viewed, not the whole org.
            href={`/api/org/briefing/pdf?org=${encodeURIComponent(slug)}&range=${period.key}${period.from ? `&from=${encodeURIComponent(period.from)}` : ""}${period.to ? `&to=${encodeURIComponent(period.to)}` : ""}${segmentId ? `&segment=${encodeURIComponent(segmentId)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`}
            className={chipButtonClass()}
            title="Download the briefing as a board-ready PDF"
          >
            <span aria-hidden>↓</span> Download PDF
          </DownloadButton>
          {/* EXEC #1: carry the active segment + tech-stack scope into the share link too, so the
              read-only board link re-runs scoped to the same view the owner is sharing. */}
          {canShare && <BriefingShareButton org={slug} range={period.key} from={period.from} to={period.to} segment={segmentId} stack={activeStack?.key ?? null} />}
          <CopyForLlm text={md} label="Copy briefing for LLM" />
        </div>
      </div>

      {/* GA: each headline tile deep-links to the tab that explains it (Tile.href — whole cell), which
          is why this authenticated view passes `orgSlug`; the public share page omits it. */}
      <BriefingTiles
        maturity={maturity}
        benchmark={benchmark}
        delta={briefing.periodDelta}
        deltaLabel={period.comparisonLabel}
        orgSlug={slug}
      />

      {/* UAT DANA-L1-010 — heading follows the sign; the number is never hidden (G1). */}
      {valueRealizedLine(briefing.valueRealized, briefing.coverage.scanned) && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
          <span className="font-mono text-sm uppercase tracking-widest text-accent">{valueRealizedHeading(briefing.valueRealized)}</span>{" "}
          <span className="text-base text-slate-200">{valueRealizedLine(briefing.valueRealized, briefing.coverage.scanned)}</span>
        </div>
      )}

      {/* The rollout PROOF — previously page-local to Practices; the VP defending the AI budget
          reads this page, so the "it worked" numbers live here too (same line as PDF/markdown). */}
      <BriefingProofBanner proof={briefing.proof} />

      {/* W1d — the Impact Ledger. Distinct from the proof banner above it: that one is a one-line
          BREADTH read of practice rollout (how many practices travelled, mean lift); this is the
          per-PR STATEMENT OF ACCOUNT — every merged direction, its measured dimension delta, and an
          explicit count of what hasn't been re-scanned yet and therefore bought nothing. */}
      {impact && <ImpactLedger slug={slug} ledger={impact} periodTitle={period.title} />}

      {/* GB: fleet signals as ONE wrap-row strip instead of three stacked <p> lines. */}
      <ExecutiveSignalsStrip briefing={briefing} />

      <ExecutiveTrajectoryCard briefing={briefing} periodHasStart={!!period.start} />

      {briefing.priorPeriod && (
        <Card>
          <SectionHeader size="sm" title="vs previous period" description="This period's end state against the equal-length window before it." />
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

      <BriefingGoalsCard
        goals={briefing.goals}
        emptyText="No goals set. Define maturity targets on the Plan tab to track progress here."
        right={
          <Link href={orgTabHref(slug, "plan")} className="focus-ring font-mono text-sm text-slate-500 transition hover:text-accent">
            Manage goals →
          </Link>
        }
      />

      {canBrand && <BrandingSettings slug={slug} initial={branding ?? { brandName: null, brandColor: null, logoUrl: null }} />}
    </div>
  );
}
