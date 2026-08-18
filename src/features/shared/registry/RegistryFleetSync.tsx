// Fleet sync health — how many repos point at the registry, how many actually synced, and the
// adoption breakdown (in_sync | stale | diverged | local_only) that the Skills heatmap drills into.
// Shared by all three directions. Server-safe (no hooks): the pointer-PR action lives in
// RegistryActions and is composed alongside this.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { Meter, MeterRow } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryView } from "@/lib/org/registry-view";

const SYNC_STATES = [
  { key: "inSync", label: "in_sync", hint: "hash matches the catalog" },
  { key: "stale", label: "stale", hint: "catalog moved on; the repo has an older version" },
  { key: "diverged", label: "diverged", hint: "edited locally, never proposed back" },
  { key: "localOnly", label: "local_only", hint: "a skill that exists only in that repo" },
] as const;

export function RegistryFleetSync({ view, slug, layout = "stacked" }: { view: RegistryView; slug: string; layout?: "stacked" | "rows" }) {
  const { reposTotal, reposPointing, reposSynced30d, adoption } = view.fleet;
  const pointPct = reposTotal === 0 ? 0 : Math.round((reposPointing / reposTotal) * 100);
  const syncPct = reposPointing === 0 ? 0 : Math.round((reposSynced30d / reposPointing) * 100);
  const totalStates = SYNC_STATES.reduce((s, x) => s + adoption[x.key], 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Fleet sync</Kicker>
        <Link href={orgTabHref(slug, "skills")} className="font-mono text-xs text-accent transition hover:text-white">
          skills heatmap →
        </Link>
      </div>

      <div className={layout === "rows" ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}>
        <MeterRow
          layout="stacked"
          label={`Pointing · ${reposPointing}/${reposTotal}`}
          value={pointPct}
          display={`${pointPct}%`}
          color={scoreHex(pointPct)}
          ariaLabel="Repos pointing at the registry"
        />
        <MeterRow
          layout="stacked"
          label={`Synced 30d · ${reposSynced30d}/${reposPointing}`}
          value={syncPct}
          display={`${syncPct}%`}
          color={scoreHex(syncPct)}
          ariaLabel="Pointing repos that synced in the last 30 days"
        />
      </div>

      {totalStates === 0 ? (
        <p className="text-sm text-slate-500">
          No adoption measured yet — the next scan of each repo hashes its <code className="font-mono">.claude/skills</code> against
          the catalog and fills this in.
        </p>
      ) : (
        <ul className="divide-y divide-divider rounded-xl border border-divider">
          {SYNC_STATES.map((s) => {
            const n = adoption[s.key];
            const pct = totalStates === 0 ? 0 : Math.round((n / totalStates) * 100);
            // in_sync is the good end of the ramp; the other three are degrees of drift.
            const color = s.key === "inSync" ? scoreHex(90) : s.key === "stale" ? scoreHex(55) : s.key === "diverged" ? scoreHex(25) : scoreHex(40);
            return (
              <li key={s.key} className="flex items-center gap-3 bg-surface/40 px-4 py-2" title={s.hint}>
                <span className="w-24 shrink-0 font-mono text-xs text-slate-400">{s.label}</span>
                <Meter value={pct} color={color} size="sm" className="flex-1" ariaLabel={`${s.label} share`} />
                <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">{n}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
