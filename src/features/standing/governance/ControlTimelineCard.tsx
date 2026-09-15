// The control-observation timeline, on the Governance tab (moonshot #1).
//
// The gate cards above answer "does this fleet clear the bar TODAY". This one answers the question an
// examiner actually asks: what has each control BEEN, when did it change, and who changed it.
//
// Rules that govern how it renders, each the honesty contract made visible:
//   • `unmeasurable` is HATCHED in the lane picture and an em dash with a tooltip in the table.
//     Never a zero, never a red. A control we could not read is missing evidence, not a finding, and
//     colouring it like one would turn every expired token into a fleet-wide governance failure on
//     the page a lead screenshots. The sentence that used to say so under the table is now the
//     `not-judged` encoding plus its Legend hint (org UX redesign §2: encode it, don't assert it).
//   • every state is printed beside its COVERAGE — the observation count and the largest gap — so
//     "branch protection held all quarter" cannot be read off two observations three months apart.
//   • MC-B13: a red state carries the catalogue's own `failMeans` sentence, a descriptor renders its
//     VALUE and no verdict, and the tone comes from `stateTone`. See ControlStateCell.tsx.
//   • MC-B13: the read window's truncation disclosure is rendered, computed by the same module
//     `/api/org/controls` uses — this page used to render a 400-row slice with no statement that it
//     was one.
//
// NAMING (MC-B10): "Governance control ledger". Three different things on this dashboard were called
// controls — the Security tab's D9 check battery, the Passports tab's doctor checks, and this. Each
// now says which it is in its own heading. The sentence that spelled that out in the header is
// documentation, not chrome: it lives in docs/features/org-dashboard/org-intelligence.md (F).
//
// Server component: no hooks, no handlers. The expandable observation list is a native <details>, so
// it needs no client boundary and works with JavaScript off. The one client boundary is the Verify
// button inside LedgerIntegrityStrip.

import { Card, InlineEmpty, OrgTable, SectionHeader } from "@/components/org/shared/ui";
import { Legend, StateTrack, WhyChip } from "@/components/org/viz";
import { TIMELINE_CAP, controlCoverage, listControlTimeline, verifySeals } from "@/lib/db/control-observations";
import { coverageSentence, groupTimeline, timelineDisclosure, timelineTotals, truncationSentence } from "./controlTimeline";
import { controlLanes } from "./controlLanes";
import { ControlStateCell } from "./ControlStateCell";
import { LedgerIntegrityStrip } from "./LedgerIntegrityStrip";

/** The demoted actor caveat (D). It was a clause of a 300-character header; it is now reachable on
 *  focus beside the heading and stated in `docs/features/org-dashboard/org-intelligence.md`. */
const ACTOR_HINT =
  "Scan- and probe-sourced rows carry no actor: nobody performed those in a way we observed. " +
  "An installed GitHub App is what names the person behind a change.";

const TIMELINE_LIMIT = 400;

/** Relative-free, locale-free day stamp — a compliance surface states the date, not "3 days ago". */
const day = (iso: string) => iso.slice(0, 10);

export async function ControlTimelineCard({ slug }: { slug: string }) {
  const [rows, coverage, chain] = await Promise.all([
    listControlTimeline(slug, { limit: TIMELINE_LIMIT }),
    controlCoverage(slug),
    verifySeals(slug),
  ]);

  // Null means no database — a different fact from "no observations", and the card says neither
  // rather than rendering an empty table that would read as "nothing has ever happened here".
  if (rows === null) return null;

  const grouped = groupTimeline(rows, coverage ?? []);
  const totals = timelineTotals(grouped);
  const disclosure = timelineDisclosure(rows.length, TIMELINE_LIMIT, TIMELINE_CAP);
  const truncation = truncationSentence(disclosure);
  // First sight is graphical (§2.2): the lanes, not the table header row, carry the headline reading.
  const lanes = controlLanes(rows);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Governance control ledger"
        right={<WhyChip hint={ACTOR_HINT} label="actor evidence" align="end" />}
      />

      {lanes && (
        <div className="mt-4">
          <StateTrack
            rows={lanes.rows}
            start={lanes.start}
            end={lanes.end}
            ticks={lanes.ticks}
            title="Control state by day"
          />
          <Legend className="mt-3" states={lanes.states} />
          {lanes.omitted > 0 && (
            // Counted, never silent: a control left out of the picture must not look like one we
            // never observed — which is exactly what a missing lane would otherwise mean.
            <p className="mt-2 type-micro text-slate-500">
              {lanes.omitted} further control{lanes.omitted === 1 ? "" : "s"} observed but not drawn · all of them are
              in the table below
            </p>
          )}
        </div>
      )}

      {/* Rendered in BOTH branches: an org with no rows yet still needs to be told the ledger is
          verifiable and how. This is the half the old `<code>` string got wrong. */}
      <LedgerIntegrityStrip slug={slug} chain={chain} />

      {grouped.length === 0 ? (
        <div className="mt-4">
          <InlineEmpty>
            No control observations yet. They accumulate as this org&apos;s repositories are scanned and probed;
            an installed GitHub App also adds the actor behind each change.
          </InlineEmpty>
        </div>
      ) : (
        <>
          <p className="mt-4 type-body-sm text-slate-400">
            {totals.pairs} control{totals.pairs === 1 ? "" : "s"} across {totals.repos} repositor
            {totals.repos === 1 ? "y" : "ies"} · {totals.failing} not operating ·{" "}
            {/* Stated separately and never folded into the failing count. */}
            {totals.unmeasurable} not readable
          </p>

          {/* The completeness disclosure the route computed and this page never printed. */}
          {truncation ? <p className="mt-2 type-body-sm text-amber-400">{truncation}</p> : null}

          <OrgTable
            className="mt-4"
            caption="Control observations by repository and control"
            minWidth={760}
            head={
              <tr>
                <th className="px-4 py-3 text-left">Repository</th>
                <th className="px-4 py-3 text-left">Control</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-left">Last change</th>
                <th className="px-4 py-3 text-left">Coverage</th>
              </tr>
            }
          >
            {grouped.map((r) => (
              <tr key={`${r.repoFullName}#${r.controlId}`} className="align-top">
                <td className="px-4 py-3 text-slate-300">{r.repoFullName}</td>
                <td className="px-4 py-3">
                  <details>
                    <summary className="focus-ring cursor-pointer rounded text-slate-200">{r.label}</summary>
                    <ul className="mt-2 space-y-1 type-body-sm text-slate-500">
                      {r.observations.map((o) => (
                        <li key={o.id}>
                          {day(o.occurredAt)} · {o.state}
                          {o.value ? ` (${o.value})` : ""} · {o.source}
                          {o.actorLogin ? ` · ${o.actorLogin}` : ""}
                          {o.transition ? " · changed" : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td className="px-4 py-3">
                  <ControlStateCell row={r} />
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {/* Null is "nothing has changed since we started looking" — never an epoch date. */}
                  {r.lastChangeAt ? (
                    <>
                      {day(r.lastChangeAt)}
                      {r.lastChangeActor ? <span className="text-slate-500"> · {r.lastChangeActor}</span> : null}
                    </>
                  ) : (
                    <span className="text-slate-500" title="No change observed since this control was first seen.">
                      unchanged
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{coverageSentence(r.coverage) ?? "—"}</td>
              </tr>
            ))}
          </OrgTable>
        </>
      )}
    </Card>
  );
}
