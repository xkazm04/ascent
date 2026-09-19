// The Adoption tab's one data region — moved from the old page.tsx body (docs/ORG-TABS-REFACTOR.md).
//
// /org redesign, Wave 2 (docs/ORG-UX-REDESIGN.md §2): the panel opens on the adoption CURVE, not on a
// paragraph and a row of tiles. The header's 213-character lede is gone — its definition half is a
// WhyChip, its contents list was the page's own structure, its CTA instruction sits on the CTA, and
// only the snapshot WINDOW survives in the description, which §2.3 permits at ≤60 characters.

import Link from "next/link";
import { buildAdoptionOverview, adoptionMarkdown } from "@/lib/org/adoption";
import { SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { Surface, Kicker } from "@/components/ui";
import { WhyChip } from "@/components/org/viz";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { CopyForLlm } from "@/components/CopyForLlm";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex } from "@/lib/ui";
import { AdoptionSpectrum, ADOPTION_TINT } from "./AdoptionSpectrum";
import { ChampionsCard } from "./ChampionsCard";
import { TeamAdoption } from "./TeamAdoption";
import { DeliveryStrip } from "./DeliveryStrip";
import { AdoptionToolFootprint } from "./AdoptionToolFootprint";
import { ATTRIBUTION_HINT, DENOMINATOR_HINT } from "./adoptionHints";

type SearchParams = { [key: string]: string | string[] | undefined };

/**
 * The one surviving `SectionHeader description` in this directory: unit and window only, no meaning
 * (§2.3). It is not decoration — the period picker is cross-tab state, so someone who chose "90 days"
 * on Overview arrives with that selection still showing and nothing here can honour it
 * (`buildAdoptionOverview` reads latest-scan snapshots with no per-day history). That is the
 * difference between a stale number and a wrong one, and it is a WINDOW statement, which is exactly
 * the survivor form the law allows. Delete it only along with the period picker.
 */
const WINDOW_NOTE = "Latest-scan snapshot · the period selector does not apply";

export async function AdoptionOverviewPanel({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional segment + tech-stack scope (bogus id/key → whole fleet) — a per-client / per-stack
  // adoption read for orgs that segment their fleet; the two filters compose.
  const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);
  const a = await buildAdoptionOverview(slug, segmentId, techGroupId);

  const filterBar = (
    <ScopeFilterBar segments={segments} segmentId={segmentId} techGroups={techGroups} activeStack={activeStack} />
  );

  if (!a) {
    return (
      <div>
        <div className="mb-4 flex justify-end">{filterBar}</div>
        <SectionEmpty>
          No contributor data {segmentId || activeStack ? "for this filter" : "yet"}: scan some of this org&apos;s repositories (with a
          GitHub token for commit history) to measure AI adoption. Adoption here is read from commits and PRs — co-authorship trailers and
          tool markers — so a fleet scanned without commit history has an org-wide picture but no adoption curve to draw.
        </SectionEmpty>
      </div>
    );
  }

  const md = adoptionMarkdown(a);
  const d = a.delivery;
  // The "Who to enable next" TABLE moved to the Contributors tab (2026-08-19). This flag survives
  // only to decide whether the spread's "none" follow-up is a live cross-tab link or plain text —
  // an empty cohort (below the naming floor, or nobody qualifying) must not offer a link to nothing.
  const showEnablement = a.enablement.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="AI adoption"
          description={WINDOW_NOTE}
          right={<WhyChip hint={ATTRIBUTION_HINT} label="how AI attribution is read" />}
        />
        <div className="flex flex-wrap items-center gap-2">
          {filterBar}
          {/* (A3) The CTA instruction moved onto the CTA, where it is an affordance rather than chrome. */}
          <CopyForLlm
            text={md}
            label="Copy adoption brief for LLM"
            title="Copy the adoption brief into Claude Code for an enablement plan"
          />
        </div>
      </div>

      {/* §2.2 — first sight is graphical: the curve carries the panel's headline reading, above the
          tiles that quantify it. */}
      <AdoptionSpectrum
        distribution={a.distribution}
        total={a.contributors.total}
        orgAiShare={a.orgAiShare}
        knowledgeLeader={a.knowledgeLeader}
        slug={slug}
        showEnablementLink={showEnablement}
      />

      <div className={TILE_GRID}>
        {/* Adoption rates paint from ADOPTION_TINT, not the red→green maturity ramp: low adoption here
            is an expected early baseline, not a defect, so scoreHex would read 8% as alarm-red. Only
            aiGovernedRate below is a health rate that earns the ramp. */}
        {/* The share carries its denominator, like every tile beside it. `orgCommits` is null (never
            0) when the naming floor withheld the per-person rows the total is summed from — then the
            sub says how the number is weighted and claims no population. */}
        <Tile
          label="Org AI commit share"
          value={`${a.orgAiShare}%`}
          color={ADOPTION_TINT}
          sub={a.orgCommits != null ? `commit-weighted, of ${a.orgCommits.toLocaleString()} commits` : "commit-weighted"}
        />
        <Tile
          label="AI-active contributors"
          value={`${a.contributors.aiActive}/${a.contributors.total}`}
          sub={`${a.contributors.aiActiveShare}% of contributors`}
          color={ADOPTION_TINT}
        />
        <Tile
          label="AI-involved PRs"
          value={d ? `${d.aiInvolvedRate}%` : "—"}
          sub={d ? `${d.prs} PRs analyzed` : "no PR data"}
          color={d ? ADOPTION_TINT : undefined}
        />
        <Tile
          label="AI PRs human-reviewed"
          value={d?.aiGovernedRate != null ? `${d.aiGovernedRate}%` : "—"}
          sub="governance on AI-involved PRs"
          color={d?.aiGovernedRate != null ? scoreHex(d.aiGovernedRate) : undefined}
        />
      </div>

      {a.orgCommits == null && (
        // (D) The withheld denominator, reachable beside the tile that has none.
        <p className="flex items-center gap-2 type-mono-sm text-slate-600">
          Commit total withheld below the naming floor
          <WhyChip hint={DENOMINATOR_HINT} label="withheld commit total" />
        </p>
      )}

      {a.tools.length > 0 && <AdoptionToolFootprint tools={a.tools} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <ChampionsCard champions={a.champions} totalContributors={a.contributors.total} slug={slug} />
        <TeamAdoption teams={a.teams} pairing={a.teamPairing} slug={slug} />
      </div>

      {d ? (
        <DeliveryStrip delivery={d} slug={slug} />
      ) : (
        <Surface radius="xl" className="px-5 py-4">
          <Kicker tone="muted">Delivery · context</Kicker>
          <p className="mt-1 type-body-sm text-slate-500">
            No pull-request data yet. Connect a GitHub token or the GitHub App to read PR signals alongside adoption — delivery health is
            shown beside adoption as context, never as its consequence.{" "}
            <Link href={`/org/${slug}/settings`} className="type-label tracking-widest transition hover:text-accent">
              Settings →
            </Link>
          </p>
        </Surface>
      )}
    </div>
  );
}
