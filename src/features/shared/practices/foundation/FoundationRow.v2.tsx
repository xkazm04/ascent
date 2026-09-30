"use client";

// One repository in the Prism foundation table. Conformance stays paper. Never-reported is a void,
// never a dash and never zero. Draft PR and report-back are words.
import { GhostAction, MonoPath, VoidMark } from "@/components/kit";
import { CELL } from "@/components/kit";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function FoundationRowV2({
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
      <td className={CELL}><MonoPath>{row.repo}</MonoPath></td>
      <td className={`${CELL} text-slate-400`}>
        {row.foundationPrAt ? (
          <span title="Ascent opened a draft pull request. That is a proposal, not an install.">
            PR opened <span className="text-slate-400">{day(row.foundationPrAt)}</span>
          </span>
        ) : (
          <span title="Ascent has opened no foundation PR here. A repo whose team committed .ai/ by hand is invisible to this view.">
            No Ascent PR
          </span>
        )}
      </td>
      <td className={CELL}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400">
            {provisioned ? `Provisioned ${day(row.reportBackAt) ?? ""}` : "Not provisioned"}
          </span>
          <GhostAction disabled={busy} onClick={provisioned ? onRevoke : onProvision}>
            {provisioned ? "Remove" : "Set up report-back"}
          </GhostAction>
        </span>
      </td>
      <td className={`${CELL} tabular-nums text-slate-100`}>
        {row.conformance == null ? (
          <span className="inline-flex items-center gap-2 text-slate-400" title="Never reported. An absence, never a zero.">
            <VoidMark label={`${row.repo} conformance: not measured`} />
            not measured
          </span>
        ) : (
          <span>
            {row.conformance}%
            {row.conformanceAt && <span className="ml-2 text-slate-400">{day(row.conformanceAt)}</span>}
          </span>
        )}
      </td>
    </tr>
  );
}
