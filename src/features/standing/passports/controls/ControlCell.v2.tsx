// Prism doctor-check cell. The spoken sentence is controlCellTitle, the same one as Altimeter.
// Unchecked, or a clause this run never reported, reads "not judged": never a dash and never 0.
import type { ControlCellState } from "./controlMatrixView";
import { controlCellTitle } from "./ControlCell";

const GLYPH = { pass: "✓", warn: "!", fail: "×" } as const;
const WORD = { pass: "passing", warn: "warning", fail: "failing" } as const;

export function ControlCellV2({ label, cell }: { label: string; cell: ControlCellState | null }) {
  const title = controlCellTitle(label, cell);
  const level = cell?.level ?? "unchecked";
  if (!cell || level === "unchecked") {
    return (
      <td className="px-3 py-2 text-center">
        <span title={title} aria-label={title} className="type-caption text-slate-400">
          not judged
        </span>
      </td>
    );
  }
  return (
    <td className="px-3 py-2 text-center">
      <span title={title} aria-label={title} className="type-caption text-slate-200">
        <span aria-hidden>{GLYPH[level]} </span>
        {WORD[level]}
      </span>
    </td>
  );
}
