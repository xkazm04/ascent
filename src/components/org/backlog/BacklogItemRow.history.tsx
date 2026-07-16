import type { RecEvent } from "@/lib/types";
import { EVENT_LABEL, eventValue } from "@/components/org/shared/backlogShared";

/**
 * The expandable per-row history/timeline list. Extracted from BacklogItemRow to keep that file
 * under the 300-LOC cap — pure presentational relocation, behavior unchanged. `history` mirrors the
 * lifted row state: "loading" while a fetch is in flight, an event array once resolved.
 */
export function BacklogRowHistory({ history }: { history: RecEvent[] | "loading" }) {
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      {history === "loading" ? (
        <p className="font-mono text-sm text-slate-500">Loading history…</p>
      ) : history.length === 0 ? (
        <p className="font-mono text-sm text-slate-500">No changes recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {history.map((ev) => (
            <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-400">
              <span className="font-mono text-sm text-slate-600">{new Date(ev.at).toLocaleString()}</span>
              <span className="text-slate-300">{ev.actor ? `@${ev.actor}` : "system"}</span>
              {ev.kind === "note" ? (
                // A standalone note event (a comment on a patch that changed no field) has no
                // from/to — render it as a plain comment, not "set … — → —".
                <span>noted</span>
              ) : (
                <span>
                  set {EVENT_LABEL[ev.kind] ?? ev.kind} {eventValue(ev.kind, ev.from)} → <span className="text-slate-200">{eventValue(ev.kind, ev.to)}</span>
                </span>
              )}
              {ev.note && <span className="text-slate-500">“{ev.note}”</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
