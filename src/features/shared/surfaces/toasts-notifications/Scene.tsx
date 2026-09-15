"use client";

// The toasts-notifications showcase: a fictional fleet desk whose out-of-band news flows through one
// store — a severity vocabulary that every channel derives from, a transient stack with queue policy,
// toasts that are doors, a durable center with the same identities, a simulated OS tier, and one
// announcer. Every technique of the registry subject is a region carrying `data-technique="<slug>"`;
// the frame spotlights the selected one. `reduced` and `volume` arrive as props (never a media query
// here): reduced starts the clock paused and strips travel from the stack; volume sizes the fleet
// the desk stands for. framer-motion enters through ToastStack/ToastCard only.

import type { SurfaceSceneProps } from "../surfaceBody";
import { ActionRegion } from "./ActionPanel";
import { AnnouncerRegion } from "./AnnouncerPanel";
import { EscalationRegion } from "./EscalationPanel";
import { FLEET_WINDOW, fleetFor } from "./fixtures";
import { LedgerRegion } from "./LedgerPanel";
import { SeverityRegion } from "./SeverityPanel";
import { StackRegion } from "./ToastStack";
import { useDesk } from "./useDesk";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  // Keyed on volume so a knob change re-seeds the desk instead of mutating a running one.
  return <Desk key={volume} reduced={reduced} volume={volume} />;
}

function Desk({ reduced, volume }: Pick<SurfaceSceneProps, "reduced" | "volume">) {
  const fleet = fleetFor(volume);
  const desk = useDesk(fleet, reduced);
  return (
    <div className="space-y-3" data-scene="toasts-notifications" data-reduced={reduced}>
      <p className="type-caption text-slate-500">
        Fixture data: a fleet of <span className="text-slate-300">{volume.toLocaleString()}</span> fictional repositories ({Math.min(FLEET_WINDOW, volume)} shown), seeded; every event is raised by a button. Nothing here is an Ascent org, and no notification leaves this page.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <SeverityRegion />
        <StackRegion desk={desk} reduced={reduced} fleet={fleet} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ActionRegion desk={desk} />
        <LedgerRegion desk={desk} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <EscalationRegion desk={desk} />
        <AnnouncerRegion desk={desk} />
      </div>
    </div>
  );
}
