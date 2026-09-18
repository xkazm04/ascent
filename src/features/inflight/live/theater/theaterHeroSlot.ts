// THE HERO SLOT — the one seam the prototype round plugs alternatives into.
//
// The shell renders `pickHero(id)` with `TheaterHeroProps` and knows nothing else about the hero, so a
// prototype adds ONE entry to `THEATER_HEROES` (and its own file) and is reachable at `?hero=<id>`
// without the shell, the header or the transport changing. The placeholder stays the default until a
// winner is chosen; an unknown id falls back to it rather than rendering nothing.
//
// The contract a hero honours:
//   - `pulse` is the last GOOD pulse, never null (the shell renders its own empty state instead);
//   - `now` is the clock to measure elapsed time against — frozen at the moment of last contact when
//     the pulse is stale, so a hero that derives every elapsed figure from it cannot pretend to move;
//   - `reducedMotion` true means every animation resolves to its end state (content-bearing motion
//     renders its final frame; decorative motion renders nothing).

import { createElement, type ComponentType, type ReactElement } from "react";
import type { LoopPulse } from "@/lib/local/runner-types";
import { TheaterHero } from "./TheaterHero";

export interface TheaterHeroProps {
  pulse: LoopPulse;
  now: number;
  reducedMotion: boolean;
}

export const THEATER_HEROES: Readonly<Record<string, ComponentType<TheaterHeroProps>>> = {
  placeholder: TheaterHero,
};

export const DEFAULT_HERO = "placeholder";

export function pickHero(id: string | null | undefined): ComponentType<TheaterHeroProps> {
  return (id && THEATER_HEROES[id]) || THEATER_HEROES[DEFAULT_HERO]!;
}

/** The slot's render: the chosen hero as an element. `createElement` over the registry (not a JSX tag
 *  bound in render) because every hero is a module-scope component the registry only LOOKS UP. */
export function renderHero(id: string | null | undefined, props: TheaterHeroProps): ReactElement {
  return createElement(pickHero(id), props);
}
