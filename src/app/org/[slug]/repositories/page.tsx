import Link from "next/link";
import { DIMS, POSTURE_LABEL, SectionHeader } from "@/components/org/ui";
import { RepoSegmentsPanel } from "@/components/org/RepoSegmentsPanel";
import { getOrgRollup, getRepoSegmentMap, listSegments } from "@/lib/db";
import { DIMENSION_SHORT, LEVEL_CLASSES, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OrgRepositories({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rollup = await getOrgRollup(slug);
  if (!rollup) return null;

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
        repos={rollup.repos.map((r) => ({ fullName: r.fullName, name: r.name }))}
        segments={segments}
        membership={membership}
      />
      {/* Leaderboard */}
      <div>
        <SectionHeader
          title="Repositories"
          description={`${rollup.scannedCount}/${rollup.repoCount} scanned — sorted by overall maturity.`}
        />
        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-900/60 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Repo</th>
                <th className="px-3 py-2 text-left">Level</th>
                <th className="px-3 py-2 text-right">Overall</th>
                <th className="px-3 py-2 text-right">Adopt</th>
                <th className="px-3 py-2 text-right">Rigor</th>
                <th className="px-3 py-2 text-left">Posture</th>
                <th className="px-3 py-2 text-left">Last scan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {leaderboard.map((r) => {
                const l = r.latest;
                const rlc = l ? LEVEL_CLASSES[l.level as LevelId] : null;
                return (
                  <tr key={r.fullName} className="text-slate-300">
                    <td className="px-4 py-2">
                      <Link href={`/report?repo=${encodeURIComponent(r.fullName)}`} className="font-mono text-xs text-white hover:text-accent">
                        {r.fullName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {l && rlc ? <span className={`font-mono text-xs ${rlc.text}`}>{l.level}</span> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: l ? scoreHex(l.overall) : undefined }}>
                      {l ? l.overall : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{l ? l.adoption : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{l ? l.rigor : "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{l ? POSTURE_LABEL[l.posture] ?? l.posture : "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{l ? l.scannedAt.slice(0, 10) : "not scanned"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Heatmap */}
      {rollup.scannedCount > 0 && (
        <div>
          <SectionHeader
            title="Repo × dimension heatmap"
            description="Where each repo is strong or weak across the eight dimensions."
          />
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 p-4">
            <table className="min-w-[640px]">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-2 py-1 text-left" />
                  {DIMS.map((d) => (
                    <th key={d} className="px-2 py-1 text-center">
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
                        <td className="px-2 py-1 font-mono text-xs text-slate-300">{r.name}</td>
                        {DIMS.map((d) => {
                          const v = byId[d] ?? 0;
                          return (
                            <td key={d} className="px-1 py-1">
                              <div
                                className="mx-auto flex h-7 w-9 items-center justify-center rounded font-mono text-[10px] text-[#04070e]"
                                style={{ backgroundColor: scoreHex(v), opacity: 0.25 + (v / 100) * 0.75 }}
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
