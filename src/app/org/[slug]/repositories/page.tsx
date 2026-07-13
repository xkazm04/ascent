import Link from "next/link";
import { OrgEmpty, SectionHeader, postureLabel, POSTURE_ORDER } from "@/components/org/shared/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { FleetTabs } from "@/components/org/repositories/FleetTabs";
import { SegmentsSection } from "@/components/org/repositories/SegmentsSection";
import { RepoSegmentsPanel } from "@/components/org/repositories/RepoSegmentsPanel";
import { RepoLeaderboard } from "@/components/org/repositories/RepoLeaderboard";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { getOrgRollup, getRepoSegmentMap, isPersonalOrg, listSegments } from "@/lib/db";
import { resolveStackScope } from "@/lib/org/scope";
import { isAppConfigured } from "@/lib/github/app";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OrgRepositories({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // A PERSONAL workspace's repo list IS its overview (the watchlist lens) — this fleet leaderboard
  // would table scan-less pointer rows and offer watch/schedule/segment controls the fleet APIs
  // refuse for personal orgs (requireFleetOrg).
  if (await isPersonalOrg(slug)) redirect(`/org/${slug}`);

  // Consolidated Fleet page: the Segments view is now the "?tab=segments" tab of this route (the old
  // standalone /segments route redirects here, and the left-rail "Segments" item is gone). Branch
  // BEFORE the repo-inventory reads so the Segments tab doesn't pay for a rollup it won't render.
  if (sp.tab === "segments") {
    return (
      <div className="space-y-6">
        <FleetTabs slug={slug} active="segments" />
        <SegmentsSection slug={slug} searchParams={sp} />
      </div>
    );
  }

  // Optional tech-stack scope (Feature 3b): scope the leaderboard to the selected group's repos.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const rollup = await getOrgRollup(slug, undefined, null, techGroupId);
  // Same empty-state contract as the overview: don't render a blank panel inside the org shell when
  // there's no fleet data to table — point the user at how to populate it (tabs stay visible).
  if (!rollup) {
    return (
      <div className="space-y-6">
        <FleetTabs slug={slug} active="repositories" />
        <OrgEmpty
          title="No repositories to show"
          body="This organization has no scanned repositories yet. Scan some repositories to populate the fleet view."
          href={`/org/${slug}`}
          cta="← Org overview"
        />
      </div>
    );
  }

  // Autoscan scheduling needs the GitHub App (the route 503s without it); the org dashboard already
  // implies a DB. When the App isn't configured, the cadence control renders disabled with a hint
  // rather than vanishing, so the capability stays discoverable.
  const schedulable = isAppConfigured();

  const leaderboard = [...rollup.repos].sort((a, b) => (b.latest?.overall ?? -1) - (a.latest?.overall ?? -1));

  // ?posture= filter (deep-linked from the Overview's posture bar): scope the leaderboard to
  // repos whose LATEST scan sits in that posture quadrant. A bogus value falls back to the whole fleet
  // (same contract as the segment/stack scopes). Tagging (RepoSegmentsPanel) and CSV stay full-fleet.
  const postureParam = typeof sp.posture === "string" ? sp.posture : null;
  const posture = postureParam && (POSTURE_ORDER as readonly string[]).includes(postureParam) ? postureParam : null;
  const visible = posture ? leaderboard.filter((r) => r.latest?.posture === posture) : leaderboard;

  // Chip-row filter surface: full-fleet counts per posture (counts never change with the active
  // filter — they ARE the navigation), hrefs preserve an active stack scope.
  const postureCounts = new Map<string, number>();
  for (const r of leaderboard) if (r.latest) postureCounts.set(r.latest.posture, (postureCounts.get(r.latest.posture) ?? 0) + 1);
  const stackQs = activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : "";
  const chipHref = (p: string | null) =>
    p ? `/org/${slug}/repositories?posture=${p}${stackQs}` : `/org/${slug}/repositories${stackQs ? `?${stackQs.slice(1)}` : ""}`;

  // Segment tagging surface: existing segments + which segments each repo is tagged into.
  const segments = (await listSegments(slug)) ?? [];
  const segmentMap = await getRepoSegmentMap(slug);
  const membership: Record<string, string[]> = {};
  for (const r of rollup.repos) membership[r.fullName] = (segmentMap[r.fullName] ?? []).map((s) => s.id);

  return (
    <div className="space-y-6">
      <FleetTabs slug={slug} active="repositories" />
      <RepoSegmentsPanel
        slug={slug}
        repos={rollup.repos.map((r) => ({ fullName: r.fullName, name: r.name, language: r.primaryLanguage }))}
        segments={segments}
        membership={membership}
      />
      {/* Leaderboard */}
      <div>
        <SectionHeader
          title="Repositories"
          description={
            posture
              ? `${visible.length} of ${rollup.repoCount} repos in ${postureLabel(posture)} posture — recent commits, PRs & lines changed.`
              : `${rollup.scannedCount}/${rollup.repoCount} scanned — recent commits, PRs & lines changed.`
          }
          right={
            <div className="flex flex-wrap items-center gap-2">
              <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
              <a
                href={`/api/org/repositories?org=${encodeURIComponent(slug)}&format=csv`}
                className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
              >
                Export CSV
              </a>
            </div>
          }
        />
        {/* Posture filter chips — the on-page surface for the ?posture= scope (also deep-linked from
            the Overview's posture bar). Full-fleet counts; "All" clears; active chip highlighted. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Link
            href={chipHref(null)}
            aria-current={posture === null ? "true" : undefined}
            className={`focus-ring rounded-full border px-2.5 py-1 font-mono text-sm transition ${posture === null ? "border-accent/60 text-white" : "border-slate-700 text-slate-400 hover:border-accent hover:text-white"}`}
          >
            All <span className="text-slate-500">{leaderboard.length}</span>
          </Link>
          {POSTURE_ORDER.filter((p) => (postureCounts.get(p) ?? 0) > 0).map((p) => (
            <Link
              key={p}
              href={chipHref(p)}
              aria-current={posture === p ? "true" : undefined}
              className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-sm transition ${posture === p ? "border-accent/60 text-white" : "border-slate-700 text-slate-400 hover:border-accent hover:text-white"}`}
            >
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: POSTURE_HEX[p] ?? "#64748b" }} />
              {postureLabel(p)} <span className="text-slate-500">{postureCounts.get(p)}</span>
            </Link>
          ))}
        </div>
        <RepoLeaderboard slug={slug} rows={visible} segments={segments} schedulable={schedulable} />
      </div>
    </div>
  );
}
