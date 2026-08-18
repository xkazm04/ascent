"use client";

// The moves board — the single most-shared Care structure, so it lives here and every variant styles
// its own frame around it. Two layouts:
//   `columns` — the four states side by side (Companion's notebook board).
//   `stack`   — one column of rows, denser, state as a chip (Cockpit's adjustments list, Climb's
//               handholds), which is also what the columns layout degrades to on a narrow viewport.
//
// The two facts a move must always carry: the WHY (evidence from the developer's own journal) and the
// fleet EVIDENCE ascent can add and the local skill cannot see. A move rendered without both is the
// argument for the app going unmade.

import { SectionEmpty } from "@/components/org/shared/ui";
import { CareAction, CareCategoryChip, CareLinkAction, CareSaving, CareStateChip, CARE_STATE_LABEL } from "./CareBits";
import { careMovesByState, CARE_MOVE_STATES, type CareMove, type CareMoveState } from "@/lib/org/developer-view";

function MoveCard({ move, showState }: { move: CareMove; showState: boolean }) {
  const closed = move.state === "dropped";
  return (
    <article
      className={`rounded-xl border border-divider bg-ink p-4 ${closed ? "opacity-70" : ""}`}
      aria-label={`${move.title} — ${CARE_STATE_LABEL[move.state]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {showState ? <CareStateChip state={move.state} /> : null}
        <CareCategoryChip category={move.category} />
        {move.tryFor != null ? (
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">try for {move.tryFor} sessions</span>
        ) : null}
      </div>
      <h4 className={`mt-2 text-base ${closed ? "text-slate-400" : "font-medium text-white"}`}>{move.title}</h4>
      <p className="mt-2 text-sm text-slate-400">
        <span className="font-mono text-xs uppercase tracking-widest text-slate-500">why · </span>
        {move.why}
      </p>
      {move.evidence ? (
        <p className="mt-1.5 text-sm text-slate-300">
          <span className="font-mono text-xs uppercase tracking-widest text-accent">fleet · </span>
          {move.evidence}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-slate-600">
          <span className="font-mono text-xs uppercase tracking-widest">fleet · </span>
          nothing observed yet
        </p>
      )}
      {move.droppedReason ? <p className="mt-1.5 text-sm text-slate-500">Dropped: {move.droppedReason}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-3">
        <CareSaving minutes={move.expectedSaving} />
        <div className="flex flex-wrap items-center gap-2">
          {move.state === "trying" || move.state === "proposed" ? (
            <>
              <CareLinkAction label="Mark kept" intent="move.keep" payload={{ id: move.id }} />
              <CareLinkAction label="Drop" intent="move.drop" payload={{ id: move.id }} />
            </>
          ) : null}
          {move.state === "kept" && move.registryPromotable ? (
            <CareAction label="Promote to registry →" intent="move.promote" payload={{ id: move.id }} />
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function CareMovesBoard({
  moves,
  layout = "columns",
  onlyStates,
}: {
  moves: CareMove[];
  layout?: "columns" | "stack";
  /** Restrict the board to a subset of states (Climb shows only what is still ahead of you). */
  onlyStates?: readonly CareMoveState[];
}) {
  const states = onlyStates ?? CARE_MOVE_STATES;
  const shown = moves.filter((m) => states.includes(m.state));
  if (shown.length === 0) {
    return <SectionEmpty>No moves yet. The local mentor proposes them from your own journal — nothing is assigned to you here.</SectionEmpty>;
  }

  if (layout === "stack") {
    return (
      <div className="mt-3 space-y-3">
        {shown.map((m) => (
          <MoveCard key={m.id} move={m} showState />
        ))}
      </div>
    );
  }

  const byState = careMovesByState(shown);
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {states.map((state) => (
        <section key={state} aria-label={CARE_STATE_LABEL[state]}>
          <div className="flex items-baseline justify-between border-b border-divider pb-2">
            <CareStateChip state={state} />
            <span className="font-mono text-sm tabular-nums text-slate-500">{byState[state].length}</span>
          </div>
          <div className="mt-3 space-y-3">
            {byState[state].length === 0 ? (
              <p className="text-sm text-slate-600">—</p>
            ) : (
              byState[state].map((m) => <MoveCard key={m.id} move={m} showState={false} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
