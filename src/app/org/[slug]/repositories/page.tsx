import Link from "next/link";
import { DIMS, OrgEmpty, OrgTable, postureLabel, SectionHeader } from "@/components/org/ui";
import { RepoSegmentsPanel } from "@/components/org/RepoSegmentsPanel";
import { RepoRescanButton } from "@/components/org/RepoRescanButton";
import { ScheduleSelect } from "@/components/org/ScheduleSelect";
import { getOrgRollup, getRepoSegmentMap, listSegments } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";
import { DIMENSION_SHORT, LEVEL_CLASSES, heatCell, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OrgRepositories({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rollup = await getOrgRollup(slug);
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
        />
        <OrgTable
          className="mt-3"
          head={
            <tr>
              <th className="px-4 py-2 text-left">Repo</th>
              <th className="px-3 py-2 text-left">Level</th>
              <th className="px-3 py-2 text-right">Overall</th>
              <th className="px-3 py-2 text-right">Adopt</th>
              <th className="px-3 py-2 text-right">Rigor</th>
              <th className="px-3 py-2 text-left">Posture</th>
              <th className="px-3 py-2 text-left">Last scan</th>
              <th className="px-3 py-2 text-left">Autoscan</th>
              <th className="px-3 py-2 text-left">
                <span className="sr-only">Rescan</span>
              </th>
            </tr>
          }
        >
          {leaderboard.map((r) => {
                const l = r.latest;
                const rlc = l ? LEVEL_CLASSES[l.level as LevelId] : null;
                return (
                  <tr key={r.fullName} className="text-slate-300">
                    <td className="px-4 py-2">
                      <Link href={`/report?repo=${encodeURIComponent(r.fullName)}`} className="font-mono text-sm text-white hover:text-accent">
                        {r.fullName}
                      </Link>
                      {r.lastScanStatus === "error" && (
                        <span
                          title={r.lastScanError ?? "The most recent scan attempt failed."}
                          className="ml-2 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-sm text-danger-soft"
                        >
                          ⚠ scan failed
                        </span>
                      )}
                      {r.aiConformance != null && (
                        <span
                          title="`.ai/` standard conformance reported by this repo's doctor (node .ai/doctor.mjs --json)"
                          className="ml-2 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm"
                          style={{ color: scoreHex(r.aiConformance) }}
                        >
                          .ai {r.aiConformance}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {l && rlc ? <span className={`font-mono text-sm ${rlc.text}`}>{l.level}</span> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: l ? scoreHex(l.overall) : undefined }}>
                      {l ? l.overall : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{l ? l.adoption : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{l ? l.rigor : "—"}</td>
                    <td className="px-3 py-2 text-sm text-slate-400">{l ? postureLabel(l.posture) : "—"}</td>
                    <td className="px-3 py-2 text-sm text-slate-500">{l ? l.scannedAt.slice(0, 10) : "not scanned"}</td>
                    <td className="px-3 py-2">
                      <ScheduleSelect
                        org={slug}
                        fullName={r.fullName}
                        schedule={r.scanSchedule}
                        disabled={!schedulable}
                        disabledHint="Autoscan scheduling requires the GitHub App."
                      />
                    </td>
                    <td className="px-3 py-2">
                      {/* The scan route scopes to listWatchedRepos — an unwatched fullName would
                          silently match nothing, so only watched rows get the trigger. */}
                      {r.watched ? (
                        <RepoRescanButton
                          org={slug}
                          fullName={r.fullName}
                          disabled={!schedulable}
                          disabledHint="Rescanning requires the GitHub App."
                        />
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
        </OrgTable>
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
