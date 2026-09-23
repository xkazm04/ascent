// "Where each lane runs": for this org, which engine and whose account answers every LLM lane now,
// and, when a provider is saved but not switched on, what switching it on would move.
//
// It sits under ProviderBoundaryCard because it answers the question that card cannot: the boundary
// matrix says what each PROVIDER is; this says which LANES a connected provider actually carries. The
// two that do not (shared memory and lane summaries stay on the platform seam by design) are flagged
// on their rows and named in the footnote, so the BYOM decision is made with them in view.
//
// Server-safe: no hooks, no handlers. The data is secret-free by construction (lane-routes-load.ts).

import { Kicker } from "@/components/ui";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import type { LaneRouting } from "@/lib/llm/lane-routes-load";
import { laneRoutingView, platformOnlyLanes, type LaneCell, type LaneTone } from "./laneRoutingViz";

const TONE: Record<LaneTone, string> = {
  yours: "text-accent",
  platform: "text-slate-200",
  quiet: "text-slate-400",
  warn: "text-amber-300",
};

const GRID = "grid grid-cols-1 gap-x-4 gap-y-1 sm:items-baseline";
const COLS_ONE = "sm:grid-cols-[1.3fr_1.7fr]";
const COLS_TWO = "sm:grid-cols-[1.3fr_1.7fr_1.7fr]";

function Cell({ cell, moves = false }: { cell: LaneCell; moves?: boolean }) {
  return (
    <span className="min-w-0">
      <span className={`type-body-sm ${TONE[cell.tone]}`}>{cell.text}</span>
      {moves ? <span className="ml-2 type-note text-accent">moves</span> : null}
      <span className="block type-mono-sm text-slate-500">
        {cell.model ? <span className="break-all">{cell.model} · </span> : null}
        {cell.account}
      </span>
    </span>
  );
}

export function LaneRoutingCard({ routing }: { routing: LaneRouting | null }) {
  if (!routing) {
    return (
      <Card>
        <SectionHeader size="sm" title="Where each lane runs" description="Could not be read right now" />
        <p className="mt-3 type-body-sm text-slate-400">
          This organization&apos;s provider state could not be determined, so no lane is shown rather than a guess.
        </p>
      </Card>
    );
  }

  const view = laneRoutingView(routing);
  const preview = view.previewSummary !== null;
  const cols = preview ? COLS_TWO : COLS_ONE;
  const stays = platformOnlyLanes();

  return (
    <Card>
      <SectionHeader size="sm" title="Where each lane runs" description={view.summary} />

      <div className={`mt-4 hidden border-b border-slate-800 px-1 pb-2 sm:grid ${GRID} ${cols}`}>
        <Kicker tone="muted" as="span">Lane</Kicker>
        <Kicker tone="muted" as="span">Now</Kicker>
        {preview ? <Kicker tone="muted" as="span">If switched on</Kicker> : null}
      </div>

      <ul className={preview ? "" : "mt-4"}>
        {view.rows.map((row) => (
          <li
            key={row.lane}
            data-moves={row.moves ? "true" : undefined}
            className={`${GRID} ${cols} border-b border-slate-800 px-1 py-2.5 last:border-0`}
          >
            <span className="min-w-0">
              <span className="type-body-sm font-medium text-slate-200">{row.label}</span>
              {row.bypassesByom ? <span className="ml-2 type-note text-amber-300">BYOM does not apply</span> : null}
              <span className="block type-note text-slate-500">{row.hint}</span>
            </span>
            <Cell cell={row.now} />
            {row.next ? (
              <span className="min-w-0">
                <span className="type-note text-slate-500 sm:hidden">If switched on: </span>
                <Cell cell={row.next} moves={row.moves} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {preview ? (
        <p className="mt-3 type-note text-slate-400">If switched on: {view.previewSummary}.</p>
      ) : null}
      <p className="mt-2 type-note text-slate-500">
        A connected provider never carries {stays.join(" or ").toLowerCase()}: {stays.length === 1 ? "it stays" : "they stay"} on the
        Ascent platform provider, with this organization&apos;s content.
      </p>
    </Card>
  );
}
