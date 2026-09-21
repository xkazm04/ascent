// The cue cards — the wall's celebration card (LiveWarRoomCelebrations.tsx: the `animate-burst` card
// with its radiating `burst-ring`) for a landing or a finished direction, and a quieter amber card for
// something that needs a person. At most one new card per `CUE_GAP_MS` (theaterCues.ts), each gone
// after `CELEBRATION_MS`. Under reduced motion the card simply IS there — its words are the content.

import type { TheaterCue } from "./theaterCues";

export function TheaterCueCards({ cards, reducedMotion }: { cards: readonly TheaterCue[]; reducedMotion: boolean }) {
  if (cards.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-20 right-6 z-50 flex max-w-md flex-col gap-2" aria-live="polite">
      {cards.map((c) =>
        c.kind === "celebrate" ? (
          <div
            key={c.id}
            data-cue={c.kind}
            className={`relative overflow-hidden rounded-xl border border-success/40 bg-success/10 px-5 py-4 shadow-lg shadow-success/10 backdrop-blur ${reducedMotion ? "" : "animate-burst"}`}
          >
            {reducedMotion ? null : <span aria-hidden className="burst-ring absolute -left-2 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-success/40" />}
            <div className="relative flex items-center gap-3">
              <span className="type-heading" aria-hidden>
                🎉
              </span>
              <div className="min-w-0">
                <div className="type-mono-sm uppercase tracking-widest text-success-soft">Landed</div>
                <div className="type-title font-semibold text-white">{c.headline}</div>
              </div>
            </div>
          </div>
        ) : (
          <div
            key={c.id}
            data-cue={c.kind}
            className={`rounded-xl border border-amber-400/50 bg-amber-500/10 px-5 py-4 shadow-lg backdrop-blur ${reducedMotion ? "" : "animate-pop-in"}`}
          >
            <div className="type-mono-sm uppercase tracking-widest text-amber-300">Needs you</div>
            <div className="type-title font-semibold text-white">{c.headline}</div>
            {c.detail ? <div className="type-body text-slate-300">{c.detail}</div> : null}
          </div>
        ),
      )}
    </div>
  );
}
