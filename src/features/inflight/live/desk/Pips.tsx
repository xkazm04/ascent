// One mark per lane: its verdict colour, a hollow ring for UNKNOWN (a lane from before the guard), a
// cross for an errored lane. Shared by the last-rounds table and the round page. No hooks.

import { repoShort, verdictKey, verdictWord } from "./deskFormat";
import type { RoundLane } from "./deskTypes";
import r from "./deskRounds.module.css";

export function Pips({ lanes }: { lanes: readonly RoundLane[] }) {
  return (
    <span className={r.pips}>
      {lanes.map((l) => (
        <i
          key={l.id}
          className={`${r.pip} ${l.errored ? r.err : r[verdictKey(l.verdict)]}`}
          title={`${repoShort(l.repo)} c${l.cycle} · ${l.errored ? "errored" : verdictWord(l.verdict)}`}
        />
      ))}
    </span>
  );
}
