"use client";

// The search showcase: a fleet search over a fictional corpus of repositories — one text box that is
// honestly three intents (search, filter, navigate), each technique of the registry's `search` subject
// a region carrying `data-technique="<slug>"` (the frame spotlights the selected one). Everything is
// synchronous and local, so nothing here animates: `reduced` is accepted and threaded for the
// contract (the scene has no motion to reduce); `volume` sizes the corpus, and the window stays a page.

import type { SurfaceSceneProps } from "../surfaceBody";
import { FacetPanel } from "./FacetPanel";
import { IndexPanel } from "./IndexPanel";
import { PalettePanel } from "./PalettePanel";
import { ResultsPanel } from "./ResultsPanel";
import { RulesPanel } from "./RulesPanel";
import { SearchBox } from "./SearchBox";
import { ViewsPanel } from "./ViewsPanel";
import { BTN } from "./sceneParts";
import { useFleetSearch } from "./useFleetSearch";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  // Remounted per volume by the key below, so a new corpus is a new surface rather than a hand-reset.
  return <FleetScene key={volume} reduced={reduced} volume={volume} />;
}

function FleetScene({ reduced, volume }: Pick<SurfaceSceneProps, "reduced" | "volume">) {
  const s = useFleetSearch(volume);
  return (
    <div className="space-y-3" data-scene="search" data-reduced={reduced}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="type-caption text-slate-500">
          Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional repositories, seeded. Nothing here is an Ascent org.
        </p>
        <div className="flex flex-wrap items-center gap-1.5" data-action-strip aria-label="Actions">
          {s.commands.map((c) => (
            <button key={c.id} type="button" className={BTN} onClick={c.run}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <SearchBox s={s} />
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <ResultsPanel s={s} />
        <FacetPanel s={s} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <IndexPanel s={s} />
        <ViewsPanel s={s} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <PalettePanel s={s} />
        <RulesPanel s={s} />
      </div>
    </div>
  );
}
