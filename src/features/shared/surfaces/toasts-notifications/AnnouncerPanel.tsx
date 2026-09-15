"use client";

// announcement-accessibility: two visually-hidden live regions mounted with the desk, EMPTY, and only
// ever written into by the store's drain — one writer. Politeness came from the severity table when
// the event was emitted; here the queue drains serially with a gap, assertive first, and the
// transcript mirrors what was voiced. The caret proves arrival never moves focus; the documented
// shortcut reaches the stack on demand and Escape there hands focus back.

import { useEffect, useState } from "react";
import type { Desk } from "./useDesk";
import { DRAIN_GAP_MS, QUEUE_CAP, regionText } from "./announcer";
import { BTN, Readout, Region } from "./sceneParts";
import { STACK_ID } from "./ToastStack";

export function AnnouncerRegion({ desk }: { desk: Desk }) {
  const { state, dispatch, running } = desk;
  const a = state.announcer;
  const [focusNote, setFocusNote] = useState("caret in the field");
  const [draft, setDraft] = useState("");

  // The documented shortcut: Alt+T reaches the toast area. Reachable on demand, never stolen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        (document.getElementById(STACK_ID)?.querySelector<HTMLElement>("button") ?? document.getElementById(STACK_ID))?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Region technique="announcement-accessibility" title="Announced, not just rendered" note="Regions exist before the news. One writer drains a bounded queue serially; assertive jumps it. Focus is never moved by an arrival.">
      {/* The live regions: mounted at scene mount with nothing inside, written into on every drain. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-live="polite">
        {regionText(a.polite, a.nonce)}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" data-live="assertive">
        {regionText(a.assertive, a.nonce)}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <label className="block">
            <span className="type-caption text-slate-400">you are typing here</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setFocusNote("caret in the field")}
              onBlur={(e) => setFocusNote(e.relatedTarget instanceof HTMLElement ? `moved to: ${e.relatedTarget.getAttribute("aria-label") ?? e.relatedTarget.textContent?.trim() ?? "?"}` : "left the field")}
              className="focus-ring mt-1 w-full rounded-md border border-divider bg-surface px-2 py-1 type-caption text-slate-200"
              placeholder="raise a toast while the caret is here"
              data-caret
            />
          </label>
          <Readout label="focus" value={<span data-focus-note={focusNote}>{focusNote}</span>} />
          <p className="type-micro text-slate-500">Alt+T reaches the stack; Escape on a toast dismisses it and returns focus here. Focus within a toast pauses its dwell exactly as hover does.</p>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} onClick={() => dispatch({ type: "announce:drain" })} disabled={a.queue.length === 0} aria-label="Voice the next utterance">
              voice next
            </button>
            <span className="type-caption text-slate-500" data-drain-queue={a.queue.length}>
              {a.queue.length} queued · gap {DRAIN_GAP_MS / 1000}s{running ? "" : " · clock paused: step by hand"} · cap {QUEUE_CAP}
            </span>
          </div>
          <Readout label="shed under storm" value={<span data-dropped={a.dropped}>{a.dropped}</span>} />
          <ul className="max-h-32 space-y-0.5 overflow-y-auto" aria-label="Voiced transcript" data-transcript>
            {a.voiced.length === 0 ? <li className="type-caption text-slate-600">nothing voiced yet</li> : null}
            {a.voiced.map((v, i) => (
              <li key={`${v.at}-${i}`} className="flex items-baseline gap-2 type-micro" data-voiced={v.politeness}>
                <span className={`shrink-0 rounded px-1 font-mono ${v.politeness === "assertive" ? "bg-danger/20 text-danger-soft" : "bg-divider text-slate-400"}`}>{v.politeness}</span>
                <span className="text-slate-300">{v.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Region>
  );
}
