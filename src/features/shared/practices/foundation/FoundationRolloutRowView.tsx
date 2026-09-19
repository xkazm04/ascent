"use client";

// One repository's row in the foundation rollout table. Extracted from FoundationRolloutPanel for the
// 200-LOC features cap; it holds no state and issues no requests — the panel owns both.
//
// Every cell distinguishes ABSENCE from a value, and says which it is in words rather than by a blank:
// "No Ascent PR" is not the same as an install that failed, and "—" under conformance is never 0%.
// scoreHex is the one colour source for the conformance number, so it reads on the same scale as every
// other score in the product, and each absent cell carries the SAME `StateSwatch` the grid above it
// paints — so a hatch in the overview and a hatch in the evidence row are one encoding, not two.
//
// "PR opened", not "Installed": `foundation.pr_opened` records a DRAFT PR (src/lib/github/write.ts),
// which nobody has necessarily merged. See foundationViz.ts for the full reasoning.

import { StateSwatch } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : null;

export function FoundationRolloutRowView({
  row,
  busy,
  onProvision,
  onRevoke,
}: {
  row: FoundationRolloutRow;
  busy: boolean;
  onProvision: () => void;
  onRevoke: () => void;
}) {
  const provisioned = row.reportBackAt != null;
  return (
    <tr>
      <td className="px-4 py-2.5 type-mono-sm text-white">{row.repo}</td>

      <td className="px-4 py-2.5 type-body-sm">
        {row.foundationPrAt ? (
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <StateSwatch state="declared" />
            PR opened <span className="font-mono text-slate-500">{shortDate(row.foundationPrAt)}</span>
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 text-slate-500"
            title="Ascent has opened no foundation PR here. A repo whose team committed .ai/ by hand is invisible to this view — not judged, not absent."
          >
            <StateSwatch state="not-judged" />
            No Ascent PR
          </span>
        )}
      </td>

      <td className="px-4 py-2.5 type-body-sm">
        <div className="flex flex-wrap items-center gap-2">
          {provisioned ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <StateSwatch state="measured" />
              Provisioned <span className="font-mono text-slate-500">{shortDate(row.reportBackAt)}</span>
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 text-slate-500"
              title="Ascent has written no report-back secrets here. That is not 'off' — the repo may still run .ai/doctor.mjs locally, unseen."
            >
              <StateSwatch state="missing" />
              Not provisioned
            </span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={provisioned ? onRevoke : onProvision}
            className={`focus-ring rounded-md border px-2 py-1 type-label tracking-widest transition disabled:opacity-40 ${
              provisioned
                ? "border-slate-700 text-slate-400 hover:border-danger/50 hover:text-danger-soft"
                : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
            }`}
          >
            {provisioned ? "Remove" : "Set up report-back"}
          </button>
        </div>
      </td>

      <td className="px-4 py-2.5 type-body-sm">
        {row.conformance == null ? (
          <span
            title="Never reported — this repo has not run node .ai/doctor.mjs --json against Ascent. An absence, never a zero."
            className="inline-flex items-center gap-1.5 text-slate-500"
          >
            <StateSwatch state="missing" />—
          </span>
        ) : (
          <span className="font-mono tabular-nums" style={{ color: scoreHex(row.conformance) }}>
            {row.conformance}%
            {row.conformanceAt && <span className="ml-2 text-slate-500">{shortDate(row.conformanceAt)}</span>}
          </span>
        )}
      </td>
    </tr>
  );
}
