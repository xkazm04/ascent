// The control-observation timeline, on the Governance tab (moonshot #1).
//
// The gate cards above answer "does this fleet clear the bar TODAY". This one answers the question an
// examiner actually asks: what has each control BEEN, when did it change, and who changed it.
//
// Two rules govern how it renders, and both are the honesty contract made visible:
//   • `unmeasurable` is an em dash with a tooltip. Never a zero, never a red. A control we could not
//     read is missing evidence, not a finding, and colouring it like one would turn every expired
//     token into a fleet-wide governance failure on the page a lead screenshots.
//   • every state is printed beside its COVERAGE — the observation count and the largest gap — so
//     "branch protection held all quarter" cannot be read off two observations three months apart.
//
// Server component: no hooks, no handlers. The expandable observation list is a native <details>, so
// it needs no client boundary and works with JavaScript off.

import { Card, InlineEmpty, OrgTable, SectionHeader } from "@/components/org/shared/ui";
import { controlCoverage, listControlTimeline } from "@/lib/db/control-observations";
import { STATE_TITLE, coverageSentence, groupTimeline, timelineTotals } from "./controlTimeline";

const TIMELINE_LIMIT = 400;

/** Relative-free, locale-free day stamp — a compliance surface states the date, not "3 days ago". */
const day = (iso: string) => iso.slice(0, 10);

function StateCell({ state, value }: { state: "pass" | "fail" | "unmeasurable"; value: string | null }) {
  if (state === "unmeasurable") {
    return (
      <span className="text-slate-500" title={STATE_TITLE.unmeasurable}>
        —
      </span>
    );
  }
  return (
    <span className={state === "pass" ? "text-emerald-400" : "text-red-400"} title={STATE_TITLE[state]}>
      {state === "pass" ? "operating" : "not operating"}
      {/* The value carries what the state cannot: a required-approvals count, a visibility. */}
      {value && value !== "true" && value !== "false" ? <span className="text-slate-500"> · {value}</span> : null}
    </span>
  );
}

export async function ControlTimelineCard({ slug }: { slug: string }) {
  const [rows, coverage] = await Promise.all([
    listControlTimeline(slug, { limit: TIMELINE_LIMIT }),
    controlCoverage(slug),
  ]);

  // Null means no database — a different fact from "no observations", and the card says neither
  // rather than rendering an empty table that would read as "nothing has ever happened here".
  if (rows === null) return null;

  const grouped = groupTimeline(rows, coverage ?? []);
  const totals = timelineTotals(grouped);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Control observations"
        description="What each control was, when it changed, and — where a GitHub event named one — who changed it. Scan- and probe-sourced rows carry no actor: nobody performed those in a way we observed."
      />

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
                  <StateCell state={r.state} value={r.value} />
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

          <p className="mt-3 type-body-sm text-slate-500">
            A dash under State means the control was not readable at the last observation — missing evidence, not a
            finding. Verify this ledger&apos;s integrity at{" "}
            <code className="text-slate-400">/api/audit/verify?org={slug}</code>.
          </p>
        </>
      )}
    </Card>
  );
}
