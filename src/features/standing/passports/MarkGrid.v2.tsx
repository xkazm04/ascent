// Prism matrix. Same rows the Altimeter MatrixGrid paints, set as CellMarks in a table.
// A short row is padded with a void, the same rule as MatrixGrid, and that void says
// "not measured" rather than 0. Server-safe: no hooks.
import { CellMark, DataTable } from "@/components/kit";
import { cellAt, type MatrixRow } from "@/components/org/viz/matrixShared";
import { stateTitle } from "@/components/org/viz/states";
import { cellMarkView } from "./markCell";

export function MarkGridV2({
  axes,
  rows,
  title,
  subject = "Subject",
}: {
  axes: readonly string[];
  rows: MatrixRow[];
  title: string;
  subject?: string;
}) {
  if (axes.length === 0 || rows.length === 0) {
    return (
      <p role="img" aria-label={`${title}: no matrix data`} className="type-body-sm text-slate-400">
        No matrix data
      </p>
    );
  }

  return (
    <DataTable
      density="compact"
      stickyFirstCol
      minWidth={280 + axes.length * 148}
      caption={title}
      head={
        <tr>
          <th className="px-3 py-2 text-left">{subject}</th>
          {axes.map((axis) => (
            <th key={axis} className="px-3 py-2 text-left">
              {axis}
            </th>
          ))}
        </tr>
      }
    >
      {rows.map((row) => (
        <tr key={row.id}>
          <td className="px-3 py-2 text-slate-200">{row.label}</td>
          {axes.map((axis, index) => {
            const cell = cellAt(row, index);
            const view = cellMarkView(cell);
            return (
              <td
                key={axis}
                className="px-3 py-2"
                data-cell={`${row.id}:${axis}`}
                data-state={view.state}
                title={stateTitle(cell.state, `${row.label}, ${axis}`)}
              >
                <CellMark state={view.state}>{view.word}</CellMark>
              </td>
            );
          })}
        </tr>
      ))}
    </DataTable>
  );
}
