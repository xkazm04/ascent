"use client";

// The table showcase: one fictional fleet ledger a viewer can use for a minute — filter, sort by a
// header, page, tick rows, refresh, break it on purpose — composed of five regions, each carrying
// `data-technique="<slug>"` for the frame to spotlight: the toolbar (client-server-split), the ledger
// (loading-and-empty-states), the footer (pagination), and two instruments that read the same live
// state (sorting, performance). `reduced` and `volume` come from props, never a media query; the
// ghost delay survives reduction because it is anti-flash, not decoration. No framer-motion: CSS
// keyframes in one <style> are enough for a ghost and a rise.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import type { SurfaceSceneProps } from "../surfaceBody";
import { FooterRegion } from "./LedgerFooter";
import { LedgerRegion } from "./LedgerTable";
import { PerfRegion } from "./PerfInstrument";
import { SCENE_KEYFRAMES } from "./sceneParts";
import { SortRegion } from "./SortInstrument";
import { SplitRegion } from "./SplitToolbar";
import { useLedger } from "./useLedger";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  return (
    <div className="space-y-3" data-scene="table" data-reduced={reduced}>
      <style>{SCENE_KEYFRAMES}</style>
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional repositories, seeded; the fleet store answers after a simulated 650ms. Nothing here is an Ascent org.
      </p>
      {/* Keyed on volume: a new fleet is a new surface with its own first arrival, seen-set and bet. */}
      <Ledger key={volume} reduced={reduced} volume={volume} />
    </div>
  );
}

function Ledger({ reduced, volume }: { reduced: boolean; volume: SurfaceVolume }) {
  const l = useLedger(volume);
  return (
    <>
      <SplitRegion l={l} volume={volume} />
      <LedgerRegion l={l} reduced={reduced} />
      <FooterRegion l={l} />
      <div className="grid gap-3 lg:grid-cols-2">
        <SortRegion l={l} />
        <PerfRegion l={l} volume={volume} />
      </div>
    </>
  );
}
