"use client";

// invisible-differences: rows the kernel rightly marks changed whose two sides look identical. Each
// renders with its cause and magnitude — indentation depth, terminator, a no-extent or impersonating
// character named by code point — and the reader's own "ignore whitespace" toggle is a labelled,
// counted view carried by the reference, never a deletion.

import { useMemo, useState } from "react";
import { INVISIBLE_ROWS, invisibleMarks, isWhitespaceOnly, revealInvisible } from "./contract";
import { Chip, KindMark, Readout, Region, TD, TH } from "./parts";

const KLASS_TONE = { whitespace: "text-warn", "no-extent": "text-accent-soft", impersonating: "text-danger-soft" } as const;

export function InvisibleRegion({ pairLabel }: { pairLabel: string }) {
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [cyrillic, setCyrillic] = useState(false);
  const rows = useMemo(() => INVISIBLE_ROWS.map((r) => ({ row: r, marks: invisibleMarks(r, cyrillic), wsOnly: isWhitespaceOnly(r) })), [cyrillic]);
  const suppressed = rows.filter((r) => r.wsOnly).length;
  const visible = ignoreWs ? rows.filter((r) => !r.wsOnly) : rows;
  const reference = `#compare?pair=${encodeURIComponent(pairLabel)}&ws=${ignoreWs ? "ignore" : "exact"}&repertoire=${cyrillic ? "latin+cyrillic" : "latin"}`;

  return (
    <Region technique="invisible-differences" title="Invisible differences" note="One unexplainable highlight costs more trust than ten missing ones. Whitespace carries its magnitude; what cannot be seen is named; what impersonates is marked.">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Chip on={ignoreWs} onClick={() => setIgnoreWs((v) => !v)} label="Ignore whitespace">ignore whitespace</Chip>
          <Chip on={cyrillic} onClick={() => setCyrillic((v) => !v)} label="Declare Cyrillic expected">repertoire: {cyrillic ? "Latin + Cyrillic" : "Latin"}</Chip>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          <Readout label="active suppressions" value={ignoreWs ? "whitespace (reader view)" : "none"} tone={ignoreWs ? "text-warn" : "text-slate-200"} />
          <Readout label="suppressed, counted" value={ignoreWs ? `${suppressed} rows differ only in whitespace` : "—"} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full type-caption" data-suppressed={ignoreWs ? suppressed : 0}>
            <thead className="type-label tracking-[0.2em] text-slate-500">
              <tr><th className={TH}>mark</th><th className={TH}>row</th><th className={TH}>baseline</th><th className={TH}>candidate</th><th className={TH}>cause</th></tr>
            </thead>
            <tbody>
              {visible.map(({ row, marks }) => (
                <tr key={row.id} data-row={row.id} data-marks={marks.length}>
                  <td className={TD}><KindMark kind="changed" /></td>
                  <td className={`${TD} text-slate-400`}>{row.name}</td>
                  <td className={`${TD} font-mono text-slate-300`}>{revealInvisible(row.before)}</td>
                  <td className={`${TD} font-mono text-slate-300`}>{revealInvisible(row.after)}</td>
                  <td className={TD}>
                    {marks.length === 0 ? <span className="text-slate-600">within the declared repertoire</span> : marks.map((m) => (
                      <span key={m.text} className={`mr-2 font-mono ${KLASS_TONE[m.klass]}`} data-klass={m.klass}>{m.text}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ignoreWs ? <p className="type-caption text-warn" data-ws-note="true">{suppressed} whitespace-only rows are annotated out of this view, not deleted — and one of them is an indentation change, which in indentation-significant text is a relocation.</p> : null}
        <Readout label="reference carries the view" value={<span className="break-all">{reference}</span>} />
      </div>
    </Region>
  );
}
