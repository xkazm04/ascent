// "The Impact Ledger" (W1d) — the Briefing tab's answer to the rail's fourth question: what did the
// last period BUY us? METAPHOR: a receipt, not a forecast.
//
// It reads the improvement loop's own bookends (src/lib/db/org-impact.ts): each row is a starter PR
// the org accepted, merged, and then re-scanned, and the number beside it is the measured delta on
// the dimension that PR was aimed at. Everything here is a purchase already made.
//
// WHAT IT DELIBERATELY REFUSES TO DO — the reason the panel is trustworthy at all:
//   - A merged-but-not-yet-rescanned PR contributes NOTHING. It is counted as "awaiting rescan".
//   - With nothing verified, the headline is an em dash and a reason, NEVER "0 points".
//   - A regression is named on its own tile and keeps its sign in the total (UAT DANA-L1-010: no
//     regression printed under a heading that says "value").
//   - Per-repo overall deltas are shown per row and never summed — adding one repo's overall score
//     movement to another's produces a number with no referent.
//
// Sibling in spirit to the Backlog tab's Debt Ledger: that one is what the fleet OWES, this one is
// what it has PAID DOWN. Server-safe — no hooks, no handlers.

import { Kicker } from "@/components/ui";
import { OrgTable, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import type { ImpactLedger as ImpactLedgerModel } from "@/lib/db/org-impact";

const GOOD = "#22c55e";
const BAD = "#f97316";
const MUTED = "#94a3b8";

/** Signed points, always with an explicit sign so a negative can't be misread as a magnitude. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function deltaCell(value: number | null, unmeasuredTitle: string) {
  if (value == null) {
    return (
      <span className="font-mono tabular-nums text-slate-500" title={unmeasuredTitle}>
        —
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums" style={{ color: value > 0 ? GOOD : value < 0 ? BAD : MUTED }}>
      {signed(value)}
    </span>
  );
}

/**
 * The field notes. Names exactly what the headline counts, and — when some merges are still
 * unverified — says so in the same breath, so the number is never read as the whole story.
 */
function FieldNotes({ ledger, periodTitle }: { ledger: ImpactLedgerModel; periodTitle: string }) {
  return (
    <p className="rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400">
      <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Field notes</span> Points are the{" "}
      <strong className="font-medium text-slate-200">measured</strong> delta on each PR&apos;s targeted dimension — the first
      scan after the merge against the repo&apos;s scan when the PR opened — summed over {periodTitle.toLowerCase()}. Only
      re-scanned merges count.
      {ledger.awaitingRescan > 0 && (
        <>
          {" "}
          <strong className="font-medium text-amber-200">
            {ledger.awaitingRescan} merged {ledger.awaitingRescan === 1 ? "PR is" : "PRs are"} still awaiting a rescan
          </strong>{" "}
          and contribute nothing until it lands.
        </>
      )}
      {ledger.unmeasurable > 0 && (
        <>
          {" "}
          {ledger.unmeasurable} re-scanned {ledger.unmeasurable === 1 ? "merge has" : "merges have"} no baseline scan to
          compare against (the repo was accepted before its first scan), so {ledger.unmeasurable === 1 ? "it is" : "they are"}{" "}
          shown as &ldquo;—&rdquo; rather than as zero.
        </>
      )}{" "}
      Per-repo overall movement is shown per row and never summed — one repo&apos;s overall delta added to another&apos;s has
      no meaning.
    </p>
  );
}

export function ImpactLedger({
  slug,
  ledger,
  periodTitle,
}: {
  slug: string;
  ledger: ImpactLedgerModel;
  periodTitle: string;
}) {
  // Nothing merged at all: say so plainly and point at the loop. An empty ledger is an honest state,
  // not an error, and it must not render a wall of zeroes.
  if (ledger.mergedCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-divider bg-surface/40 px-4 py-3 text-sm text-slate-400">
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Bought</span> No improvement PRs
        merged in {periodTitle.toLowerCase()}. Accept a direction on the{" "}
        <a href={`/org/${encodeURIComponent(slug)}?tab=live`} className="focus-ring text-accent hover:text-white">
          Live
        </a>{" "}
        wall and its measured impact lands here once the post-merge rescan completes.
      </div>
    );
  }

  const nothingVerified = ledger.dimPoints == null;

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeader
        title="Impact ledger"
        descriptionClassName="max-w-3xl"
        description={`What the improvement loop bought over ${periodTitle.toLowerCase()} — every accepted direction that merged, and the movement its post-merge rescan actually measured. Verified only: a merge without a rescan is listed, but buys nothing.`}
      />

      <div className={`${TILE_LEDGER} grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`}>
        <Tile
          label="Points bought"
          value={nothingVerified ? "—" : signed(ledger.dimPoints as number)}
          sub={nothingVerified ? "nothing re-scanned yet" : "verified dimension pts"}
          color={nothingVerified ? undefined : (ledger.dimPoints as number) > 0 ? GOOD : BAD}
        />
        <Tile label="Verified" value={ledger.verifiedCount} sub={`of ${ledger.mergedCount} merged`} />
        <Tile
          label="Awaiting rescan"
          value={ledger.awaitingRescan}
          sub="not counted yet"
          color={ledger.awaitingRescan ? "#eab308" : undefined}
        />
        <Tile label="Repos moved" value={ledger.reposMoved} sub="with a verified merge" />
        <Tile
          label="Regressions"
          value={ledger.regressions}
          sub="verified, moved down"
          color={ledger.regressions ? BAD : undefined}
        />
      </div>

      <FieldNotes ledger={ledger} periodTitle={periodTitle} />

      {ledger.byDim.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Kicker>By dimension</Kicker>
          {ledger.byDim.map((d) => (
            <span
              key={d.dimId}
              className="rounded border border-divider bg-surface/60 px-2 py-1 font-mono text-xs text-slate-300"
              title={`${d.prs} verified ${d.prs === 1 ? "PR" : "PRs"} targeting ${d.dimId}`}
            >
              {d.dimId}{" "}
              <span style={{ color: d.points > 0 ? GOOD : d.points < 0 ? BAD : MUTED }}>{signed(d.points)}</span>
            </span>
          ))}
        </div>
      )}

      <OrgTable
        caption="Merged improvement PRs and their measured impact"
        minWidth={760}
        head={
          <tr className="text-left">
            <th className="px-4 py-3">Repository</th>
            <th className="px-4 py-3">Bought</th>
            <th className="px-4 py-3 text-right">Dim delta</th>
            <th className="px-4 py-3 text-right">Repo overall</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        }
      >
        {ledger.rows.map((row) => {
          const unmeasured = row.verified
            ? "Re-scanned, but the repo had no baseline scan when the PR opened — not measurable"
            : "Merged; the post-merge rescan hasn't landed yet";
          return (
            <tr key={`${row.repoFullName}:${row.prNumber}`} className="align-top">
              <td className="px-4 py-3">
                <a
                  href={`https://github.com/${row.repoFullName}`}
                  className="focus-ring text-base font-medium text-white hover:text-accent"
                >
                  {row.repoName}
                </a>
                <div className="font-mono text-xs text-slate-500">{new Date(row.mergedAt).toISOString().slice(0, 10)}</div>
              </td>
              <td className="px-4 py-3">
                <a href={row.prUrl} className="focus-ring text-slate-200 hover:text-accent">
                  {row.practiceLabel} <span className="font-mono text-xs text-slate-500">#{row.prNumber}</span>
                </a>
                {/* Plain slate, NOT the score ramp — the ramp means "how good is this number", and a
                    dimension id is a label, not a score. */}
                <div className="font-mono text-xs text-slate-500">{row.dimId}</div>
              </td>
              <td className="px-4 py-3 text-right">{deltaCell(row.verified ? row.impactDim : null, unmeasured)}</td>
              <td className="px-4 py-3 text-right">{deltaCell(row.verified ? row.impactOverall : null, unmeasured)}</td>
              <td className="px-4 py-3">
                {row.verified ? (
                  <span className="font-mono text-xs uppercase tracking-widest" style={{ color: GOOD }}>
                    verified
                  </span>
                ) : (
                  <span className="font-mono text-xs uppercase tracking-widest text-amber-200">awaiting rescan</span>
                )}
              </td>
            </tr>
          );
        })}
      </OrgTable>
    </div>
  );
}
