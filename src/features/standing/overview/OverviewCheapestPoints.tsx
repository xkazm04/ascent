// "Cheapest points" — the Overview for a DIFFERENT reader: the tech lead planning the sprint, who
// already knows the fleet score and wants the trade. The unit of analysis is practice × repos in
// fleet points: "test discipline in 4 repos is worth 2.9 fleet points". The top trade IS the
// headline — the first ticket, stated as a sentence with a verb — and only the next two follow it.
//
// Reference: Google Lighthouse "Opportunities" — each row states the fix and the estimated saving
// on the right with a proportional bar, expandable to the affected items. Axioms: compact ·
// type-mono-sm over type-note · one accent role (the lift bar) · hairline ledger · 150ms state.
//
// Deleted from the baseline on purpose: the fleet score and its badges (the reader knows it), the
// trend, the posture bar, the cohort rollup, the heatmap — and the dimension AVERAGE itself: a 41
// average says nothing about the trade. Cut after the critic's pass: the panel surface, the rank
// column, the delta column, the chevron, the per-repo figure, the header note, and rows four to
// nine — "cheapest" is the top three; the tail was the ledger this variant claims to replace.
//
// No hooks here; each row owns its expand state and carries "use client".

import { Kicker } from "@/components/ui";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import { buildUrl } from "@/lib/org/orgTabs";
import type { OverviewLedgerData } from "./OverviewLedgerBaseline";
import { OverviewCheapestPointsRow } from "./OverviewCheapestPointsRow";
import { buildCheapestPoints, type CheapestRow } from "./cheapestPoints";

const SHOWN = 3;

const verb = (row: CheapestRow) => (row.practice ? `Adopt ${row.practice.label.toLowerCase()}` : `Lift ${row.name}`);

export function OverviewCheapestPoints(d: OverviewLedgerData) {
  const standing = d.badges.find((b) => b.label === "Org maturity");
  const avg = standing && typeof standing.value === "number" ? standing.value : null;
  const cp = buildCheapestPoints(d.heatmapRows, d.dimDeltas, avg);
  const reposHref = buildUrl(d.slug, { tab: "repositories" }, d.search);

  if (cp.scored === 0) {
    return (
      <section className="py-6">
        <Kicker tone="muted">Fix next</Kicker>
        <p className="mt-4 type-heading font-medium text-white">No scored repos in this period.</p>
        <p className="mt-2 type-body text-slate-400">Scan one to see what to fix first.</p>
        <a href={reposHref} className="focus-ring mt-6 inline-block type-mono-sm text-accent hover:text-white">
          Scan a repository →
        </a>
      </section>
    );
  }
  if (cp.rows.length === 0) {
    return (
      <section className="py-6">
        <Kicker tone="muted">Fix next</Kicker>
        <p className="mt-4 type-heading font-medium text-white">Every dimension is green in every scored repo.</p>
        <p className="mt-2 type-body text-slate-400">Nothing to fix first — the next points come from pushing green dimensions higher.</p>
      </section>
    );
  }

  const [first, ...rest] = cp.rows;
  const shown = rest.slice(0, SHOWN - 1);
  const shownTotal = Math.round(([first!, ...shown].reduce((s, r) => s + r.lift, 0)) * 10) / 10;

  return (
    <section className="py-4">
      <Kicker tone="muted">Fix next · {cp.scored} scored repos</Kicker>
      <h2 className="mt-4 type-heading font-medium text-white">
        {verb(first!)} first — <span className="type-figure text-white">+{first!.lift.toFixed(1)}</span> fleet points across {first!.repos.length} repo
        {first!.repos.length === 1 ? "" : "s"} below {FOLLOW_UP_BELOW}.
      </h2>

      <ol className="mt-8 border-t border-divider">
        <OverviewCheapestPointsRow row={first!} max={first!.lift} slug={d.slug} verb={verb(first!)} />
        {shown.map((row) => (
          <OverviewCheapestPointsRow key={row.dimId} row={row} max={first!.lift} slug={d.slug} verb={verb(row)} />
        ))}
      </ol>

      <p className="mt-6 max-w-3xl type-body text-slate-400">
        {cp.rows.length > SHOWN
          ? `These ${Math.min(SHOWN, cp.rows.length)} are worth +${shownTotal} of the +${cp.total} on the table across ${cp.rows.length} practices.`
          : `+${cp.total} on the table across ${cp.rows.length} practice${cp.rows.length === 1 ? "" : "s"}.`}
        {cp.landed ? ` Landing all of it would put the fleet at ${cp.landed.avg}, ${cp.landed.level.name} — estimated at the org lens weights.` : ""}
      </p>
    </section>
  );
}
