"use client";

// One repository in the Prism foundation table. Each axis is a CellMark. A reported percent stays
// paper beside "reported". Never-reported is unmeasured, never zero.
import { CELL, CellMark, GhostAction, MonoPath } from "@/components/kit";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { foundationBackMark, foundationConformanceMark, foundationPrMark } from "./foundationMarks";

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
  const pr = foundationPrMark(row);
  const back = foundationBackMark(row);
  const conformance = foundationConformanceMark(row);
  const provisioned = row.reportBackAt != null;
  return (
    <tr>
      <td className={CELL}>
        <MonoPath>{row.repo}</MonoPath>
      </td>
      <td className={CELL}>
        <span
          className="inline-flex items-baseline gap-2"
          title={
            row.foundationPrAt
              ? "Ascent opened a draft pull request. That is a proposal, not an install."
              : "Ascent has opened no foundation PR here. A repo whose team committed .ai/ by hand is invisible to this view."
          }
        >
          <CellMark state={pr.state}>{pr.word}</CellMark>
          {row.foundationPrAt && <span className="text-slate-400">{day(row.foundationPrAt)}</span>}
        </span>
      </td>
      <td className={CELL}>
        <span className="flex flex-wrap items-center gap-2">
          <CellMark state={back.state}>{back.word}</CellMark>
          {provisioned && <span className="text-slate-400">{day(row.reportBackAt)}</span>}
          <GhostAction disabled={busy} onClick={provisioned ? onRevoke : onProvision}>
            {provisioned ? "Remove" : "Set up report-back"}
          </GhostAction>
        </span>
      </td>
      <td className={CELL}>
        <span
          className="inline-flex items-baseline gap-2"
          title={row.conformance == null ? "Never reported. An absence, never a zero." : undefined}
        >
          <CellMark state={conformance.state}>{conformance.word}</CellMark>
          {row.conformance != null && <span className="tabular-nums text-slate-100">{row.conformance}%</span>}
          {row.conformance != null && row.conformanceAt && <span className="text-slate-400">{day(row.conformanceAt)}</span>}
        </span>
      </td>
    </tr>
  );
}
