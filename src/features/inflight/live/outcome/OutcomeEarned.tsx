"use client";

// VARIANT — "Earned another run". The outcome as ONE DECISION: did the run being judged earn the next
// one? The verdict line IS the heading; under it, the rows that justify it (repo · delta or refusal
// word · what it delivered); under those, the earlier runs as one quiet row each, so the judged run can
// be changed with a click. Reference: Vercel's deployments list — status word, one line of text,
// relative time, the current one marked, 32px rhythm, no prose. Deciding, not persuading.
//
// One number, one place: the net lift lives in the verdict's clause and nowhere else — a typeset
// figure beside the sentence outranked it (round-2 critic), and the verdict is the point.
//
// The judged run is the selected one if it is in the matrix, else the latest — the field's replay and
// this verdict always talk about the same run.

import { timeAgo } from "@/lib/ui";
import { EarnedRepoRow, EarnedRunRow } from "./OutcomeEarnedRows";
import type { OutcomeVariantProps } from "./OutcomeStoryboard";
import { earnedVerdict, judgedColumn, runCells } from "./outcomeEntries";

export function OutcomeEarned({ matrix, selectedId, onOpen }: OutcomeVariantProps) {
  const col = judgedColumn(matrix, selectedId);
  const verdict = earnedVerdict(matrix, col);
  const cells = col ? runCells(matrix, col.id) : [];
  const index = col ? matrix.columns.findIndex((c) => c.id === col.id) + 1 : 0;
  const others = [...matrix.columns].reverse().filter((c) => c.id !== col?.id);
  const tone =
    verdict.kind === "not-earned" ? "text-warn" : verdict.kind === "running" ? "text-accent" : verdict.kind === "none" || verdict.kind === "unmeasured" ? "text-slate-400" : "text-slate-100";
  return (
    <div className="rounded-2xl border border-divider">
      <div className="px-4 py-4">
        {col && (
          <p className="type-caption text-slate-500">
            Run {index} · {timeAgo(col.startedAt)}
          </p>
        )}
        <h4 className={`type-title mt-0.5 font-semibold tracking-tight ${tone}`}>{verdict.headline}</h4>
        <p className="type-caption mt-0.5 text-slate-500">{verdict.reason}</p>
      </div>
      {cells.length > 0 && (
        <ul className="border-t border-divider">
          {cells.map((cell) => (
            <EarnedRepoRow key={cell.repo} cell={cell} />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="border-t border-divider">
          <li className="type-micro px-4 py-1.5 font-mono uppercase tracking-[0.14em] text-slate-600">Earlier runs</li>
          {others.map((c) => (
            <EarnedRunRow
              key={c.id}
              col={c}
              index={matrix.columns.findIndex((x) => x.id === c.id) + 1}
              cells={runCells(matrix, c.id)}
              onOpen={() => onOpen(c.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
