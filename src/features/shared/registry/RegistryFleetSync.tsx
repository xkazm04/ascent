// Fleet sync health — how many repos point at the registry, how many actually synced, and the
// adoption breakdown (in_sync | stale | diverged | local_only) that the Skills heatmap drills into.
// Shared by all three directions. Server-safe (no hooks): the pointer-PR action lives in
// RegistryActions and is composed alongside this.
//
// Pointing and 30d-sync come from the conformance sweep's header rows (each repo's manifest
// `registry.remote`). Until a sweep ran the loader omits the counts, and this panel hatches the
// meters: unmeasured is not 0%. Once measured, RegistryFleetRoster names every repo not pointing
// here. Reporting (usage-lane contributors) is real. Adoption BY HASH is not measured by any pass.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { Meter, MeterRow } from "@/components/org/shared/ui";
import { stateTitle } from "@/components/org/viz";
import { MatrixHatchDefs, MatrixMark } from "@/components/org/viz/matrixMark";
import { scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryFleetRoster } from "./RegistryFleetRoster";

const SYNC_STATES = [
  { key: "inSync", label: "in_sync", hint: "hash matches the catalog" },
  { key: "stale", label: "stale", hint: "catalog moved on; the repo has an older version" },
  { key: "diverged", label: "diverged", hint: "edited locally, never proposed back" },
  { key: "localOnly", label: "local_only", hint: "a skill that exists only in that repo" },
] as const;

function UnmeasuredMeter({ label }: { label: string }) {
  return (
    <div data-fleet-meter={label} data-state="not-judged">
      <div className="flex items-center justify-between type-mono-sm uppercase tracking-widest text-slate-500">
        <span>{label}</span>
        <span className="relative h-4 w-10 shrink-0" role="img" aria-label={stateTitle("not-judged", label)}>
          <MatrixHatchDefs />
          <MatrixMark state="not-judged" alpha={1} />
        </span>
      </div>
    </div>
  );
}

export function RegistryFleetSync({ view, slug, layout = "stacked" }: { view: RegistryView; slug: string; layout?: "stacked" | "rows" }) {
  const { reposTotal, reposPointing, reposSynced30d, adoption } = view.fleet;
  const pointingMeasured = typeof reposPointing === "number";
  const syncedMeasured = typeof reposSynced30d === "number" && pointingMeasured;
  const pointPct = !pointingMeasured || reposTotal === 0 ? 0 : Math.round((reposPointing / reposTotal) * 100);
  const syncPct = !syncedMeasured || reposPointing === 0 ? 0 : Math.round((reposSynced30d / reposPointing) * 100);
  const totalStates = SYNC_STATES.reduce((s, x) => s + adoption[x.key], 0);
  // Reporting is a DIFFERENT population from pointing: an installation contributes to the registry's
  // usage lane whether or not its repo carries the pointer, so this is measured against the fleet
  // total and sits beside the other two meters rather than inside them. It is the only one of the
  // three that needs no sweep; pointing/synced hatch until one has read the fleet's manifests.
  const reporting = view.telemetry.reposReporting;
  const reportPct = reposTotal === 0 ? 0 : Math.round((reporting / reposTotal) * 100);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Fleet sync</Kicker>
        <Link href={orgTabHref(slug, "skills")} className="type-caption text-accent transition hover:text-white">
          skills heatmap →
        </Link>
      </div>

      <div className={layout === "rows" ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}>
        {pointingMeasured ? (
          <div data-fleet-meter="Pointing" data-state="measured">
            <MeterRow
              layout="stacked"
              label={`Pointing · ${reposPointing}/${reposTotal}`}
              value={pointPct}
              display={`${pointPct}%`}
              color={scoreHex(pointPct)}
              ariaLabel="Repos pointing at the registry"
            />
          </div>
        ) : (
          <UnmeasuredMeter label="Pointing" />
        )}
        {syncedMeasured ? (
          <div data-fleet-meter="Synced 30d" data-state="measured">
            <MeterRow
              layout="stacked"
              label={`Synced 30d · ${reposSynced30d}/${reposPointing}`}
              value={syncPct}
              display={`${syncPct}%`}
              color={scoreHex(syncPct)}
              ariaLabel="Pointing repos that synced in the last 30 days"
            />
          </div>
        ) : (
          <UnmeasuredMeter label="Synced 30d" />
        )}
        <MeterRow
          layout="stacked"
          label={`Reporting · ${reporting}/${reposTotal}`}
          value={reportPct}
          display={`${reportPct}%`}
          color={scoreHex(reportPct)}
          ariaLabel="Installations contributing to the registry usage lane"
        />
      </div>

      {pointingMeasured && view.fleet.roster ? (
        <RegistryFleetRoster roster={view.fleet.roster} unswept={view.fleet.unswept} pointer={view.howTo.pointer} />
      ) : null}

      {totalStates === 0 ? (
        <p className="type-body-sm text-slate-500">
          Adoption by hash (in_sync, stale, diverged, local_only) is not measured: no pass compares each repo&apos;s skills
          with the catalog yet.
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
                <span className="w-24 shrink-0 type-caption text-slate-400">{s.label}</span>
                <Meter value={pct} color={color} size="sm" className="flex-1" ariaLabel={`${s.label} share`} />
                <span className="w-8 shrink-0 text-right type-mono-sm tabular-nums text-slate-200">{n}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
