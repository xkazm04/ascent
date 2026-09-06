"use client";

// event-clustering: the cluster is a VIEW. The toggle recomputes the grouping over the same atomic
// rows (nothing is stored grouped); the predicate is explicit — consecutive, one relation key
// (`actor:sync`), within a window, size-capped; the singular kinds are excluded by kind. Extend the
// newest run and watch its row update in place: identity is the oldest member, so an expanded cluster
// stays expanded as members join, and the "N new" pill counts occurrences, not rows.

import { NEVER_CLUSTER } from "./fixtures";
import type { Action, State } from "./feedStore";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import { CLUSTER_CAP, CLUSTER_WINDOW_MS, type Derived } from "./useFeed";

export function ClusterRegion({ s, d, dispatch }: { s: State; d: Derived; dispatch: (a: Action) => void }) {
  const clusters = d.rows.filter((r) => r.type === "cluster");
  const collapsed = clusters.reduce((n, c) => n + (c.type === "cluster" ? c.members.length - 1 : 0), 0);
  return (
    <Region technique="event-clustering" title="Bursts collapse to one row" note="Consecutive · same relation key · within a window · capped. A derivation at render, never storage.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={s.clusterOn ? BTN_ON : BTN} aria-pressed={s.clusterOn} onClick={() => dispatch({ type: "cluster", on: true })}>
            clustered digest
          </button>
          <button type="button" className={!s.clusterOn ? BTN_ON : BTN} aria-pressed={!s.clusterOn} onClick={() => dispatch({ type: "cluster", on: false })}>
            flat log
          </button>
          <button type="button" className={BTN} onClick={() => dispatch({ type: "arrive", count: 1, sync: true })}>
            extend the newest sync run
          </button>
        </div>
        <Readout label="rows rendered / occurrences" value={<span data-rendered={d.rows.length}>{`${d.rows.length} / ${d.sorted.length}`}</span>} />
        <Readout label="clusters · occurrences folded" value={<span data-clusters={clusters.length}>{`${clusters.length} · ${collapsed}`}</span>} />
        <table className="w-full type-caption">
          <tbody>
            <tr className="border-t border-divider text-slate-300">
              <td className="py-1 text-slate-500">relation key</td>
              <td className="py-1">actor + kind, declared per kind (sync only)</td>
            </tr>
            <tr className="border-t border-divider text-slate-300">
              <td className="py-1 text-slate-500">window · cap</td>
              <td className="py-1 tabular-nums">
                {CLUSTER_WINDOW_MS / 60_000} min between members · {CLUSTER_CAP} members, then a new cluster
              </td>
            </tr>
            <tr className="border-t border-divider text-slate-300">
              <td className="py-1 text-slate-500">never clustered</td>
              <td className="py-1">{NEVER_CLUSTER.join(", ")} — acted on individually</td>
            </tr>
            <tr className="border-t border-divider text-slate-300">
              <td className="py-1 text-slate-500">identity · position</td>
              <td className="py-1">oldest member (stable as it grows) · newest member (a live run sorts at now)</td>
            </tr>
          </tbody>
        </table>
        <p className="type-caption text-slate-500">
          The cluster row says what it counted — relation · count · span — and surfaces its worst member: a warning inside a calm-looking run is shown on the row, never buried behind the disclosure.
        </p>
      </div>
    </Region>
  );
}
