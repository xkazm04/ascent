import { DIMS, OrgEmpty, SectionHeader } from "@/components/org/ui";
import { RepoSegmentsPanel } from "@/components/org/RepoSegmentsPanel";
import { RepoLeaderboard } from "@/components/org/RepoLeaderboard";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { getOrgRollup, getRepoSegmentMap, listSegments, listTechStackGroups } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";
import { DIMENSION_SHORT, heatCell } from "@/lib/ui";

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
  // Optional tech-stack scope (Feature 3b): validate `?stack=<key>` against the org's groups, then
  // scope the leaderboard/heatmap to that group's repos.
  const techGroups = await listTechStackGroups(slug);
  const stackParam = Array.isArray(sp.stack) ? sp.stack[0] : sp.stack;
  const activeStack = techGroups.find((g) => g.key === stackParam) ?? null;
  const rollup = await getOrgRollup(slug, undefined, null, activeStack?.id ?? null);
  // Same empty-state contract as the overview: don't render a blank panel inside the org shell when
  // there's no fleet data to table — point the user at how to populate it.
  if (!rollup) {
    return (
      <OrgEmpty
        title="No repositories to show"
        body="This organization has no scanned repositories yet. Scan some repositories to populate the fleet view."
        href={`/org/${slug}`}
        cta="← Org overview"
      />
    );
  }

  // Autoscan scheduling needs the GitHub App (the route 503s without it); the org dashboard already
  // implies a DB. When the App isn't configured, the cadence control renders disabled with a hint
  // rather than vanishing, so the capability stays discoverable.
  const schedulable = isAppConfigured();

  const leaderboard = [...rollup.repos].sort((a, b) => (b.latest?.overall ?? -1) - (a.latest?.overall ?? -1));

  // Segment tagging surface: existing segments + which segments each repo is tagged into.
  const segments = (await listSegments(slug)) ?? [];
  const segmentMap = await getRepoSegmentMap(slug);
  const membership: Record<string, string[]> = {};
  for (const r of rollup.repos) membership[r.fullName] = (segmentMap[r.fullName] ?? []).map((s) => s.id);

  return (
    <div className="space-y-6">
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
          description={`${rollup.scannedCount}/${rollup.repoCount} scanned — sorted by overall maturity.`}
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
        <RepoLeaderboard slug={slug} rows={leaderboard} segments={segments} schedulable={schedulable} />
      </div>

      {/* Heatmap */}
      {rollup.scannedCount > 0 && (
        <div>
          <SectionHeader
            title="Repo × dimension heatmap"
            description={`Where each repo is strong or weak across all ${DIMS.length} dimensions.`}
          />
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 p-4">
            <table className="min-w-[640px]">
              <thead>
                <tr className="font-mono text-sm uppercase tracking-widest text-slate-500">
                  <th className="px-2 py-1 text-left" />
                  {DIMS.map((d) => (
                    <th key={d} scope="col" className="px-2 py-1 text-center">
                      {DIMENSION_SHORT[d as keyof typeof DIMENSION_SHORT]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard
                  .filter((r) => r.latest)
                  .map((r) => {
                    const byId = Object.fromEntries(r.latest!.dims.map((d) => [d.dimId, d.score]));
                    return (
                      <tr key={r.fullName}>
                        <th scope="row" className="px-2 py-1 text-left font-mono text-sm font-normal text-slate-300">{r.name}</th>
                        {DIMS.map((d) => {
                          const v = byId[d] ?? 0;
                          const cell = heatCell(v, 0.25 + (v / 100) * 0.75);
                          return (
                            <td key={d} className="px-1 py-1">
                              <div
                                className="mx-auto flex h-7 w-9 items-center justify-center rounded font-mono text-sm"
                                style={{ backgroundColor: cell.fill, color: cell.text }}
                                title={`${d}: ${v}`}
                              >
                                {v}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
