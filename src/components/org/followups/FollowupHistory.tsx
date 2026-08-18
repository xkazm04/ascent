"use client";

// A row's timeline, fetched on expand — ported from the Backlog tab's per-row history. In the
// follow-ups loop this is where the ARCHIVE explains itself: a resolved row's last event says whether
// the scan closed it by commit trailer or because the gap was no longer raised, and a handed-off row
// shows when. Loading / error / empty are three distinct states — an error is a retry, never the
// empty copy (which would claim an untouched item).

import { useEffect, useState } from "react";
import type { RecEvent } from "@/lib/types";
import { EVENT_LABEL, eventValue } from "@/components/org/shared/backlogShared";

export function FollowupHistory({ id }: { id: string }) {
  const [state, setState] = useState<RecEvent[] | "loading" | "error">("loading");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState("loading");
      try {
        const r = await fetch(`/api/recommendations/${id}/events`);
        const d = (await r.json().catch(() => null)) as { events?: RecEvent[] } | null;
        if (cancelled) return;
        setState(r.ok && d?.events ? d.events : "error");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  if (state === "loading") return <p className="font-mono text-xs text-slate-500">Loading history…</p>;
  if (state === "error")
    return (
      <p role="alert" className="font-mono text-xs text-orange-300">
        Couldn’t load history.{" "}
        <button type="button" onClick={() => setNonce((n) => n + 1)} className="focus-ring rounded text-slate-300 hover:text-white">
          Retry
        </button>
      </p>
    );
  if (state.length === 0) return <p className="font-mono text-xs text-slate-500">No changes recorded yet.</p>;
  return (
    <ul className="space-y-1">
      {state.map((ev) => (
        <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-400">
          <span className="font-mono text-slate-600">{new Date(ev.at).toLocaleString()}</span>
          <span className="text-slate-300">{ev.actor ? `@${ev.actor}` : "system"}</span>
          {ev.kind === "note" ? (
            <span>noted</span>
          ) : (
            <span>
              {EVENT_LABEL[ev.kind] ?? ev.kind} {eventValue(ev.kind, ev.from)} → <span className="text-slate-200">{eventValue(ev.kind, ev.to)}</span>
            </span>
          )}
          {ev.note && <span className="text-slate-500">“{ev.note}”</span>}
        </li>
      ))}
    </ul>
  );
}
