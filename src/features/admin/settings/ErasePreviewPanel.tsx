// The "would be erased now" panel — the picture of WHAT dies beside the count of HOW MUCH.
//
// Split out of DataErasurePreview.tsx so that file stays under the 200-LOC `src/features/**` cap once
// the manifest matrix landed in it. Presentational only: every state it can show is decided by the
// counts it is handed, so no hooks and deliberately NO "use client" (MatrixGrid and WhyChip carry
// their own client boundary).
//
// The list is every family POST /api/org/erase already counted, not a scans+repos+audit subset. A
// field the body omitted is omitted here too — never a fabricated 0. The FLOOR prefix still applies
// when a preview stopped at its own time budget: "at least 412" is the honest reading. See
// erasePreviewViz.ts for the matrix and the family catalog.

import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import { auditDispositionHint } from "./eraseTotals";
import type { ErasePreview } from "./DataErasurePreview";
import {
  ERASE_AXES,
  ERASE_MATRIX_HINT,
  eraseBlastGroups,
  erasePreviewRows,
  erasePreviewStates,
} from "./erasePreviewViz";

const num = (n: number) => n.toLocaleString("en-US");

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1">
      <dt className="text-slate-500">{hint ? `${label} ${hint}` : label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  );
}

/** Shared with the RECEIPT so the preview and the outcome cannot describe different families. */
export function EraseBlastList({
  counts,
  floor = "",
  reposLabel,
  auditHint,
}: {
  counts: object;
  floor?: string;
  reposLabel?: string;
  auditHint?: string;
}) {
  const groups = eraseBlastGroups(counts, { reposLabel, auditHint });
  return (
    <div className="space-y-2 type-mono-sm">
      {groups.map((g) => (
        <div key={g.id}>
          {g.title ? <p className="type-label tracking-widest text-slate-500">{g.title}</p> : null}
          <dl className="space-y-0">
            {g.rows.map((r) => (
              <Row
                key={r.label}
                label={r.label}
                hint={r.hint}
                value={`${g.id === "Audit" ? "" : floor}${num(r.value)}`}
              />
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

export function ErasePreviewPanel({ counts }: { counts: ErasePreview }) {
  // A preview stopped by its own time budget has counted a PREFIX of the org, so its totals are a
  // floor, not a total.
  const floor = counts.complete ? "" : "at least ";
  // Shared with the RECEIPT (DataErasureOutcome) so the same disposition cannot be described one way
  // before the confirmation and another way after it.
  const auditHint = auditDispositionHint(counts.auditDisposition);
  const rows = erasePreviewRows(counts.auditDisposition);

  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <p className="type-label tracking-widest text-danger">Would be erased now</p>
        <WhyChip hint={ERASE_MATRIX_HINT} label="what is erased and what is kept" />
      </div>

      <div className="mt-2">
        <MatrixGrid axes={[...ERASE_AXES]} rows={rows} title="What this erasure destroys and what it leaves" />
      </div>
      <Legend states={erasePreviewStates(rows)} className="mt-2" />

      <div className="mt-2.5">
        <EraseBlastList counts={counts} floor={floor} auditHint={auditHint} />
      </div>
      <p className="mt-1.5 type-note text-slate-500">
        {counts.complete
          ? "Counted by the same query the erase runs; nothing has been touched. Families the body omitted are omitted, not shown as zero."
          : "This organization is large enough that the count stopped at a safe boundary — the real totals are higher."}
      </p>
    </div>
  );
}
