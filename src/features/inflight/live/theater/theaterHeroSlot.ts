// THE HERO SLOT — what fills the theater between the four-question header and the latest rail.
//
// The shell renders `pickHero(id)` with `TheaterHeroProps` and knows nothing else about the hero, so a
// hero is one entry in `THEATER_HEROES` plus its own folder, reachable at `?hero=<id>`; an unknown id
// falls back to the default rather than rendering nothing. The seam earned itself on 2026-09-18, when
// three heroes (mission · heatmap · observatory) were built against it in parallel and judged from live
// renders — the shell, the header and the transport did not change for any of them. MISSION WON; the
// other two were deleted with their tests rather than kept as dead alternatives.
//
// The contract a hero honours:
//   - `pulse` is the last GOOD pulse, never null (the shell renders its own empty state instead);
//   - `now` is the clock to measure elapsed time against — frozen at the moment of last contact when
//     the pulse is stale, so a hero that derives every elapsed figure from it cannot pretend to move;
//   - `reducedMotion` true means every animation resolves to its end state (content-bearing motion
//     renders its final frame; decorative motion renders nothing);
//   - the pulse is a bounded WINDOW (8 files, 6 events), so a hero that wants a session's whole picture
//     accumulates it across pulses in its own state and SAYS on screen what it has actually seen.

import { createElement, type ComponentType, type ReactElement } from "react";
import type { LoopPulse } from "@/lib/local/runner-types";
import { MissionHero } from "./heroes/MissionHero";

export interface TheaterHeroProps {
  pulse: LoopPulse;
  now: number;
  reducedMotion: boolean;
}

export const THEATER_HEROES: Readonly<Record<string, ComponentType<TheaterHeroProps>>> = {
  mission: MissionHero,
};

export const DEFAULT_HERO = "mission";

export function pickHero(id: string | null | undefined): ComponentType<TheaterHeroProps> {
  return (id && THEATER_HEROES[id]) || THEATER_HEROES[DEFAULT_HERO]!;
}

/** The slot's render: the chosen hero as an element. `createElement` over the registry (not a JSX tag
 *  bound in render) because every hero is a module-scope component the registry only LOOKS UP. */
export function renderHero(id: string | null | undefined, props: TheaterHeroProps): ReactElement {
  return createElement(pickHero(id), props);
}
