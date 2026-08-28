"use client";

// Is this tab foregrounded? The single definition of the war room's poll gate.
//
// Four hooks in this group carried a byte-identical copy of the same six lines — useLoopRun.ts,
// useShipLoop.ts, liveWarRoomKiosk.ts and useTvRotation.ts — because the war room is the one place in
// the app where nearly every surface polls, and each poll must stop while the tab is hidden. A
// backgrounded TV wall or a cockpit left open on another monitor otherwise hammers its route forever,
// which is the cost this gate exists to avoid.
//
// It lives in this feature group rather than a shared lib on purpose: these four are its only callers,
// and src/features/<group>/<tab>/ is where a thing belongs until a SECOND group needs it. Promoting it
// early would put a war-room concern in everyone's import surface for no reader's benefit.
//
// Architect ADR 2026-08-28-client-fetch-primitives.

import { useEffect, useState } from "react";

/**
 * True while the document is foregrounded.
 *
 * Defaults to `true` so SSR and the first client render agree (there is no `document` on the server,
 * and a hook that started `false` would flash every gated surface off on hydration). The real value is
 * read on mount and re-read on every `visibilitychange`.
 */
export function useIsVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return visible;
}
