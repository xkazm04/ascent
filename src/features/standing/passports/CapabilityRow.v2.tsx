// One capability-matrix row in Prism. Status is a glyph and a word. Absent is "not declared"
// (a known negative). A repo missing from the rollout read is a void, never a zero.
import { VoidMark } from "@/components/kit";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { ABSENT_CELL, CELL_STYLE, type CapabilityMatrixRow } from "./capabilityAgg";

function Cell({ capability, row }: { capability: string; row: CapabilityMatrixRow }) {
  const cell = row.cells[capability] ?? ABSENT_CELL;
  const wire = cell.wiredAt.includes("prePush")
    ? "border-b border-solid border-slate-300"
    : cell.wiredAt.includes("ciHardPass")
      ? "border-b border-dotted border-slate-300"
      : "";
  const word = cell.failed ? "failed" : cell.state === "absent" ? "not declared" : cell.state;
  const glyph = cell.failed ? "×" : cell.state === "verified" ? "✓" : cell.state === "declared" ? "·" : cell.state === "placeholder" ? "?" : "";
  const headline = cell.failed ? "declared: its last doctor run failed" : cell.state === "absent" ? "not declared" : CELL_STYLE[cell.state].label;
  const title = [
    `${capability}: ${headline}`,
    cell.command ? `command: ${cell.command}` : null,
    cell.wiredAt.length ? `enforced at: ${cell.wiredAt.join(" + ")}` : "declared as a control nowhere",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <td className="px-3 py-2 text-center">
      <span title={title} aria-label={title} className={`inline-flex items-center justify-center type-caption text-slate-200 ${wire}`}>
        {glyph && <span aria-hidden className="mr-1">{glyph}</span>}
        <span className={word === "not declared" ? "text-slate-400" : undefined}>{word}</span>
      </span>
    </td>
  );
}

function ReportBack({ rollout }: { rollout: FoundationRolloutRow | undefined }) {
  if (!rollout) {
    return (
      <td className="px-3 py-2">
        <VoidMark subject="Report-back" label="This repository is not in the fleet rollout read." />
      </td>
    );
  }
  if (!rollout.reportBackAt) {
    return (
      <td className="px-3 py-2 text-slate-400" title="Ascent has written no report-back secrets here. The repo may still run .ai/doctor.mjs locally.">
        not provisioned
      </td>
    );
  }
  if (rollout.conformance == null) {
    return (
      <td className="px-3 py-2 text-slate-400" title="Report-back is wired, but no run has reported yet. Never reported, not 0%.">
        provisioned · never reported
      </td>
    );
  }
  return (
    <td className="px-3 py-2 tabular-nums text-white" title={rollout.conformanceAt ? `last reported ${rollout.conformanceAt.slice(0, 10)}` : undefined}>
      {rollout.conformance}%
    </td>
  );
}

export function CapabilityRowV2({
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
      <td className="whitespace-nowrap px-3 py-2 text-slate-200">
        {row.name}
        <span className="ml-2 type-caption text-slate-400">{row.fullName}</span>
      </td>
      {capabilities.map((c) => (
        <Cell key={c} capability={c} row={row} />
      ))}
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-white">
        {row.declared === 0 ? <span className="text-slate-400">none declared</span> : `${row.verified}/${row.declared}`}
      </td>
      <ReportBack rollout={rollout} />
      <td className="px-3 py-2 text-slate-400">
        {row.generatedAt ? `manifest of ${row.generatedAt}` : "no generatedAt declared"}
        {row.schemaAhead && (
          <span
            className="ml-2 text-slate-400"
            title={`This manifest declares schema ${row.schemaVersion ?? "?"}, a major version this build does not know. It was read leniently: anything the newer schema added is not represented in this row.`}
          >
            <span aria-hidden>▲ </span>schema {row.schemaVersion ?? "?"} ahead
          </span>
        )}
        {row.unbacked.length > 0 && (
          <span className="ml-2 text-slate-400" title={`Controls with no backing capability: ${row.unbacked.join(", ")}`}>
            {row.unbacked.length} unbacked control{row.unbacked.length === 1 ? "" : "s"}
          </span>
        )}
        {row.notes.length > 0 && (
          <span className="ml-2 text-slate-400" title={row.notes.join("\n")}>
            {row.notes.length} parse note{row.notes.length === 1 ? "" : "s"}
          </span>
        )}
      </td>
    </tr>
  );
}
