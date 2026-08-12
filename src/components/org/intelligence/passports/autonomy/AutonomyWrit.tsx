"use client";

// VARIANT C — "Standing delegation order".
//
// Metaphor: a PUBLISHED WRIT. Not a dashboard at all — the org's standing order on what may be
// delegated to agents, typeset as an editorial document with a Dateline masthead and four numbered
// clauses. Each clause states what is permitted, names the repos it is granted to, and names the
// repos it is withheld from together with the cause. It closes with the amendments schedule: the
// fleet-wide gate work that would let the org widen the order, ranked by how many repos each
// unblocks. Differs from the baseline (per-repo rows and a scatter) by being an ORG-LEVEL artifact
// you could paste into a policy channel — the fleet reads as one decision, not N measurements.

import { useMemo } from "react";
import { Dateline, Kicker, Surface } from "@/components/ui";
import { Meter, SectionEmpty } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { TIERS, TIER_META, fleetBottlenecks, tierCounts, type AutonomyTier, type RepoAutonomy } from "./autonomyModel";
import { SourcePin } from "./autonomyShared";
import { WritClause } from "./WritClause";

export function AutonomyWrit({ repos, org }: { repos: RepoAutonomy[]; org: string }) {
  const counts = useMemo(() => tierCounts(repos), [repos]);
  const bottlenecks = useMemo(() => fleetBottlenecks(repos), [repos]);

  // The order's headline: the highest tier a MAJORITY of the fleet can hold — the honest fleet-wide
  // grant, rather than the best repo's clearance.
  const fleetGrant = useMemo<AutonomyTier>(() => {
    let best: AutonomyTier = 0;
    for (const t of TIERS) {
      const holding = repos.filter((r) => r.tier >= t).length;
      if (repos.length && holding * 2 >= repos.length) best = t;
    }
    return best;
  }, [repos]);

  if (repos.length === 0) {
    return <SectionEmpty>No passports in this scope — there is nothing yet to write an order over.</SectionEmpty>;
  }

  const mocked = bottlenecks.filter((b) => b.source !== "scan");

  return (
    <div className="space-y-8">
      <Surface className="p-6 sm:p-8">
        <Dateline
          left={`${org} · standing delegation order`}
          right={`${repos.length} repositories under scan · revision ${new Date().toISOString().slice(0, 10)}`}
        />
        <h2 className="mt-6 text-2xl font-medium text-white sm:text-3xl">
          This organisation delegates to agents up to{" "}
          <span className="font-mono tabular-nums" style={{ color: scoreHex(TIER_META[fleetGrant].anchor) }}>
            {TIER_META[fleetGrant].code}
          </span>{" "}
          — {TIER_META[fleetGrant].label.toLowerCase()}.
        </h2>
        <p className="mt-3 max-w-3xl text-base text-slate-300">
          The grant is the highest tier at least half the scanned fleet can actually hold on its own evidence:{" "}
          {TIER_META[fleetGrant].grant} Anything beyond it is withheld per repository, on the named causes below.
        </p>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
          {TIERS.map((t) => (
            <div key={t}>
              <div className="font-mono text-xl tabular-nums" style={{ color: scoreHex(TIER_META[t].anchor) }}>
                {counts[t]}
              </div>
              <Kicker tone="muted">
                at {TIER_META[t].code} · {TIER_META[t].label}
              </Kicker>
            </div>
          ))}
        </div>
      </Surface>

      {/* The clauses. */}
      <Surface className="p-6 sm:p-8">
        <Kicker>The order</Kicker>
        <div className="mt-5">
          {TIERS.map((t) => (
            <WritClause
              key={t}
              tier={t}
              granted={repos.filter((r) => r.tier >= t)}
              withheld={t === 0 ? [] : repos.filter((r) => r.tier === t - 1)}
              total={repos.length}
            />
          ))}
        </div>
      </Surface>

      {/* Amendments — fleet-level unblock work, ranked by repos freed. */}
      <Surface className="p-6 sm:p-8">
        <Kicker>Schedule of amendments</Kicker>
        <p className="mt-2 max-w-3xl text-base text-slate-300">
          To widen the order, the org fixes gates — not repos. Ranked by how many repositories each gate is currently
          holding back from their next tier.
        </p>
        <ul className="mt-5 space-y-4">
          {bottlenecks.map((b, i) => (
            <li key={b.gate} className="border-b border-divider pb-4 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm tabular-nums text-slate-600">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-base text-slate-100">{b.label}</span>
                  <SourcePin source={b.source} />
                </span>
                <span className="font-mono text-sm tabular-nums" style={{ color: scoreHex(b.mean) }}>
                  fleet mean {b.mean}
                </span>
              </div>
              <Meter value={b.mean} color={scoreHex(b.mean)} size="sm" className="mt-2 max-w-md" ariaLabel={`${b.label} fleet mean`} />
              <p className="mt-2 text-sm text-slate-300">
                {b.blocked.length === 0 ? (
                  "Blocking nothing today."
                ) : (
                  <>
                    Holding back{" "}
                    <span className="font-mono text-slate-100">{b.blocked.length}</span> repo
                    {b.blocked.length === 1 ? "" : "s"}:{" "}
                    <span className="font-mono text-slate-400">{b.blocked.slice(0, 6).join(", ")}</span>
                    {b.blocked.length > 6 && <span className="text-slate-500"> +{b.blocked.length - 6} more</span>}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
        {mocked.length > 0 && (
          <p className="mt-6 border-t border-divider pt-4 text-sm text-slate-500">
            {mocked.map((m) => m.label).join(", ")} {mocked.length === 1 ? "is" : "are"} not measured by the scan today —
            they are shown here as proxy/placeholder values so the order&apos;s shape can be reviewed before the signal
            work lands.
          </p>
        )}
      </Surface>
    </div>
  );
}
