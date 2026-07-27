"use client";

// The Index — the editorial rating-instrument direction, laid out as a full-viewport scroll-snap
// deck (see IndexLanding). Masthead hero with the index ring, the org edition, the register gallery,
// the levels flight-path, and the dimension scorecard. Each content section reveals on entry (Reveal)
// for movement as you snap to it.

import type { LandingData } from "../types";
import { IndexHero } from "./IndexHero";
import { IndexOrg } from "./IndexOrg";
import { IndexFleet } from "./IndexFleet";
import { IndexGallery } from "./IndexGallery";
import { IndexLevels } from "./IndexLevels";
import { DimensionMatrix } from "./DimensionMatrix";
import { Reveal } from "@/components/deck/Reveal";

export function IndexVariant(props: LandingData) {
  return (
    <>
      <IndexHero {...props} />

      <div className="mx-auto w-full max-w-6xl px-5">
        <Reveal>
          <IndexOrg />
        </Reveal>
        <Reveal>
          <IndexFleet />
        </Reveal>
        {props.gallery && (
          <Reveal>
            <IndexGallery gallery={props.gallery} />
          </Reveal>
        )}
        <Reveal>
          <IndexLevels />
        </Reveal>
        <Reveal>
          <DimensionMatrix />
        </Reveal>
      </div>
    </>
  );
}
