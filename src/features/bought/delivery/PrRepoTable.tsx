// Per-repo PR-signal drill-down for the delivery tab — the fleet averages above are only readable
// if a leader can see WHICH repo drags them. Rows arrive riskiest-first (lowest review coverage,
// then slowest merges) from getOrgPrSignals; each repo links into its full report. Long fleets keep
// the riskiest rows on screen and fold the healthier tail behind a native <details> (server-safe,
// no JS) so the page stays short without hiding data.

import Link from "next/link";
import { OrgTable, fmtHours } from "@/components/org/shared/ui";
import { STATE_HINT } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";
import type { PrRepoRow } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";
import { repoBasisMark, repoBasisTitle } from "./prBasis";

const VISIBLE_ROWS = 12;

/**
 * The dash a rate renders when nothing measured it. It carries the kit's ONE canonical sentence for
 * `missing` ("an absence, never a zero") plus this cell's own reason, and `data-state="missing"`
 * gives the encoding a stable hook — the same vocabulary the graphic above the table paints with, so
 * a reader who learns the void in the strip reads the dash the same way here (§2.4).
 */
function Void({ reason, basis }: { reason?: string; basis: string }) {
  return (
    <span data-state="missing" className="text-slate-600" title={[reason, STATE_HINT.missing, basis].filter(Boolean).join(" ")}>
      —
    </span>
  );
}

/**
 * The denominator mark a cell carries beside its percentage. `analyzed` sits in its own column, but
 * it is NOT the denominator of most of these rates (merge is over decided PRs, reviewed over
 * human-merged, aiGoverned over AI-involved, the trailer pair over merged) — printing one count per
 * row invited a division that was never valid. Each cell now states the population the scan actually
 * persisted, and says "not persisted" rather than falling back to `analyzed`.
 */
function Basis({ id, r }: { id: FleetRateId; r: PrRepoRow }) {
  const mark = repoBasisMark(r.population[id]);
  return (
    <span className="ml-0.5 font-mono type-micro tabular-nums text-slate-600">{mark ?? "/?"}</span>
  );
}

function Rate({
  value,
  dashTitle,
  id,
  r,
}: {
  value: number | null;
  dashTitle?: string;
  id: FleetRateId;
  r: PrRepoRow;
}) {
  const title = repoBasisTitle(id, r.population[id]);
  if (value == null) return <Void reason={dashTitle ? `${dashTitle}.` : undefined} basis={title} />;
  return (
    <span className="whitespace-nowrap" title={title}>
      <span className="font-mono tabular-nums" style={{ color: scoreHex(value) }}>
        {value}%
      </span>
      <Basis id={id} r={r} />
    </span>
  );
}

/** The uncolored figures (AI share / trailers / pre-review / reverts) with the same basis mark. */
function PlainRate({ value, dashTitle, id, r }: { value: number | null; dashTitle?: string; id: FleetRateId; r: PrRepoRow }) {
  const title = repoBasisTitle(id, r.population[id]);
  if (value == null) return <Void reason={dashTitle ? `${dashTitle}.` : undefined} basis={title} />;
  return (
    <span className="whitespace-nowrap" title={title}>
      {value}%
      <Basis id={id} r={r} />
    </span>
  );
}

