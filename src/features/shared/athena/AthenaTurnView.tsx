// ONE TURN, in reading order: what she DREW, what she OFFERED, what she STOOD ON.
//
// That order is the argument. The blocks are the answer's substance and come first; the proposals are
// the only thing in the turn that asks something of the reader, so they sit where a decision is
// noticed; the recall chips are provenance and go last, because provenance read before the answer is
// a preamble nobody asked for.
//
// BLOCKS ARE FULL-BLEED and the bubble is not. A paragraph needs a ragged right edge and the identity
// gutter that says who is speaking; a table is a drawing, and every pixel it hands back to that gutter
// is a column it cannot show. The `-mx-4` cancels exactly the transcript's own `px-4`.
//
// THE CHIP STRIP RENDERS NOTHING WHEN NOTHING SURVIVED. `selectRecallChips` already drops echoes and
// fragments server-side, and each chip is a DERIVED sentence, never a raw memory excerpt — quoting the
// store verbatim into the drawer would put untrusted, member-written text on screen as if it were hers.

import type { AthenaTurnRecord } from "@/lib/db/athena-threads";
import type { AthenaProposalRecord } from "@/lib/db/athena-proposals";
import { AthenaChart } from "./AthenaChart";
import { AthenaProse } from "./AthenaProse";
import { AthenaProposalCard } from "./AthenaProposalCard";
import { AthenaTable } from "./AthenaTable";
import { turnBlocks, turnChips } from "./model";

function Speaker({ who }: { who: string }) {
  return (
    <div className="type-label tracking-[0.2em] text-slate-500">{who}</div>
  );
}

export function AthenaTurnView({
  turn,
  proposals,
}: {
  turn: AthenaTurnRecord;
  /** The open proposals raised BY this turn. Empty for every turn that raised none. */
  proposals: AthenaProposalRecord[];
}) {
  if (turn.role === "user") {
    return (
      <div className="border-l-2 border-slate-700 pl-3">
        <Speaker who="You" />
        <p className="mt-1 whitespace-pre-wrap type-body-sm leading-relaxed text-slate-200">{turn.content}</p>
      </div>
    );
  }

  const blocks = turnBlocks(turn);
  const chips = turnChips(turn);
  return (
    <div>
      <div className="border-l-2 border-accent/50 pl-3">
        <Speaker who="Athena" />
        <div className="mt-1 max-w-[46ch]">
          <AthenaProse text={turn.content} />
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="-mx-4 mt-3 space-y-3">
          {blocks.map((b, i) =>
            b.type === "table" ? <AthenaTable key={i} block={b} /> : <AthenaChart key={i} block={b} />,
          )}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="mt-3 space-y-2">
          {proposals.map((p) => (
            <AthenaProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <ul className="mt-3 space-y-1">
          {chips.map((insight, i) => (
            <li key={i} className="flex gap-2 type-note leading-relaxed text-slate-500">
              <span aria-hidden className="select-none">↳</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
