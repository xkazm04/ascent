// The /launch masthead — greeting, fleet-wide tallies, and the charting-progress pill.
//
// Extracted from FleetMap.tsx (AGENTS.md 300-LOC rule) as a pure presentational block: it takes the
// already-derived FleetStats and renders them. No state, no effects.

import { scoreHex } from "@/lib/ui";
import { Pill, Stat } from "./FleetMapChrome";
import { type FleetStats, fleetGreeting } from "./fleetMapDerive";
import { FALLER, RISER } from "./fleetMapStars";

export function FleetHeader({ userName, stats, hydrating }: { userName: string; stats: FleetStats; hydrating: boolean }) {
  // "Welcome back" was wrong on the one page whose only entry moment is the OAuth callback — which,
  // for most people who ever see it, is their FIRST sign-in. `fleetGreeting` states what they are
  // looking at instead of asserting a history they may not have.
  const greeting = fleetGreeting(userName);

  return (
    <header className="animate-fade-up">
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Mission Control</div>
      <h1 className="mt-1 text-3xl font-bold text-white">
        {greeting.lead}
        {greeting.name && (
          <>
            , <span className="text-accent">{greeting.name}</span>
          </>
        )}
      </h1>
      <p className="mt-2 max-w-2xl text-slate-400">
        Your engineering fleet, mapped as living constellations — each org a cluster, each repo a star that
        brightens with its maturity. Scores stream in below as Ascent reads your installations.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
        <Stat label="orgs" value={String(stats.orgs)} />
        <Stat label="repos" value={hydrating && stats.repos === 0 ? "…" : String(stats.repos)} />
        <Stat label="scanned" value={hydrating && stats.scanned === 0 ? "…" : String(stats.scanned)} />
        <Stat
          label="avg maturity"
          value={stats.avg == null ? "—" : String(stats.avg)}
          color={stats.avg == null ? undefined : scoreHex(stats.avg)}
        />
        {(stats.risers > 0 || stats.fallers > 0) && (
          <Stat
            label="movers · 30d"
            value={`▲${stats.risers} ▼${stats.fallers}`}
            color={stats.risers >= stats.fallers ? RISER : FALLER}
          />
        )}
        <Pill className="font-mono uppercase tracking-widest text-slate-400" role="status" aria-live="polite">
          {/* Progress counts SETTLED orgs so the fraction climbs monotonically to N/N (an errored org
              is progress, not a stall). On completion, surface any that never loaded as "· N unreachable"
              rather than pretending the whole fleet charted cleanly. aria-live stays polite. */}
          {hydrating
            ? `charting ${stats.settled}/${stats.orgs}…`
            : stats.errored > 0
              ? `fleet charted · ${stats.errored} unreachable`
              : "fleet charted"}
        </Pill>
      </div>
    </header>
  );
}
