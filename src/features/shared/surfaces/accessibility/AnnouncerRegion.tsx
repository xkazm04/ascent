"use client";

// live-region-architecture: the desk's ONE announcer, on display. Two visually-hidden regions — polite
// (`role="status"`) and assertive (`role="alert"`) — are rendered from the scene's FIRST render, so
// they exist before any news; every write is a keyed remount (a fresh node per utterance), so an
// identical repeat is a genuine mutation; the drain serializes a burst one utterance per tick. The
// visible transcript mirrors what the regions received, in order, with the politeness that carried it.

import type { Announcer } from "./a11yHooks";
import { DRAIN_SPACING_MS, QUEUE_BOUND } from "./a11yHooks";
import { BTN, Readout, Region } from "./sceneParts";

export function AnnouncerRegion({ announcer }: { announcer: Announcer }) {
  const { announce, queue, live, log, shed, voiced } = announcer;
  const last = log[log.length - 1];
  return (
    <Region technique="live-region-architecture" title="Announcements are engineered" note="One provider, two homes, a drain queue, a keyed remount. Silence is the failure mode; this is what prevents it.">
      {/* The regions: mounted with the scene, empty until the first drain, never re-created. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-live-polite>
        {live.polite ? <span key={live.polite.id}>{live.polite.text}</span> : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" data-live-assertive>
        {live.assertive ? <span key={live.assertive.id}>{live.assertive.text}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => announce("Follow-up resolved.")}>
          polite: resolved
        </button>
        <button type="button" className={BTN} onClick={() => [1, 2, 3].forEach((n) => announce(`Scan ${n} of 3 finished.`))}>
          burst x3
        </button>
        <button type="button" className={BTN} disabled={!last} onClick={() => last && announce(last.text, last.politeness)}>
          repeat last
        </button>
        <button type="button" className={BTN} onClick={() => announce("Save failed. Title is required.", "assertive")}>
          assertive: save failed
        </button>
      </div>

      <ol className="mt-3 min-h-[5rem] space-y-1" aria-label="Transcript" data-transcript>
        {log.length === 0 ? <li className="type-caption text-slate-600">nothing voiced yet — the regions are already mounted, empty</li> : null}
        {log.map((u) => (
          <li key={u.id} className="flex items-baseline gap-2 type-caption" data-utterance={u.id}>
            <span className={u.politeness === "assertive" ? "text-warn" : "text-slate-500"}>{u.politeness}</span>
            <span className="text-slate-300">{u.text}</span>
            <span className="text-slate-600">#{u.id}</span>
          </li>
        ))}
      </ol>

      <div className="mt-2 space-y-1">
        <Readout label="queued / voiced / shed" value={<span data-queued={queue.length} data-voiced={voiced}>{`${queue.length} / ${voiced} / ${shed}`}</span>} />
        <Readout label="drain" value={`1 per ${DRAIN_SPACING_MS}ms · bound ${QUEUE_BOUND}`} />
      </div>
      <p className="mt-2 type-caption text-slate-500">Announce on events, never from renders. Assertive jumps the polite backlog and does not erase it. Every drain timer is cleared by the effect that made it.</p>
    </Region>
  );
}
