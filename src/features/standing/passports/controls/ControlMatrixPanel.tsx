"use client";

// #16 — Standing › Passports › Doctor checks: the fleet control matrix, sourced from the
// repositories' OWN CI. Every cell is a clause a repo's `.ai/doctor.mjs` judged in the repo's own
// pipeline and reported back — not a remote scanner's opinion about the repo, which is the thing
// that makes it admissible as evidence.
//
// /org redesign (docs/ORG-UX-REDESIGN.md §2): the 331-character lede is gone. Its every clause is now
// either an encoding (the hatched `not-judged` cell, which structurally cannot print a number), a
// disclosure (the `WhyChip` on the header, the kit `Legend`, each cell's generated `<title>`), or
// documentation (the two sibling catalogues, in docs/features/reporting/report.md). The grid is the
// overview; the expandable table below is the drill-down.

import { Kicker, SectionHeading } from "@/components/ui";
import { Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import { orgTabHref } from "@/lib/org/orgTabs";
import { ControlMatrixGrid } from "./ControlMatrixGrid";
import { controlVizModel } from "./controlMatrixViz";
import { useControlMatrix } from "./useControlMatrix";

const AUDIT_HINT =
  "These rows are derived. The tamper-evident copy of every report is the signed conformance.reported entry in this organization's audit log.";

export function ControlMatrixPanel({ org }: { org: string }) {
  const { rows, loading, error, expanded, toggleFamily } = useControlMatrix(org);

  const reporting = rows?.filter((r) => !r.summaryOnly) ?? [];
  const failing = reporting.filter((r) => r.checks.some((c) => c.level === "fail")).length;
  const summaryOnly = rows?.filter((r) => r.summaryOnly).length ?? 0;
  const viz = controlVizModel(rows ?? []);

  return (
    <section className="space-y-6">
      <div>
        <Kicker>proven in your own CI</Kicker>
        {/* MC-B10: named for its SOURCE, because three tabs carried a catalogue called "controls". */}
        <SectionHeading title="Doctor checks" right={<WhyChip hint={AUDIT_HINT} label="how these rows are stored" align="end" />} />
      </div>

      {loading && <p className="type-body text-slate-400">Loading the doctor-check matrix…</p>}

      {error && (
        <p className="rounded-2xl border border-divider bg-surface/40 p-4 type-body text-amber-300">
          {error} Nothing is shown rather than an empty grid: an unanswered request is not evidence that
          the fleet has no controls.
        </p>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        /* UAT `PRIYA-L1-03`: this empty state described hand-wiring two secrets that the
           Repositories tab now provisions in one click. "Make the right thing the easy thing" —
           the thing IS easy; the words weren't. The manual route stays, second. */
        <p className="type-body text-slate-400">
          No repository in this organization has reported a doctor run yet. The quickest route is{" "}
          <a href={`${orgTabHref(org, "repositories")}#foundation-rollout`} className="text-accent underline underline-offset-2">
            Repositories › Foundation rollout
          </a>
          , which installs <code>.ai/</code> and provisions report-back — both secrets, per repo — in one
          click. By hand: wire <code>node .ai/doctor.mjs --json</code> into a repo&apos;s CI with{" "}
          <code>ASCENT_CONFORMANCE_URL</code> and <code>ASCENT_CONFORMANCE_TOKEN</code>. Either way, its
          controls appear here after the next run.
        </p>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <>
          {/* First sight is the shape: repos × check families, share of judged clauses passed. */}
          <div className="rounded-2xl border border-divider bg-surface/40 p-4">
            <MatrixGrid axes={viz.axes} rows={viz.rows} title="Doctor checks by repository and check family" />
            <Legend states={viz.states} className="mt-3" />
          </div>

          <div className={`${TILE_LEDGER} sm:grid-cols-3`}>
            <Tile label="Repos reporting" value={reporting.length} sub={`${rows.length} have reported at all`} />
            <Tile label="With a failing control" value={failing} sub="in their latest run" />
            <Tile
              label="Summary-only reporters"
              value={summaryOnly}
              sub={summaryOnly ? "doctor < 0.3.0 — no clause-level result" : "every reporter sends findings"}
            />
          </div>

          <ControlMatrixGrid rows={rows} expanded={expanded} onToggleFamily={toggleFamily} />
        </>
      )}
    </section>
  );
}
