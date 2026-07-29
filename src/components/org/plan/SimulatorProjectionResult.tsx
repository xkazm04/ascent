"use client";

import { Meter, signedDelta as signed } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { humanizeDays } from "@/lib/maturity/forecast";
import type { FleetProjection } from "@/lib/scoring/orgsim";
import type { GoalImpact } from "@/lib/db/plan";

/** The projected-impact readout for a completed simulation: scenario legs, affected repos, the
 *  track/save controls, per-band metric cards, goal-impact list (SIM-4), and the biggest movers. */
export function ProjectionResult({
  result,
  goalImpacts,
  tracking,
  tracked,
  trackError,
  onTrack,
  onSave,
}: {
  result: FleetProjection;
  goalImpacts: GoalImpact[];
  tracking: boolean;
  tracked: boolean;
  trackError: string | null;
  onTrack: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
      {result.fixes.length > 1 && (
        <div className="font-mono text-sm text-slate-500">
          Scenario:{" "}
          {result.fixes.map((f, i) => (
            <span key={f.dimId}>
              {i > 0 && " + "}
              <span className="text-slate-300">
                {f.dimId}→{f.target}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="text-base text-slate-300">
        Applies to <span className="font-mono text-white">{result.affected}</span> repo(s) currently below target
        {result.promotions > 0 && (
          <>
            {" "}· <span className="font-mono text-emerald-300">{result.promotions}</span> would cross up a level
          </>
        )}
        .
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* AUTHORITATIVE multi-leg policy: tracking is single-dimension by design, enforced here by
            disabling the button. The handler (Simulator.trackAsInitiative) matches: it posts exactly
            one initiative and refuses multi-leg results — a per-leg loop was rejected as non-atomic
            (partial failure + retry duplicates initiatives). (investment 07-16 #2) */}
        <button
          onClick={onTrack}
          disabled={tracking || tracked || result.fixes.length > 1}
          title={
            result.fixes.length > 1
              ? "An initiative tracks a single dimension, but this scenario raises several — tracking it would silently drop the extra legs. Remove the extra dimensions and re-simulate to track the primary move."
              : undefined
          }
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
        >
          {tracked ? "✓ Tracked as initiative" : tracking ? "Tracking…" : "Track as initiative"}
        </button>
        <button
          onClick={onSave}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
          title="Save this projection to compare against another (SIM-5)"
        >
          Save scenario
        </button>
        {!tracked && result.fixes.length > 1 && (
          <span className="font-mono text-sm text-slate-500">
            Tracking supports one dimension — remove the extra legs to track the primary move.
          </span>
        )}
        {/* role="status": the track outcome (success or failure) must reach assistive tech — the
            visual-only strips left a screen-reader user unable to confirm the page's core action
            completed (investment 07-16 #5). */}
        {tracked && <span role="status" className="font-mono text-sm text-emerald-300">Added to the Initiatives panel below.</span>}
        {trackError && <span role="status" className="font-mono text-sm text-orange-300">{trackError}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ["Overall", result.before.avgOverall, result.after.avgOverall, `${result.before.level} → ${result.after.level}`],
          ["Adoption", result.before.avgAdoption, result.after.avgAdoption, ""],
          ["Rigor", result.before.avgRigor, result.after.avgRigor, ""],
        ] as const).map(([label, before, after, note]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
            <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(after) }}>{after}</span>
              <span className="font-mono text-sm text-slate-500">from {before}</span>
              <span className={`font-mono text-sm ${after - before > 0 ? "text-emerald-300" : after - before < 0 ? "text-orange-300" : "text-slate-600"}`}>
                {signed(after - before)}
              </span>
            </div>
            <Meter className="mt-2" size="sm" value={after} color={scoreHex(after)} threshold={before} />
            {note && <div className="mt-1 font-mono text-sm text-slate-400">{note}</div>}
          </div>
        ))}
      </div>

      {/* SIM-4: how landing this scenario pulls forward the org's active goals. */}
      {goalImpacts.length > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="font-mono text-sm uppercase tracking-widest text-emerald-300">Goal impact</div>
          <ul className="mt-2 space-y-1.5">
            {goalImpacts.map((g) => (
              <li key={g.id} className="text-sm text-slate-300">
                <span className="font-medium text-white">{g.label}</span>{" "}
                <span className="font-mono text-slate-500">
                  ({g.metricLabel} {g.currentValue}→{g.simulatedValue})
                </span>{" "}
                {g.reachedNow ? (
                  <span className="font-mono text-emerald-300">reaches its target of {g.target}.</span>
                ) : g.currentEtaDate && g.simulatedEtaDate ? (
                  <span className="font-mono">
                    ETA <span className="text-slate-400">{g.currentEtaDate}</span> →{" "}
                    <span className="text-emerald-300">{g.simulatedEtaDate}</span>
                    {g.daysSooner != null && g.daysSooner > 0 && (
                      <span className="text-emerald-300"> ({humanizeDays(g.daysSooner)} sooner)</span>
                    )}
                  </span>
                ) : g.simulatedEtaDate ? (
                  <span className="font-mono text-emerald-300">projects a target ETA of {g.simulatedEtaDate}.</span>
                ) : (
                  <span className="font-mono text-slate-400">moves the metric toward its target.</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.repos.filter((r) => r.delta > 0).length > 0 && (
        <div>
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Biggest movers</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {result.repos
              .filter((r) => r.delta > 0)
              .slice(0, 12)
              .map((r) => (
                <span key={r.fullName} className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm text-slate-300">
                  {r.name} <span className="text-emerald-300">{signed(r.delta)}</span>
                  {r.levelUp && <span className="ml-1 text-accent">↑{r.levelAfter}</span>}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
