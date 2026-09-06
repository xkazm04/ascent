"use client";

// action-busy-states: the pressed control's contract in one component, with zero state at the call
// site. The call site hands over the OPERATION (a promise); the button disarms SYNCHRONOUSLY in the
// click handler through a ref (a state-driven `disabled` lands one frame late, and a fast double-press
// lives in that frame), shows a real spinner in place, holds its geometry (min-width), announces
// `aria-busy`, and restores itself in `finally` — on success, on failure, and on the bounded timeout.

import { useEffect, useRef, useState } from "react";
import { BUSY_TIMEOUT_MS } from "./asyncState";

export type Outcome = "ok" | "failed" | "timeout";

export function BusyButton({
  onPress,
  label,
  busyLabel = "Working…",
  reduced,
  className,
  onOutcome,
  onAttempt,
}: {
  /** The operation. Its lifetime IS the busy state; a fire-and-forget wrapper would disarm the guard. */
  onPress: () => Promise<unknown>;
  label: string;
  busyLabel?: string;
  reduced: boolean;
  className: string;
  onOutcome?: (o: Outcome) => void;
  /** Every press, including the ones the guard refuses — the double-press counter reads it. */
  onAttempt?: (accepted: boolean) => void;
}) {
  const inFlight = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const press = () => {
    if (inFlight.current) {
      onAttempt?.(false); // the door is already closed — before React has re-rendered anything
      return;
    }
    inFlight.current = true;
    onAttempt?.(true);
    setBusy(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => resolve("timeout"), BUSY_TIMEOUT_MS);
    });
    const work = Promise.resolve()
      .then(onPress)
      .then((): Outcome => "ok", (): Outcome => "failed");
    Promise.race([work, bound])
      .then((o) => {
        if (alive.current) onOutcome?.(o);
      })
      .finally(() => {
        clearTimeout(timer);
        inFlight.current = false;
        if (alive.current) setBusy(false);
      });
  };

  return (
    <button type="button" onClick={press} disabled={busy} aria-busy={busy} className={`${className} inline-flex min-w-[7.5rem] items-center justify-center gap-1.5`}>
      {busy ? (
        <span
          aria-hidden
          className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-slate-600 border-t-accent"
          style={{ animation: reduced ? "none" : "async-spin 700ms linear infinite" }}
        />
      ) : null}
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}
