// The Repositories tab's leaderboard data region — moved from the old page.tsx body
// (docs/ORG-TABS-REFACTOR.md), minus the personal-org guard and the Segments branch (both now live
// in RepositoriesTab, the orchestrator).

import Link from "next/link";
import { OrgEmpty, SectionHeader, postureLabel, POSTURE_ORDER } from "@/components/org/shared/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { RepoSegmentsPanel } from "./RepoSegmentsPanel";
import { RepoLeaderboard } from "./RepoLeaderboard";
import { MissingReposPanel } from "./MissingReposPanel";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { getOrgRollup, getRepoSegmentMap, listMissingRepos, listSegments } from "@/lib/db";
import { resolveStackScope } from "@/lib/org/scope";
import { isAppConfigured } from "@/lib/github/app";
import { orgTabHref } from "@/lib/org/orgTabs";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function RepositoriesLeaderboardPanel({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional tech-stack scope (Feature 3b): scope the leaderboard to the selected group's repos.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const rollup = await getOrgRollup(slug, undefined, null, techGroupId);
  // Same empty-state contract as the overview: don't render a blank panel inside the org shell when
  // there's no fleet data to table — point the user at how to populate it (tabs stay visible).
  if (!rollup) {
    return (
      <OrgEmpty
        title="No repositories to show"
        body="This organization has no scanned repositories yet. Scan some repositories to populate the fleet view."
        href={orgTabHref(slug, "overview")}
        cta="← Org overview"
      />
    );
  }

  // Autoscan scheduling needs the GitHub App (the route 503s without it); the org dashboard already
  // implies a DB. When the App isn't configured, the cadence control renders disabled with a hint
  // rather than vanishing, so the capability stays discoverable.
  const schedulable = isAppConfigured();

  const leaderboard = [...rollup.repos].sort((a, b) => (b.latest?.overall ?? -1) - (a.latest?.overall ?? -1));

  // ?posture= filter (deep-linked from the Overview's posture bar): scope the leaderboard to
  // repos whose LATEST scan sits in that posture quadrant. A bogus value falls back to the whole fleet
  // (same contract as the segment/stack scopes). Tagging (RepoSegmentsPanel) stays full-fleet; the CSV
  // export follows the active posture/stack scope (repositories-segments #3) so the file matches the
  // on-screen numbers.
  const postureParam = typeof sp.posture === "string" ? sp.posture : null;
  const posture = postureParam && (POSTURE_ORDER as readonly string[]).includes(postureParam) ? postureParam : null;
  const visible = posture ? leaderboard.filter((r) => r.latest?.posture === posture) : leaderboard;

  // Chip-row filter surface: full-fleet counts per posture (counts never change with the active
  // filter — they ARE the navigation), hrefs preserve an active stack scope.
  const postureCounts = new Map<string, number>();
  for (const r of leaderboard) if (r.latest) postureCounts.set(r.latest.posture, (postureCounts.get(r.latest.posture) ?? 0) + 1);
  const stackQs = activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : "";
  const base = orgTabHref(slug, "repositories");
  const chipHref = (p: string | null) => {
    const sep = base.includes("?") ? "&" : "?";
    return p ? `${base}${sep}posture=${p}${stackQs}` : stackQs ? `${base}${sep}${stackQs.slice(1)}` : base;
  };

  // Segment tagging surface: existing segments + which segments each repo is tagged into.
  const segments = (await listSegments(slug)) ?? [];
  const segmentMap = await getRepoSegmentMap(slug);
  const membership: Record<string, string[]> = {};
  for (const r of rollup.repos) membership[r.fullName] = (segmentMap[r.fullName] ?? []).map((s) => s.id);

  // Watched repos GitHub's last COMPLETE listing didn't contain (renamed/transferred/deleted/private).
  // Renders nothing when the list is empty, so the tab is unchanged for a healthy fleet.
  const missing = await listMissingRepos(slug);

  return (
    <div className="space-y-6">
      <MissingReposPanel org={slug} repos={missing} />
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
              ? `${visible.length} of ${rollup.repoCount} repos in ${postureLabel(posture)} posture: recent commits, PRs & lines changed.`
              : `${rollup.scannedCount}/${rollup.repoCount} scanned: recent commits, PRs & lines changed.`
          }
          right={
            <div className="flex flex-wrap items-center gap-2">
              <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
              {/* The export threads the ACTIVE posture/stack scope through, so "Export CSV" can never
                  contradict the filtered table it sits next to (repositories-segments #3). */}
              <a
                href={`/api/org/repositories?org=${encodeURIComponent(slug)}&format=csv${posture ? `&posture=${encodeURIComponent(posture)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`}
                title={posture || activeStack ? "Download the currently filtered repos as CSV" : "Download the full fleet as CSV"}
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
