// One repository's row in the capability matrix — the cells, the report-back column, and the two
// disclosures the readout computes and nothing used to render. Extracted from CapabilityMatrix.tsx
// (200-LOC cap) as pure relocation plus the three additions named below.
//
// SERVER-SAFE: no hooks, no handlers, no "use client".

import { ABSENT_CELL, CELL_STYLE, type CapabilityMatrixRow } from "./capabilityAgg";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

export function Cell({ capability, row }: { capability: string; row: CapabilityMatrixRow }) {
  const cell = row.cells[capability] ?? ABSENT_CELL;
  const style = CELL_STYLE[cell.state];
  // The two placements are shown as the cell's own underline rather than a second column: control
  // placement is a property OF the declaration, and splitting it out doubled the table's width.
  const wire = cell.wiredAt.includes("prePush")
    ? "border-b border-accent/70"
    : cell.wiredAt.includes("ciHardPass")
      ? "border-b border-dotted border-accent/70"
      : "";
  const title = [
    `${capability}: ${cell.failed ? "declared — its last doctor run FAILED" : style.label}`,
    cell.command ? `command: ${cell.command}` : null,
    cell.wiredAt.length ? `enforced at: ${cell.wiredAt.join(" + ")}` : "declared as a control nowhere",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <td className="px-3 py-2 text-center">
      <span
        title={title}
        className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 type-caption ${style.className} ${wire}`}
      >
        {cell.failed ? "×" : style.mark}
      </span>
    </td>
  );
}

/**
 * The report-back cell (UAT `PRIYA-L1-05`, spec #35 handoff 2's promised column).
 *
 * `getFoundationRollout` had exactly one consumer, on a different tab, so "where is the standard in,
 * and where is it proving itself?" was answered across three tabs with the join living in the
 * reader's head. This is that cross-link: the same honest nulls the Repositories tab's legend states,
 * restated here rather than re-derived — `null` conformance is NEVER REPORTED, not 0%, and an absent
 * `reportBackAt` is NOT PROVISIONED, not "off".
 */
function ReportBackCell({ rollout }: { rollout: FoundationRolloutRow | undefined }) {
  if (!rollout) {
    return (
      <td className="px-4 py-2.5 type-body-sm text-slate-600" title="This repository is not in the fleet rollout read.">
        —
      </td>
    );
  }
  if (!rollout.reportBackAt) {
    return (
      <td className="px-4 py-2.5 type-body-sm text-slate-500" title="Ascent has written no report-back secrets here. The repo may still run .ai/doctor.mjs locally.">
        not provisioned
      </td>
    );
  }
  if (rollout.conformance == null) {
    return (
      <td className="px-4 py-2.5 type-body-sm text-slate-400" title="Report-back is wired, but no run has reported yet — never reported, not 0%.">
        provisioned · never reported
      </td>
    );
  }
  return (
    <td className="px-4 py-2.5 type-mono-sm text-slate-300" title={rollout.conformanceAt ? `last reported ${rollout.conformanceAt.slice(0, 10)}` : undefined}>
      {rollout.conformance}%
    </td>
  );
}

export function CapabilityMatrixRowView({
  row,
  capabilities,
  rollout,
}: {
  row: CapabilityMatrixRow;
  capabilities: string[];
  rollout: FoundationRolloutRow | undefined;
}) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-slate-200">
        {row.name}
        <span className="ml-2 type-caption text-slate-500">{row.fullName}</span>
      </td>
      {capabilities.map((c) => (
        <Cell key={c} capability={c} row={row} />
      ))}
      <td className="px-4 py-2.5 text-right type-mono-sm text-slate-300">
        {row.declared === 0 ? "—" : `${row.verified}/${row.declared}`}
      </td>
      <ReportBackCell rollout={rollout} />
      <td className="px-4 py-2.5 type-body-sm text-slate-500">
        {row.generatedAt ? `manifest of ${row.generatedAt}` : "no generatedAt declared"}
        {/* Spec #13 promised a manifest on an unknown major would be "parsed leniently, flagged
            honestly". It was parsed leniently and flagged nowhere (UAT `PRIYA-L1-04`). */}
        {row.schemaAhead && (
          <span
            className="ml-2 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 type-caption text-amber-300"
            title={`This manifest declares schema ${row.schemaVersion ?? "?"}, a major version this build does not know. It was read leniently: anything the newer schema added is not represented in this row.`}
          >
            schema {row.schemaVersion ?? "?"} ahead
          </span>
        )}
        {row.unbacked.length > 0 && (
          <span className="ml-2 text-amber-400/80" title={`Controls with no backing capability: ${row.unbacked.join(", ")}`}>
            {row.unbacked.length} unbacked control{row.unbacked.length === 1 ? "" : "s"}
          </span>
        )}
        {/* The reader's own notes, including the REDACTION ones — an operator could not otherwise see
            that a command shown here is not the command the repo wrote. */}
        {row.notes.length > 0 && (
          <span className="ml-2 text-slate-400" title={row.notes.join("\n")}>
            {row.notes.length} parse note{row.notes.length === 1 ? "" : "s"}
          </span>
        )}
      </td>
    </tr>
  );
}
