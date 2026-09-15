// The "would be erased now" panel — the picture of WHAT dies beside the count of HOW MUCH.
//
// Split out of DataErasurePreview.tsx so that file stays under the 200-LOC `src/features/**` cap once
// the manifest matrix landed in it. Presentational only: every state it can show is decided by the
// counts it is handed, so no hooks and deliberately NO "use client" (MatrixGrid and WhyChip carry
// their own client boundary).
//
// The counts stay exactly as they were, including the FLOOR prefix when a preview stopped at its own
// time budget: "at least 412" is the honest reading, and saying "412" would be the same unearned
// reassurance an unreceived zero is. See erasePreviewViz.ts for the matrix.

import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import { auditDispositionHint } from "./eraseTotals";
import type { ErasePreview } from "./DataErasurePreview";
import { ERASE_AXES, ERASE_MATRIX_HINT, erasePreviewRows, erasePreviewStates } from "./erasePreviewViz";

const num = (n: number) => n.toLocaleString("en-US");

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1">
      <dt className="text-slate-500">
        {label}
        {hint && <span className="ml-1 text-slate-600">{hint}</span>}
      </dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  );
}

export function ErasePreviewPanel({ counts }: { counts: ErasePreview }) {
  // A preview stopped by its own time budget has counted a PREFIX of the org, so its totals are a
  // floor, not a total.
  const floor = counts.complete ? "" : "at least ";
  const auditAffected = counts.auditDeleted + counts.auditRedacted;
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

      <div className="mt-2 max-w-[15rem]">
        <MatrixGrid axes={[...ERASE_AXES]} rows={rows} title="What this erasure destroys and what it leaves" />
      </div>
      <Legend states={erasePreviewStates(rows)} className="mt-2" />

      <dl className="mt-2.5 space-y-0 type-mono-sm">
        <Row label="Scans" value={`${floor}${num(counts.scansDeleted)}`} />
        <Row label="Repositories" value={`${floor}${num(counts.reposProcessed)}`} />
        <Row label="Audit rows" hint={auditHint} value={num(auditAffected)} />
      </dl>
      <p className="mt-1.5 type-note text-slate-500">
        {counts.complete
          ? "Counted by the same query the erase runs; nothing has been touched."
          : "This organization is large enough that the count stopped at a safe boundary — the real totals are higher."}
      </p>
    </div>
  );
}
