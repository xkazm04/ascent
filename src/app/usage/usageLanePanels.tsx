// The two panels that answer "what does each part of the product cost, and whose work drives it".
//
// SERVER COMPONENTS — no `"use client"`, no hooks, no handlers. They render figures the page already
// resolved, so putting them on the client would ship a bundle to draw a static bar.
//
// The scan lane is the one an operator already understood; the value here is the other four, which
// until now spent real money with no surface at all. A lane whose cost cannot be established prints
// "no estimate" with the count of unpriced calls beside it, NEVER $0.00 — those are different facts
// and the difference is the whole point of the panel.

import { Surface } from "@/components/ui";
import { Bar } from "./usagePanels";
import { LANE_LABEL, type UsageLane } from "@/lib/llm/meter";
// Deep path, not the barrel: the `@/lib/db` re-export is a Director-owned line that lands at merge.
import { UNKNOWN_LANE, type LaneKey, type LaneUsage, type TeamUsage } from "@/lib/db/usage-events";

/** Per-lane accent, from the brand's own tokens — no hand-picked hexes. The scan lane keeps the
 *  accent it has everywhere else on this page; the rest step through the tone scale so the bars are
 *  distinguishable, with the label carrying the real identification (hue is never the only encoding). */
const LANE_COLOR: Record<UsageLane, string> = {
  scan: "var(--color-accent)",
  athena: "var(--color-accent-soft)",
  memory: "var(--color-tone-rising)",
  briefing: "var(--color-tone-falling)",
  local: "var(--color-tone-flat)",
};

/** MC-B31: a ledger row tagged with a lane this build does not know is real spend, and the team panel
 *  beside this one counts it. It gets its own named row rather than vanishing — an unexplained gap
 *  between two totals on one page is worse than an honestly odd row. */
const UNKNOWN_LANE_LABEL = "Unrecognized lane";

function laneLabel(lane: LaneKey): string {
  return lane === UNKNOWN_LANE ? UNKNOWN_LANE_LABEL : LANE_LABEL[lane];
}

function laneColor(lane: LaneKey): string {
  return lane === UNKNOWN_LANE ? "var(--color-tone-flat)" : LANE_COLOR[lane];
}

/** "$1.23", or the honest absence. A null cost is NOT rendered as $0.00 — see the header. */
function cost(usd: number | null): string {
  return usd == null ? "no estimate" : `$${usd.toFixed(2)}`;
}

export function LanePanels({
  byLane,
  byTeam,
  periodDays,
}: {
  byLane: LaneUsage[];
  byTeam: TeamUsage[];
  periodDays: number;
}) {
  // Nothing metered outside the scan lane and no team split: render nothing rather than two empty
  // panels claiming the product has no other lanes.
  if (byLane.length === 0 && byTeam.length === 0) return null;
  const laneTotal = byLane.reduce((a, l) => a + l.calls, 0);
  const teamTotal = byTeam.reduce((a, t) => a + t.calls, 0);
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <Surface className="p-6">
        <h2 className="type-body font-semibold text-white">
          {/* "model calls" was wrong for the row a reader looks at first: the scan lane's count is
              `periodScans` — EVERY computed scan in the window, including keyless/mock runs that made
              no model call at all. The count is deliberate and must stay: deriving the scan lane from
              the same Scan rows as the headline tile and the chart is what stops those three numbers
              from disagreeing, and a mock scan really is a computed scan. So the CAPTION moves, not
              the number, and the scan row says what it counts. */}
          Spend by lane <span className="font-normal text-slate-500">· calls · last {periodDays}d (UTC)</span>
        </h2>
        <div className="mt-3 space-y-2 type-body">
          {byLane.length === 0 ? (
            <p className="text-slate-500">No model calls in this period.</p>
          ) : (
            byLane.map((l) => (
              <div key={l.lane}>
                <Bar
                  label={`${laneLabel(l.lane)} · ${cost(l.estimatedCostUsd)}`}
                  value={l.calls}
                  total={laneTotal}
                  color={laneColor(l.lane)}
                  pattern={l.lane === UNKNOWN_LANE}
                />
                {l.lane === UNKNOWN_LANE && (
                  <p className="mt-1 type-body-sm text-slate-500">
                    Recorded under a lane name this version does not know (a newer or rolled-back
                    build). Counted here so this panel and the team panel agree on the period&apos;s
                    total.
                  </p>
                )}
                {l.lane === "scan" && (
                  <p className="mt-1 type-body-sm text-slate-500">
                    Computed scans (incl. mock): every scan the pipeline ran in the window, counted
                    from the same rows as the tiles and the chart above — a keyless/mock run made no
                    model call and is priced as nothing, not billed as free.
                  </p>
                )}
                {l.unpricedCalls > 0 && (
                  <p className="mt-1 type-body-sm text-slate-500">
                    {l.unpricedCalls.toLocaleString()} of {l.calls.toLocaleString()} call
                    {l.calls === 1 ? "" : "s"} could not be priced (no rate for the model, your own
                    provider account, or no tokens reported).
                  </p>
                )}
              </div>
            ))
          )}
        </div>
        <p className="mt-3 type-body-sm text-slate-500">
          The scan lane is counted from stored scans; every other lane is counted from the model-call
          ledger. A lane that ran nothing in the period is not listed, and no lane that ran is dropped.
        </p>
      </Surface>

      <Surface className="p-6">
        <h2 className="type-body font-semibold text-white">
          Spend by team <span className="font-normal text-slate-500">· code owners · last {periodDays}d (UTC)</span>
        </h2>
        <div className="mt-3 space-y-2 type-body">
          {byTeam.length === 0 ? (
            <p className="text-slate-500">No attributable work in this period.</p>
          ) : (
            byTeam.map((t) => (
              <Bar
                key={t.teamKey ?? "org-wide"}
                label={`${t.label} · ${cost(t.estimatedCostUsd)}`}
                value={t.calls}
                total={teamTotal}
                color={t.teamKey ? "var(--color-accent)" : "var(--color-tone-flat)"}
                pattern={!t.teamKey}
              />
            ))
          )}
        </div>
        <p className="mt-3 type-body-sm text-slate-500">
          A team is a CODEOWNERS team, never a person: no contributor is named or attributed here.
          Work with no owning team — a briefing, an org-wide memory pass — is counted org-wide rather
          than dropped.
        </p>
      </Surface>
    </div>
  );
}
