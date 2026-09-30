// Governance control ledger in Prism. The lane picture stays (no kit part draws a control over time).
// The table under it is the kit table, and an unreadable state is a void.
import { Caption, Frame, SectionHead } from "@/components/kit";
import { Legend, StateTrack } from "@/components/org/viz";
import { TIMELINE_CAP, controlCoverage, listControlTimeline, verifySeals } from "@/lib/db/control-observations";
import { controlLanes } from "./controlLanes";
import { groupTimeline, timelineDisclosure, timelineTotals, truncationSentence } from "./controlTimeline";
import { ControlLedgerTableV2 } from "./ControlLedgerTable.v2";
import { LedgerIntegrityV2 } from "./LedgerIntegrity.v2";

const TIMELINE_LIMIT = 400;
const ACTOR_HINT =
  "Scan- and probe-sourced rows carry no actor: nobody performed those in a way we observed. " +
  "An installed GitHub App is what names the person behind a change.";

export async function ControlLedgerV2({ slug }: { slug: string }) {
  const [rows, coverage, chain] = await Promise.all([
    listControlTimeline(slug, { limit: TIMELINE_LIMIT }),
    controlCoverage(slug),
    verifySeals(slug),
  ]);
  if (rows === null) return null;

  const grouped = groupTimeline(rows, coverage ?? []);
  const totals = timelineTotals(grouped);
  const truncation = truncationSentence(timelineDisclosure(rows.length, TIMELINE_LIMIT, TIMELINE_CAP));
  const lanes = controlLanes(rows);

  return (
    <Frame aria-label="Governance control ledger">
      <SectionHead id="governance-ledger-heading" eyebrow="Ledger" title="Governance control ledger" lede={ACTOR_HINT} />
      {lanes && (
        <div className="mt-5">
          <StateTrack rows={lanes.rows} start={lanes.start} end={lanes.end} ticks={lanes.ticks} title="Control state by day" />
          <Legend className="mt-3" states={lanes.states} />
          {lanes.omitted > 0 && (
            <Caption className="mt-2">
              {lanes.omitted} further control{lanes.omitted === 1 ? "" : "s"} observed but not drawn. All of them are in
              the table below.
            </Caption>
          )}
        </div>
      )}
      <LedgerIntegrityV2 slug={slug} chain={chain} />
      {grouped.length === 0 ? (
        <p className="mt-4 type-body text-slate-300">
          No control observations yet. They accumulate as this org&apos;s repositories are scanned and probed; an
          installed GitHub App also adds the actor behind each change.
        </p>
      ) : (
        <>
          <p className="mt-4 type-body text-slate-300">
            {totals.pairs} control{totals.pairs === 1 ? "" : "s"} across {totals.repos} repositor
            {totals.repos === 1 ? "y" : "ies"}, {totals.failing} not operating, {totals.unmeasurable} not readable
          </p>
          {truncation ? <p className="mt-2 type-body-sm text-slate-400">▲ {truncation}</p> : null}
          <ControlLedgerTableV2 rows={grouped} />
        </>
      )}
    </Frame>
  );
}
