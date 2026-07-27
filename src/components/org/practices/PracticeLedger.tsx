"use client";

// Variant A — "Ledger": one flat, editorial index of every practice, a single row apiece, the org's
// own standards first then the biggest mined reuse opportunity. Calm and scannable top-to-bottom; the
// whole row (and an explicit "View →" affordance) opens the shared detail modal. The space-efficient
// replacement for the old stack of full-height cards — the entire library fits on one screen.

import { OrgTable, Meter, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { categoryLabel, type PracticeRow } from "./practiceRows";

export function PracticeLedger({ rows, onOpen }: { rows: PracticeRow[]; onOpen: (r: PracticeRow) => void }) {
  return (
    <OrgTable
      caption="Practice library"
      minWidth={860}
      head={
        <tr className="text-left">
          <th className="px-4 py-2.5 font-normal">Practice</th>
          <th className="px-4 py-2.5 font-normal">Category</th>
          <th className="px-4 py-2.5 font-normal">Source</th>
          <th className="px-4 py-2.5 font-normal">Adoption</th>
          <th className="px-4 py-2.5 font-normal">Rollout</th>
          <th className="px-4 py-2.5 font-normal" aria-label="Actions" />
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.key} onClick={() => onOpen(r)} className="cursor-pointer align-middle">
          <td className="px-4 py-3">
            <div className="font-medium text-white">{r.label}</div>
            <div className="mt-0.5 max-w-md truncate text-sm text-slate-500">{r.what}</div>
          </td>
          <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-400">{categoryLabel(r.dimId)}</td>
          <td className="px-4 py-3">
            <SourcePill source={r.source} />
          </td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-2">
              {r.adoptionPct != null ? (
                <>
                  <Meter className="w-20" size="sm" value={r.adoptionPct} color={scoreHex(r.adoptionPct)} />
                  <span className="font-mono text-sm tabular-nums text-slate-300">{r.adoptionLabel}</span>
                </>
              ) : (
                <span className="font-mono text-sm text-slate-600">{r.adoptionLabel}</span>
              )}
            </div>
            {r.reachLabel && <div className="mt-1 font-mono text-xs text-slate-500">{r.reachLabel}</div>}
          </td>
          <td className="px-4 py-3">
            <RolloutCell rollout={r.rollout} />
          </td>
          <td className="px-4 py-3 text-right">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen(r);
              }}
              className="focus-ring whitespace-nowrap rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
            >
              View →
            </button>
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}

/**
 * What this practice has PUT IN MOTION — the starter PRs the page's own apply action opened, carried
 * through the shared ImprovementPr lifecycle: in flight → landed → measured lift. Applying used to
 * leave zero trace on the row that offered it; this is the trace. Silent (an em dash) until the
 * practice has been applied at least once, so the ledger stays calm for untouched rows.
 */
function RolloutCell({ rollout }: { rollout: PracticeRow["rollout"] }) {
  if (!rollout || (rollout.open === 0 && rollout.merged === 0)) {
    return <span className="font-mono text-sm text-slate-600">—</span>;
  }
  const { open, merged, lift } = rollout;
  return (
    <div className="space-y-0.5 whitespace-nowrap font-mono text-sm tabular-nums">
      {open > 0 && <div className="text-accent">{open} in flight</div>}
      {merged > 0 && <div className="text-slate-300">{merged} landed</div>}
      {merged > 0 &&
        (lift != null ? (
          <div className="text-xs" style={{ color: deltaHex(lift) }}>
            {fmtDelta(lift)} avg {/* the practice's own dimension, measured post-merge */}
          </div>
        ) : (
          <div className="text-xs text-slate-500">awaiting rescan</div>
        ))}
    </div>
  );
}

function SourcePill({ source }: { source: PracticeRow["source"] }) {
  const authored = source === "authored";
  return (
    <span
      className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider ${
        authored ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-700 bg-slate-900 text-slate-400"
      }`}
    >
      {authored ? "Authored" : "Mined"}
    </span>
  );
}
