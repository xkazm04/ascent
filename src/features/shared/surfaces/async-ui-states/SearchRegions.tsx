"use client";

// The owner of the repository search: one hook, four regions reading it. Remounted by the scene per
// volume (`key={volume}`), so a new universe is a new surface rather than a hand-reset of the state.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import type { Latency } from "./asyncState";
import { ArrivalRegion, KeysRegion, LedgerRegion } from "./InstrumentPanels";
import { ListRegion } from "./ListPanel";
import { useRepoSearch } from "./useRepoSearch";

export function SearchRegions({ volume, reduced, latency, setLatency }: { volume: SurfaceVolume; reduced: boolean; latency: Latency; setLatency: (l: Latency) => void }) {
  const s = useRepoSearch(volume, latency);
  return (
    <>
      <ListRegion s={s} reduced={reduced} latency={latency} setLatency={setLatency} />
      <div className="grid gap-3 lg:grid-cols-3">
        <LedgerRegion s={s} />
        <KeysRegion s={s} />
        <ArrivalRegion s={s} reduced={reduced} />
      </div>
    </>
  );
}
