"use client";

// The accessibility showcase: a fleet follow-ups desk that stays operable with the screen off and the
// pointer unplugged. Every technique of the registry's `accessibility` subject is a region carrying
// `data-technique="<slug>"` (the frame spotlights the selected one). The Scene owns what the doctrine
// says is owned once: the ONE announcer every region calls (live-region-architecture) and the ONE
// preference signal every region derives from (preference-respect). `reduced` and `volume` arrive as
// props — no media query in here. No framer-motion: the only motion is the drawer's CSS transition,
// keyed off the prop. Fixtures are seeded fiction and the first line says so.

import { useRef, useState } from "react";
import type { SurfaceSceneProps } from "../surfaceBody";
import { useAnnouncer } from "./a11yHooks";
import { AnnouncerRegion } from "./AnnouncerRegion";
import { DrawerRegion } from "./DrawerRegion";
import { rowsFor, WINDOW, type Row } from "./fixtures";
import { FormRegion } from "./FormRegion";
import { GatesRegion } from "./GatesRegion";
import { PairingsRegion } from "./PairingsRegion";
import { PreferenceRegion } from "./PreferenceRegion";
import type { PrefSignal, TextScale } from "./signal";
import { StripRegion } from "./StripRegion";
import { WorklistRegion } from "./WorklistRegion";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const announcer = useAnnouncer();
  const [scale, setScale] = useState<TextScale>(100);
  const [forced, setForced] = useState(false);
  const [segment, setSegment] = useState("all");
  // The volume knob sizes the identity set; the desk shows a window of it. A volume change resets the
  // rows (adjust-state-during-render), so a resized fixture never keeps a deleted row's ghost.
  const [rows, setRows] = useState<Row[]>(() => rowsFor(volume));
  const [prevVolume, setPrevVolume] = useState(volume);
  if (prevVolume !== volume) {
    setPrevVolume(volume);
    setRows(rowsFor(volume));
  }
  const visible = (segment === "all" ? rows : rows.filter((r) => r.segment === segment)).slice(0, WINDOW);
  const signal: PrefSignal = { reduced, scale, forced };

  return (
    <div
      ref={rootRef}
      data-scene="accessibility"
      data-reduced={reduced}
      data-scale={scale}
      data-forced={forced}
      className="space-y-3"
      // The signal, honored at the root: text scale reflows the whole desk; forced colors flattens the
      // palette so the viewer sees which meanings survive on structure alone.
      style={{ zoom: scale / 100, filter: forced ? "grayscale(1) contrast(1.15)" : undefined }}
    >
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional follow-ups, seeded; the desk shows {visible.length}. Nothing here is an Ascent org.
      </p>
      <PreferenceRegion signal={signal} onScale={setScale} onForced={setForced} />
      <StripRegion selected={segment} onSelect={setSegment} />
      <WorklistRegion
        rows={visible}
        onDelete={(id) => setRows((rs) => rs.filter((r) => r.id !== id))}
        onResolve={(id) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: "done" } : r)))}
        announce={announcer.announce}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <DrawerRegion reduced={reduced} row={visible[0] ?? null} />
        <AnnouncerRegion announcer={announcer} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <FormRegion rowId={visible[0]?.id ?? "fu-0"} announce={announcer.announce} />
        <GatesRegion rootRef={rootRef} />
      </div>
      <PairingsRegion />
    </div>
  );
}
