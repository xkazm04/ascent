"use client";

// #16 — one repo × control cell. Four states, and the fourth is the point: an `unchecked` (or never
// reported) clause renders as a DASHED cell reading "—", with a tooltip saying this run did not judge
// it. Never a zero, never a blank that reads as a pass.

import type { ControlCellState } from "./controlMatrixView";
import { sinceLabel } from "./controlMatrixView";

const TONE: Record<string, { className: string; mark: string; word: string }> = {
  pass: { className: "border-b border-accent/70 text-accent", mark: "✓", word: "passing" },
  warn: { className: "border-b border-amber-400/70 text-amber-300", mark: "!", word: "warning" },
  fail: { className: "border-b border-rose-500/70 text-rose-300", mark: "×", word: "failing" },
  unchecked: { className: "border-b border-dashed border-slate-600 text-slate-500", mark: "—", word: "not judged" },
};

export function ControlCell({ label, cell }: { label: string; cell: ControlCellState | null }) {
  // No cell at all = this repo's latest run never reported the clause. Same rendering as `unchecked`
  // on purpose: both mean "we have no result", and only one of them is a claim about the repo.
  const tone = TONE[cell?.level ?? "unchecked"]!;
  const since = sinceLabel(cell?.since ?? null);
  const title = !cell
    ? `${label}: this repository's last doctor run did not report this clause`
    : [
        `${label}: ${tone.word}${cell.count > 1 ? ` (worst of ${cell.count} checks)` : ""}`,
        cell.level === "unchecked" ? "this run did not judge this clause" : null,
        since ? `since ${since}` : "since: unknown in the visible window",
        cell.message || null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <td className="px-3 py-2 text-center">
      <span
        title={title}
        aria-label={title}
        className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 type-caption ${tone.className}`}
      >
        {tone.mark}
      </span>
    </td>
  );
}
