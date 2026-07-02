// The "Adoption" tab (Direction #1 phase 1) — AI-adoption intelligence: how much of the org's work is
// AI-assisted, the champions, the teams carrying (or missing) the habits, who to enable next, and the
// delivery health it sits alongside. Assembled from existing contributor AI-attribution + PR signals
// (no new ingestion). Delivery is shown as honest context. Every reading ends in a follow-up: a
// deep-link, a cross-tab jump, or a concrete pairing/enablement move.

import Link from "next/link";
import { buildAdoptionOverview, adoptionMarkdown } from "@/lib/org/adoption";
import { SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { Surface, Kicker } from "@/components/ui";
import { ScopeFilterBar } from "@/components/org/ScopeFilterBar";
import { CHAMPION_MIN_POP } from "@/components/org/champions";
import { CopyForLlm } from "@/components/CopyForLlm";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex } from "@/lib/ui";
import { AdoptionSpectrum } from "./AdoptionSpectrum";
import { ChampionsCard } from "./ChampionsCard";
import { TeamAdoption } from "./TeamAdoption";
import { EnablementTargets } from "./EnablementTargets";
import { DeliveryStrip } from "./DeliveryStrip";

export const dynamic = "force-dynamic";

export default async function OrgAdoption({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

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
          No contributor data {segmentId || activeStack ? "for this filter" : "yet"} — scan some of this org&apos;s repositories (with a
          GitHub token for commit history) to measure AI adoption.
        </SectionEmpty>
      </div>
    );
  }

  const md = adoptionMarkdown(a);
  const d = a.delivery;
  // Same small-population guard as champions: naming low-AI individuals in a tiny org is a ranking,
  // not an enablement plan.
  const showEnablement = a.enablement.length > 0 && a.contributors.total >= CHAMPION_MIN_POP;

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

      <div className={TILE_GRID}>
        <Tile label="Org AI commit share" value={`${a.orgAiShare}%`} color={scoreHex(a.orgAiShare)} sub="commit-weighted" />
        <Tile
          label="AI-active contributors"
          value={`${a.contributors.aiActive}/${a.contributors.total}`}
          sub={`${a.contributors.aiActiveShare}% of contributors`}
          color={scoreHex(a.contributors.aiActiveShare)}
        />
        <Tile
          label="AI-involved PRs"
          value={d ? `${d.aiInvolvedRate}%` : "—"}
          sub={d ? `${d.prs} PRs analyzed` : "no PR data"}
          color={d ? scoreHex(d.aiInvolvedRate) : undefined}
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

      {a.tools.length > 0 && <ToolFootprint tools={a.tools} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <ChampionsCard champions={a.champions} totalContributors={a.contributors.total} slug={slug} />
        <TeamAdoption teams={a.teams} pairing={a.teamPairing} slug={slug} />
      </div>

      {showEnablement && <EnablementTargets targets={a.enablement} nonePool={a.distribution.none} />}

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
        Metrics reflect the recent-activity commit window captured at scan time; AI attribution reads co-authorship and tool markers
        on commits and PRs. Team rollups use CODEOWNERS attribution — see the{" "}
        <Link href={`/org/${slug}/teams`} className="text-slate-500 transition hover:text-accent">Teams</Link> tab.
      </p>
    </div>
  );
}

/** The AI tools already in the fleet's PRs — evidence of what's in use, one slim chip band. */
function ToolFootprint({ tools }: { tools: { name: string; count: number }[] }) {
  return (
    <Surface radius="xl" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <Kicker tone="muted" className="mr-1">AI tooling in PRs</Kicker>
      {tools.map((t) => (
        <span key={t.name} className="rounded border border-slate-700 px-2 py-0.5 font-mono text-sm text-slate-300">
          {t.name} <span className="text-slate-500">×{t.count}</span>
        </span>
      ))}
      <span className="text-sm text-slate-600">detected via PR co-authorship / body markers</span>
    </Surface>
  );
}
