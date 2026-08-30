"use client";

// A cell's DELIVERABLE ROWS — one short line per thing the lane did, grouped under a kind heading when
// the cell mixes kinds (Closed · Installed · Hardened · Regressed), a leading glyph when it does not.
// Four rows are visible; "+n more" widens the cell, and only the widened cell carries the evidence
// line under each headline, the per-dimension deltas and the movement prose — the number and the
// words answer to the same verdict, so neither is printed at a glance.

import { useState } from "react";
import { dimShort } from "@/lib/ui";
import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import { CellDims } from "./OutcomeCell";
import type { OutcomeCell as Cell } from "./outcomeMatrix";
import { KIND_META, foldSections, sectionDeliverables } from "./outcomeDeliverables";

function Row({ d, glyph, open }: { d: LaneDeliverable; glyph: string | null; open: boolean }) {
  const down = d.kind === "regressed";
  return (
    <li>
      <div className="flex items-baseline gap-2">
        {glyph && (
          <span aria-hidden className={`type-caption w-3 shrink-0 text-center ${down ? "text-warn" : "text-slate-500"}`}>
            {glyph}
          </span>
        )}
        <span className={`type-body-sm min-w-0 flex-1 truncate ${down ? "text-warn" : "text-slate-200"}`} title={d.evidence ?? d.headline}>
          {d.headline}
        </span>
        {d.dimId && <span className="type-micro shrink-0 font-mono text-slate-500">{dimShort(d.dimId)}</span>}
      </div>
      {open && d.evidence && d.evidence !== d.headline && (
        <p className={`type-note mt-0.5 text-slate-500 ${glyph ? "pl-5" : ""}`}>{d.evidence}</p>
      )}
    </li>
  );
}

export function CellDeliverables({ cell }: { cell: Cell }) {
  const [open, setOpen] = useState(false);
  const sections = sectionDeliverables(cell.deliverables);
  if (sections.length === 0) return <p className="type-caption text-slate-600">nothing delivered</p>;
  const mixed = sections.length > 1;
  const { shown, hidden } = open ? { shown: sections, hidden: 0 } : foldSections(sections);
  return (
    <div>
      <ul className="space-y-0.5">
        {shown.map((s) => (
          <li key={s.kind}>
            {mixed && (
              <p className={`type-micro mt-1.5 font-mono uppercase tracking-[0.14em] first:mt-0 ${s.kind === "regressed" ? "text-warn" : "text-slate-500"}`}>
                {s.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {s.rows.map((d) => (
                <Row key={`${d.dimId ?? ""}|${d.headline}`} d={d} glyph={mixed ? null : KIND_META[s.kind].glyph} open={open} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {open && (
        <>
          <CellDims cell={cell} />
          {cell.movements.map((line) => (
            <p key={line} className="type-note mt-1 text-slate-400">
              {line}
            </p>
          ))}
        </>
      )}
      {(hidden > 0 || open) && (
        <button type="button" onClick={() => setOpen(!open)} className="focus-ring type-micro mt-1 text-slate-500 hover:text-slate-300">
          {open ? "less" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}
