"use client";

// #16 — Standing › Passports › Controls: the fleet control matrix, sourced from the repositories'
// OWN CI. Every cell is a clause a repo's `.ai/doctor.mjs` judged in the repo's own pipeline and
// reported back — not a remote scanner's opinion about the repo, which is the thing that makes it
// admissible as evidence.

import { Kicker, SectionHeading } from "@/components/ui";
import { Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { ControlMatrixGrid } from "./ControlMatrixGrid";
import { useControlMatrix } from "./useControlMatrix";

export function ControlMatrixPanel({ org }: { org: string }) {
  const { rows, loading, error, expanded, toggleFamily } = useControlMatrix(org);

  const reporting = rows?.filter((r) => !r.summaryOnly) ?? [];
  const failing = reporting.filter((r) => r.checks.some((c) => c.level === "fail")).length;
  const summaryOnly = rows?.filter((r) => r.summaryOnly).length ?? 0;

  return (
    <section className="space-y-6">
      <div>
        <Kicker>proven in your own CI</Kicker>
        <SectionHeading
          title="Controls"
          intro="Every control each repository declares, as judged by its own doctor in its own pipeline. A clause a run did not judge shows as “not judged” — never as passing."
        />
      </div>

      {loading && <p className="text-base text-slate-400">Loading the control matrix…</p>}

      {error && (
        <p className="rounded-2xl border border-divider bg-surface/40 p-4 text-base text-amber-300">
          {error} Nothing is shown rather than an empty grid: an unanswered request is not evidence that
          the fleet has no controls.
        </p>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        <p className="text-base text-slate-400">
          No repository in this organization has reported a doctor run yet. Wire{" "}
          <code>node .ai/doctor.mjs --json</code> into a repo&apos;s CI with{" "}
          <code>ASCENT_CONFORMANCE_URL</code> and <code>ASCENT_CONFORMANCE_TOKEN</code>, and its controls
          appear here after the next run.
        </p>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <>
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

          <p className="text-sm text-slate-500">
            Column headers are check families; click one to expand it into its individual clauses. These
            rows are DERIVED data — the tamper-evident copy of every report is the signed{" "}
            <code>conformance.reported</code> entry in this organization&apos;s audit log.
          </p>
        </>
      )}
    </section>
  );
}
