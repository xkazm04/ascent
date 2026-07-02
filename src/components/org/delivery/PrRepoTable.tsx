// Per-repo PR-signal drill-down for the delivery tab — the fleet averages above are only readable
// if a leader can see WHICH repo drags them. Rows arrive riskiest-first (lowest review coverage,
// then slowest merges) from getOrgPrSignals; each repo links into its full report. Long fleets keep
// the riskiest rows on screen and fold the healthier tail behind a native <details> (server-safe,
// no JS) so the page stays short without hiding data.

import Link from "next/link";
import { OrgTable, fmtHours } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";
import type { PrRepoRow } from "@/lib/db";

const VISIBLE_ROWS = 12;

function Rate({ value, dashTitle }: { value: number | null; dashTitle?: string }) {
  if (value == null) {
    return (
      <span className="text-slate-600" title={dashTitle}>
        —
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums" style={{ color: scoreHex(value) }}>
      {value}%
    </span>
  );
}

function Row({ r }: { r: PrRepoRow }) {
  return (
    <tr className="text-slate-300">
      <td className="px-4 py-1.5">
        <Link href={`/report/${r.fullName}`} className="focus-ring font-mono text-sm text-white transition hover:text-accent">
          {r.name}
        </Link>
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-sm tabular-nums text-slate-400">{r.analyzed}</td>
      <td className="px-3 py-1.5 text-center text-sm"><Rate value={r.mergeRate} /></td>
      <td className="px-3 py-1.5 text-center text-sm">
        <Rate value={r.reviewedRate} dashTitle="no human-merged PRs in the window" />
      </td>
      <td className="px-3 py-1.5 text-center text-sm"><Rate value={r.smallPrRate} /></td>
      <td className="px-3 py-1.5 text-center font-mono text-sm tabular-nums text-slate-400">
        {r.aiInvolvedRate}%
      </td>
      <td className="px-3 py-1.5 text-center text-sm">
        <Rate value={r.aiGovernedRate} dashTitle="too few AI-involved PRs to measure" />
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-sm tabular-nums text-slate-400">{fmtHours(r.medianHoursToMerge)}</td>
    </tr>
  );
}

function Head() {
  return (
    <tr>
      <th className="px-4 py-2 text-left">Repo</th>
      <th className="px-3 py-2 text-right">PRs</th>
      <th className="px-3 py-2 text-center">Merge</th>
      <th className="px-3 py-2 text-center" title="human-merged PRs with an approving review">Reviewed</th>
      <th className="px-3 py-2 text-center" title="PRs ≤ 200 changed lines">Small</th>
      <th className="px-3 py-2 text-center">AI share</th>
      <th className="px-3 py-2 text-center" title="AI-involved PRs with an approving review">AI reviewed</th>
      <th className="px-3 py-2 text-right" title="median hours to merge">Merge time</th>
    </tr>
  );
}

export function PrRepoTable({ rows }: { rows: PrRepoRow[] }) {
  const visible = rows.slice(0, VISIBLE_ROWS);
  const folded = rows.slice(VISIBLE_ROWS);
  return (
    <div>
      <OrgTable minWidth={760} caption="Pull-request signals by repository, riskiest first" head={<Head />}>
        {visible.map((r) => (
          <Row key={r.fullName} r={r} />
        ))}
      </OrgTable>
      {folded.length > 0 && (
        <details className="group mt-2">
          <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-2 rounded font-mono text-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block text-slate-600 transition-transform group-open:rotate-90">›</span>
            {folded.length} more repo{folded.length > 1 ? "s" : ""} with healthier signals
          </summary>
          <OrgTable className="mt-2" minWidth={760} caption="Remaining repositories (healthier pull-request signals)" head={<Head />}>
            {folded.map((r) => (
              <Row key={r.fullName} r={r} />
            ))}
          </OrgTable>
        </details>
      )}
    </div>
  );
}
