"use client";

// queue-discipline: the desk's transient corner. The stack renders the queue's OUTPUT — at most
// MAX_VISIBLE, severity preempting the lowest slot, same-key repeats coalesced with a count, repeats
// inside a cooldown suppressed but counted, the tail summarized into one synthetic toast — and the
// one clock every dwell reads, with its visible pause control (started paused under `reduced`).
// The fire buttons raise the same events the rest of the desk raises; the log is the queue's
// observability: what each tier did with every event.

import { AnimatePresence } from "framer-motion";
import { useEffect, useRef } from "react";
import type { Desk } from "./useDesk";
import { EVENTS, storm } from "./fixtures";
import { MAX_VISIBLE, visible, waiting } from "./queue";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import { ToastCard } from "./ToastCard";

export const STACK_ID = "desk-toast-stack";

export function StackRegion({ desk, reduced, fleet }: { desk: Desk; reduced: boolean; fleet: string[] }) {
  const { state, dispatch, running, setRunning } = desk;
  const shown = visible(state.queue);
  const queued = waiting(state.queue);
  // Where focus was before it entered the stack — what Escape hands it back to. Tracked at the
  // document so a keyboard user's last place is known even when the stack was reached by shortcut.
  const returnTo = useRef<HTMLElement | null>(null);
  const stackRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !stackRef.current?.contains(t)) returnTo.current = t;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  // The fleet window is never empty in the scene; the names only back an emptied fixture.
  const [a = "alloy-01", b = "basalt-02"] = fleet;
  const fire = (ev: Parameters<typeof dispatch>[0]) => dispatch(ev);

  return (
    <Region technique="queue-discipline" title="A queue with policy" note={`Max ${MAX_VISIBLE} on screen; severity preempts; repeats coalesce; the tail is summarized, never raced. Waiting toasts do not age.`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className={running ? BTN_ON : BTN} onClick={() => setRunning(!running)} aria-label={running ? "Pause the clock" : "Run the clock"} aria-pressed={running}>
          {running ? "■ pause clock" : "▶ run clock"}
        </button>
        <span className="type-caption text-slate-500" data-clock={running ? "running" : "paused"}>
          t = {(state.now / 1000).toFixed(1)}s{reduced && !running ? " · reduced: started paused" : ""}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className={BTN} onClick={() => fire({ type: "emit", ev: EVENTS.scanFinished(a) })}>
          scan finished
        </button>
        <button type="button" className={BTN} onClick={() => fire({ type: "emit", ev: EVENTS.creditsLow() })}>
          credits low
        </button>
        <button type="button" className={BTN} onClick={() => fire({ type: "emit", ev: EVENTS.rescanFailed(b) })}>
          repeat failure
        </button>
        <button type="button" className={BTN} onClick={() => fire({ type: "emit", ev: EVENTS.engineDown() })}>
          critical
        </button>
        <button type="button" className={BTN} onClick={() => storm(fleet).forEach((ev) => fire({ type: "emit", ev }))}>
          storm ×{fleet.length + 2}
        </button>
      </div>

      <div className="rounded-lg border border-dashed border-divider p-2" data-viewport>
        <p className="mb-2 type-micro text-slate-600">viewport corner · Alt+T jumps here · Escape dismisses the focused toast</p>
        <ul id={STACK_ID} ref={stackRef} className="min-h-[3rem] space-y-1.5" aria-label="Notifications" tabIndex={-1} data-stack>
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((t) => (
              <ToastCard
                key={t.id}
                toast={t}
                reduced={reduced}
                onAct={() => dispatch({ type: "act", id: t.id })}
                onDismiss={() => dispatch({ type: "dismiss", id: t.id })}
                onAttend={(on) => dispatch({ type: "attend", id: t.id, on })}
                onEscape={() => {
                  dispatch({ type: "dismiss", id: t.id });
                  returnTo.current?.focus(); // dismissal returns focus to where the user was
                }}
              />
            ))}
          </AnimatePresence>
        </ul>
        {shown.length === 0 ? <p className="type-caption text-slate-600">nothing on screen</p> : null}
        {queued.length > 0 ? (
          <p className="mt-2 type-micro text-slate-500" data-waiting={queued.length}>
            waiting, un-clocked: {queued.map((t) => `${t.title}${t.count > 1 ? ` ×${t.count}` : ""}`).join(" · ")}
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-1 sm:grid-cols-2">
        <Readout label="depth" value={<span data-depth={state.queue.toasts.length}>{shown.length} shown · {queued.length} waiting</span>} />
        <Readout label="coalesced" value={<span data-coalesced={state.queue.stats.coalesced}>{state.queue.stats.coalesced}</span>} />
        <Readout label="suppressed (cooldown)" value={<span data-suppressed={state.queue.stats.suppressed}>{state.queue.stats.suppressed}</span>} />
        <Readout label="shed → ledger" value={<span data-shed={state.queue.stats.shed}>{state.queue.stats.shed}</span>} tone={state.queue.stats.shed ? "text-warn" : "text-slate-200"} />
      </div>
      <ul className="mt-3 max-h-24 space-y-0.5 overflow-y-auto font-mono type-micro text-slate-500" aria-label="Event log" data-log>
        {state.log.slice(0, 6).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </Region>
  );
}
