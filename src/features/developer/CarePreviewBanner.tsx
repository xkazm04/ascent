"use client";

// The preview stamp that survives a scroll.
//
// While a fixture is showing, the masthead carries a small `CareFixtureChip` — and that is the whole
// stamp. Scroll one screen past it and 412 commits on `acme/*` repos, rendered under the viewer's own
// real login, read as the viewer's own activity. The honesty contract of this page (nothing in the
// care half is fabricated) depends on the reader never being able to lose track of which half they
// are looking at, so the stamp is STICKY: it stays on screen for as long as the sample data does, and
// it carries the way back out of it.
//
// Brand: kicker + hairline, warn-toned like the chip it extends, no new chrome. `animate-fade-up` is
// already disabled under `prefers-reduced-motion` in globals.css.

import { Kicker } from "@/components/ui";

export function CarePreviewBanner({ name, onExit }: { name: string; onExit: () => void }) {
  return (
    <div
      role="status"
      className="animate-fade-up sticky top-16 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-warn/40 bg-ink/85 px-4 py-2.5 backdrop-blur"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Kicker tone="muted" className="text-warn">
          Sample data
        </Kicker>
        <span className="type-body-sm text-slate-300">
          Not your activity — the <span className="font-mono text-slate-200">{name}</span> preview.
        </span>
      </div>
      <button
        type="button"
        onClick={onExit}
        className="focus-ring rounded type-body-sm text-accent underline decoration-dotted underline-offset-4 transition-colors hover:text-white"
      >
        Back to your view
      </button>
    </div>
  );
}
