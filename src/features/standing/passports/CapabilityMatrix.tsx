// #13 — Standing › Passports › Capabilities: the fleet's declared-vs-proven-vs-wired matrix.
//
// The view every competitor's dashboard cannot give, because it scores a repo against the VENDOR's
// criteria: this scores each repo against its OWN declared contract (`.ai/manifest.yaml`) and shows
// which of those declarations its own doctor has actually proven.
//
// The layout is deliberately two-part. The table is repos whose contract was read. Everything else —
// a repo scanned before the readout shipped, or one whose manifest could not be parsed — sits in a
// separate band BELOW, out of every denominator. A single table with "0/0" rows would make "we have
// not looked" indistinguishable from "declares nothing", and the whole point of the surface is that
// those are different answers to a CISO's question.

import { OrgTable, Tile, TILE_LEDGER, MeterRow } from "@/components/org/shared/ui";
import { Kicker, SectionHeading } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { ABSENT_CELL, CELL_STYLE, buildCapabilityMatrix, verifiedRatio, type CapabilityMatrixInput } from "./capabilityAgg";
import { CapabilityMatrixLegend } from "./CapabilityMatrixLegend";

function Cell({ capability, row }: { capability: string; row: ReturnType<typeof buildCapabilityMatrix>["rows"][number] }) {
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
        className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 font-mono text-xs ${style.className} ${wire}`}
      >
        {cell.failed ? "×" : style.mark}
      </span>
    </td>
  );
}

export function CapabilityMatrix({ repos }: { repos: CapabilityMatrixInput[] }) {
  const matrix = buildCapabilityMatrix(repos);
  const ratio = verifiedRatio(matrix);

  return (
    <section className="space-y-6">
      <div>
        <Kicker>declared vs proven</Kicker>
        <SectionHeading
          title="Capabilities"
          intro="Every repository against its OWN .ai/manifest.yaml: what it declares it can do, what its doctor has proven, and where each control is enforced."
        />
      </div>

      <div className={`${TILE_LEDGER} sm:grid-cols-3`}>
        <Tile label="Repos assessed" value={matrix.totals.repos} sub={`${matrix.unassessed.length} not assessed`} />
        <Tile
          label="Capabilities proven"
          value={ratio === null ? "—" : `${matrix.totals.verified}/${matrix.totals.declared}`}
          sub={ratio === null ? "no manifest read yet" : `${ratio}% of what the fleet declares`}
          color={ratio === null ? undefined : scoreHex(ratio)}
        />
        <Tile label="Declarations with a control" value={matrix.totals.wired} sub="pre-push or CI hard pass" />
      </div>

      {ratio !== null && (
        <MeterRow layout="labelled" value={ratio} display={`${ratio}%`} label="proven of declared" color={scoreHex(ratio)} />
      )}

      {matrix.rows.length === 0 ? (
        <p className="text-base text-slate-400">
          No repository in this view has had its <code>.ai/manifest.yaml</code> read yet. Re-scan a repository that
          carries one and it appears here — nothing is inferred in the meantime.
        </p>
      ) : (
        <OrgTable
          caption="Repositories by declared capability"
          minWidth={520 + matrix.capabilities.length * 72}
          head={
            <tr>
              <th className="px-4 py-3 text-left">Repository</th>
              {matrix.capabilities.map((c) => (
                <th key={c} className="px-3 py-3 text-center font-mono">
                  {c}
                </th>
              ))}
              <th className="px-4 py-3 text-right">Proven</th>
              <th className="px-4 py-3 text-left">Declared</th>
            </tr>
          }
        >
          {matrix.rows.map((row) => (
            <tr key={row.fullName}>
              <td className="px-4 py-2.5 text-slate-200">
                {row.name}
                <span className="ml-2 font-mono text-xs text-slate-500">{row.fullName}</span>
              </td>
              {matrix.capabilities.map((c) => (
                <Cell key={c} capability={c} row={row} />
              ))}
              <td className="px-4 py-2.5 text-right font-mono text-sm text-slate-300">
                {row.declared === 0 ? "—" : `${row.verified}/${row.declared}`}
              </td>
              <td className="px-4 py-2.5 text-sm text-slate-500">
                {row.generatedAt ? `manifest of ${row.generatedAt}` : "no generatedAt declared"}
                {row.unbacked.length > 0 && (
                  <span className="ml-2 text-amber-400/80" title={`Controls with no backing capability: ${row.unbacked.join(", ")}`}>
                    {row.unbacked.length} unbacked control{row.unbacked.length === 1 ? "" : "s"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </OrgTable>
      )}

      <CapabilityMatrixLegend unassessed={matrix.unassessed.length} />

      {matrix.unassessed.length > 0 && (
        <div className="rounded-2xl border border-dashed border-divider p-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">not assessed — re-scan</p>
          <p className="mt-2 text-sm text-slate-400">
            These repositories are counted in no ratio above. Their latest scan did not read a manifest, so the honest
            statement is that we do not know what they declare — not that they declare nothing.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-300">
            {matrix.unassessed.map((u) => (
              <li key={u.fullName} className="font-mono text-xs">
                {u.fullName}
                <span className="ml-1.5 text-slate-500">
                  ({u.reason === "unreadable" ? "manifest unreadable" : "no manifest in this scan"})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
