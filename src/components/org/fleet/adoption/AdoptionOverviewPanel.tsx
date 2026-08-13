// The Adoption tab's one data region — moved from the old page.tsx body (docs/ORG-TABS-REFACTOR.md).

import Link from "next/link";
import { buildAdoptionOverview, adoptionMarkdown } from "@/lib/org/adoption";
import { SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { Surface, Kicker } from "@/components/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { CopyForLlm } from "@/components/CopyForLlm";
import { resolveOrgScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { SnapshotScopeNotice } from "@/components/org/shared/SnapshotScopeNotice";
import { scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { AdoptionSpectrum } from "./AdoptionSpectrum";
import { ChampionsCard } from "./ChampionsCard";
import { TeamAdoption } from "./TeamAdoption";
import { EnablementTargets } from "./EnablementTargets";
import { DeliveryStrip } from "./DeliveryStrip";
import { AdoptionToolFootprint } from "./AdoptionToolFootprint";

// Adoption-band hues (neutral accent, not the red→green maturity ramp — low adoption is an expected
// early baseline, not a defect). Restored from the origin/master side of the 2026-07-02 merge, whose
// resolution kept the BAND.some Tile colors but dropped this constant.
const BAND = { high: "#16a34a", some: "#3b9eff", none: "#64748b" } as const;

type SearchParams = { [key: string]: string | string[] | undefined };

export async function AdoptionOverviewPanel({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional segment + tech-stack scope (bogus id/key → whole fleet) — a per-client / per-stack
  // adoption read for orgs that segment their fleet; the two filters compose.
  const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);
  // The period is cross-tab state (cookie + ?range=), so a window chosen on Overview arrives here even
  // though NOTHING below can honour it — buildAdoptionOverview reads latest-scan snapshots with no
  // per-day history. Resolve it anyway, purely to NAME the inapplicable selection in the notice; see
  // SnapshotScopeNotice for why threading it into the query would be a fake fix.
  const [period, a] = await Promise.all([resolveOrgWindow(sp), buildAdoptionOverview(slug, segmentId, techGroupId)]);

  const filterBar = (
    <ScopeFilterBar segments={segments} segmentId={segmentId} techGroups={techGroups} activeStack={activeStack} />
  );

  if (!a) {
    return (
      <div>
        <div className="mb-4 flex justify-end">{filterBar}</div>
        <SectionEmpty>
          No contributor data {segmentId || activeStack ? "for this filter" : "yet"} — scan some of this org&apos;s repositories (with a
          GitHub token for commit history) to measure AI adoption.
        </SectionEmpty>
      </div>
    );
  }

  const md = adoptionMarkdown(a);
  const d = a.delivery;
  // No population re-check here on purpose: buildAdoptionOverview returns `enablement: []` below the
  // floor (which getContributorInsights itself enforces), so an empty list IS the guard. A second
  // copy of the threshold at the call site is what let three surfaces drift apart in the first place.
  const showEnablement = a.enablement.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="AI adoption"
          description="How AI-native the org's engineering actually is — commit-level AI attribution, the champions carrying the culture, and the delivery health it sits beside. Copy the brief into Claude Code for an enablement plan."
        />
        <div className="flex flex-wrap items-center gap-2">
          {filterBar}
          <CopyForLlm text={md} label="Copy adoption brief for LLM" />
        </div>
      </div>

      {/* Stated ABOVE the numbers, not in the footnote below them: the failure this kills is a user
          who picked 90 days on Overview reading these tiles as 90-day figures. */}
      <SnapshotScopeNotice
        period={period}
        subject="adoption"
        scopedHref={orgTabHref(slug, "delivery")}
        scopedLabel="Delivery"
      />

      <div className={TILE_GRID}>
        {/* Adoption metrics use a neutral accent hue, not the red→green maturity ramp: low adoption
            here is an expected early baseline, not a defect, so scoreHex would read 8% as alarm-red. */}
        <Tile label="Org AI commit share" value={`${a.orgAiShare}%`} color={BAND.some} sub="commit-weighted" />
        <Tile
          label="AI-active contributors"
          value={`${a.contributors.aiActive}/${a.contributors.total}`}
          sub={`${a.contributors.aiActiveShare}% of contributors`}
          color={BAND.some}
        />
        {/* Also an adoption rate (share of PRs with AI involvement) → BAND.some, not scoreHex: an
            early-days 8% here is baseline, not alarm-red. Only aiGovernedRate below is a health
            rate that earns the maturity ramp. */}
        <Tile
          label="AI-involved PRs"
          value={d ? `${d.aiInvolvedRate}%` : "—"}
          sub={d ? `${d.prs} PRs analyzed` : "no PR data"}
          color={d ? BAND.some : undefined}
        />
        <Tile
          label="AI PRs human-reviewed"
          value={d?.aiGovernedRate != null ? `${d.aiGovernedRate}%` : "—"}
          sub="governance on AI-involved PRs"
          color={d?.aiGovernedRate != null ? scoreHex(d.aiGovernedRate) : undefined}
        />
      </div>

      <AdoptionSpectrum
        distribution={a.distribution}
        total={a.contributors.total}
        knowledgeLeader={a.knowledgeLeader}
        slug={slug}
        showEnablementLink={showEnablement}
      />

      {a.tools.length > 0 && <AdoptionToolFootprint tools={a.tools} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <ChampionsCard champions={a.champions} totalContributors={a.contributors.total} slug={slug} />
        <TeamAdoption teams={a.teams} pairing={a.teamPairing} slug={slug} />
      </div>

      {showEnablement && <EnablementTargets slug={slug} targets={a.enablement} nonePool={a.distribution.none} />}

      {d ? (
        <DeliveryStrip delivery={d} slug={slug} />
      ) : (
        <Surface radius="xl" className="px-5 py-4">
          <Kicker tone="muted">Delivery · context</Kicker>
          <p className="mt-1 text-sm text-slate-500">
            No pull-request data yet — connect a GitHub token or the GitHub App to read PR signals alongside adoption.{" "}
            <Link href={`/org/${slug}/settings`} className="font-mono text-xs uppercase tracking-widest transition hover:text-accent">
              Settings →
            </Link>
          </p>
        </Surface>
      )}

      <p className="font-mono text-sm text-slate-600">
        {/* The scan-time framing now leads the panel (SnapshotScopeNotice) instead of hiding here, so
            this footnote carries only the attribution mechanics it uniquely explains. */}
        AI attribution reads co-authorship and tool markers on commits and PRs. Team rollups use CODEOWNERS attribution — see the{" "}
        <Link href={orgTabHref(slug, "teams")} className="text-slate-500 transition hover:text-accent">Teams</Link> tab.
      </p>
    </div>
  );
}