function Row({ r }: { r: PrRepoRow }) {
  return (
    <tr className="text-slate-300">
      <td className="px-4 py-1.5">
        <Link href={`/report/${r.fullName}`} className="focus-ring type-mono-sm text-white transition hover:text-accent">
          {r.name}
        </Link>
      </td>
      <td className="px-3 py-1.5 text-right type-mono-sm tabular-nums text-slate-400">{r.analyzed}</td>
      <td className="px-3 py-1.5 text-center type-body-sm"><Rate value={r.mergeRate} id="merge" r={r} /></td>
      <td className="px-3 py-1.5 text-center type-body-sm">
        <Rate value={r.reviewedRate} dashTitle="no human-merged PRs in the window" id="reviewed" r={r} />
      </td>
      <td className="px-3 py-1.5 text-center type-body-sm"><Rate value={r.smallPrRate} id="smallPr" r={r} /></td>
      <td className="px-3 py-1.5 text-center type-mono-sm tabular-nums text-slate-400">
        <PlainRate value={r.aiInvolvedRate} id="aiInvolved" r={r} />
      </td>
      {/* W2 — trailer-grounded AI share (commit trailers on merged PRs). Uncolored like AI share:
          adoption context, not a target. Null = pre-W2 scan or under the 5-merged-PR floor. */}
      <td className="px-3 py-1.5 text-center type-mono-sm tabular-nums text-slate-400">
        <PlainRate
          value={r.aiTrailerRate}
          dashTitle="scan predates trailer tracking, or fewer than 5 merged PRs"
          id="aiTrailer"
          r={r}
        />
      </td>
      <td className="px-3 py-1.5 text-center type-mono-sm tabular-nums text-slate-400">
        <PlainRate
          value={r.aiPreReviewedRate}
          dashTitle="scan predates pre-review tracking, or fewer than 5 merged PRs"
          id="aiPreReviewed"
          r={r}
        />
      </td>
      <td className="px-3 py-1.5 text-center type-body-sm">
        <Rate value={r.aiGovernedRate} dashTitle="too few AI-involved PRs to measure" id="aiGoverned" r={r} />
      </td>
      {/* Reverts: deliberately UNCOLORED (like AI share) — scoreHex tones high=good, and a revert
          rate is the opposite; a plain figure beats an inverted traffic light. Null = the stored
          scan predates the field, not a clean 0. */}
      <td className="px-3 py-1.5 text-center type-mono-sm tabular-nums text-slate-400">
        <PlainRate
          value={r.revertRate}
          dashTitle="scan predates revert tracking, or too few PRs to measure (rescan)"
          id="revert"
          r={r}
        />
      </td>
      <td className="px-3 py-1.5 text-right type-mono-sm tabular-nums text-slate-400" title="median hours to first review">
        {fmtHours(r.medianHoursToFirstReview)}
      </td>
      <td className="px-3 py-1.5 text-right type-mono-sm tabular-nums text-slate-400">{fmtHours(r.medianHoursToMerge)}</td>
    </tr>
  );
}

function Head() {
  return (
    <tr>
      <th className="px-4 py-2 text-left">Repo</th>
      <th className="px-3 py-2 text-right" title="PRs analyzed in this repo's latest scan — the denominator of the analyzed-based rates only; every other cell carries its own /N">PRs</th>
      <th className="px-3 py-2 text-center">Merge</th>
      <th className="px-3 py-2 text-center" title="human-merged PRs with an approving review">Reviewed</th>
      <th className="px-3 py-2 text-center" title="PRs ≤ 200 changed lines">Small</th>
      <th className="px-3 py-2 text-center">AI share</th>
      <th className="px-3 py-2 text-center" title="merged PRs whose commit messages carry an AI attribution trailer (Co-Authored-By / Assisted-By)">AI trailers</th>
      <th className="px-3 py-2 text-center" title="merged PRs reviewed by an AI/bot reviewer before the first human review">AI pre-review</th>
      <th className="px-3 py-2 text-center" title="AI-involved PRs with an approving review">AI reviewed</th>
      <th className="px-3 py-2 text-center" title="PRs whose title starts with 'Revert' (shipped work that came back out)">Reverts</th>
      <th className="px-3 py-2 text-right" title="median hours from opening to first review">1st review</th>
      <th className="px-3 py-2 text-right" title="median hours to merge">Merge time</th>
    </tr>
  );
}

export function PrRepoTable({ rows }: { rows: PrRepoRow[] }) {
  const visible = rows.slice(0, VISIBLE_ROWS);
  const folded = rows.slice(VISIBLE_ROWS);
  return (
    <div>
      <OrgTable minWidth={1100} caption="Pull-request signals by repository, riskiest first" head={<Head />}>
        {visible.map((r) => (
          <Row key={r.fullName} r={r} />
        ))}
      </OrgTable>
      {folded.length > 0 && (
        <details className="group mt-2">
          <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-2 rounded type-mono-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
            {folded.length} more repo{folded.length > 1 ? "s" : ""} with healthier signals
          </summary>
          <OrgTable className="mt-2" minWidth={1100} caption="Remaining repositories (healthier pull-request signals)" head={<Head />}>
            {folded.map((r) => (
              <Row key={r.fullName} r={r} />
            ))}
          </OrgTable>
        </details>
      )}
    </div>
  );
}
