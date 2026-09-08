"use client";

// action-busy-states: a review queue with one operation per item. Each Approve is a BusyButton — the
// press is acknowledged in place, the control disarms synchronously (a scripted double-press lands
// twice and submits once), geometry holds, `aria-busy` is set, and completion is announced through
// a live region. Busy is scoped to the item pressed: the siblings stay actionable.

import { useRef, useState } from "react";
import { LATENCY, type Latency } from "./asyncState";
import { BusyButton, type Outcome } from "./BusyButton";
import { QUEUE } from "./fixtures";
import { BTN, Readout, Region } from "./sceneParts";

const QROW = "flex h-9 items-center justify-between gap-3 rounded-md border border-divider px-2";

export function QueueRegion({ reduced, latency }: { reduced: boolean; latency: Latency }) {
  const [approved, setApproved] = useState<ReadonlySet<string>>(() => new Set());
  const [presses, setPresses] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [announce, setAnnounce] = useState("");
  const root = useRef<HTMLDivElement>(null);

  const approve = (id: string) => () =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        setApproved((s) => new Set(s).add(id));
        resolve();
      }, LATENCY[latency]);
    });
  const outcome = (title: string) => (o: Outcome) => setAnnounce(o === "ok" ? `Approved: ${title}` : o === "timeout" ? `Timed out: ${title}` : `Failed: ${title}`);
  const attempt = (ok: boolean) => {
    setPresses((n) => n + 1);
    if (ok) setAccepted((n) => n + 1);
  };
  // Two clicks in the same task — before React can commit a `disabled`. The ref guard must catch the second.
  const doublePress = () => {
    const btn = root.current?.querySelector<HTMLButtonElement>('[data-item="fu-1"] button');
    btn?.click();
    btn?.click();
  };

  return (
    <Region technique="action-busy-states" title="Did my press register?" note="A spinner belongs on the pressed control — in place, disarmed, announced, scoped to the item.">
      <div ref={root}>
        <ul className="space-y-1">
          {QUEUE.map((f) => (
            <li key={f.id} className={QROW} data-item={f.id} data-approved={approved.has(f.id)}>
              <span className="min-w-0 truncate type-caption text-slate-300">
                {f.title} <span className="text-slate-600">· {f.repo}</span>
              </span>
              {approved.has(f.id) ? (
                <span className="type-caption text-success-soft">✓ approved</span>
              ) : (
                <BusyButton label="Approve" busyLabel="Approving…" reduced={reduced} className={BTN} onPress={approve(f.id)} onOutcome={outcome(f.title)} onAttempt={attempt} />
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={doublePress} disabled={approved.has("fu-1")}>
          scripted double-press on row 1
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => {
            setApproved(new Set());
            setPresses(0);
            setAccepted(0);
            setAnnounce("");
          }}
        >
          reset queue
        </button>
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="presses / submitted" value={<span data-presses={presses} data-accepted={accepted}>{`${presses} / ${accepted}`}</span>} />
        <Readout label="announced" value={<span role="status" aria-live="polite" data-announce>{announce || "—"}</span>} />
      </div>
      <p className="mt-2 type-caption text-slate-500">The call site hands over the promise. Wrapping it in `void` would keep the button looking wired while the spinner, the disable and the guard all vanish.</p>
    </Region>
  );
}
