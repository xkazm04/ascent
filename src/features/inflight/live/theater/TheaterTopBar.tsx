"use client";

// The theater's only chrome: a dateline (whose runner, and whether this is live, a kiosk or the demo)
// and the controls — "Enter theater mode", sound, and on a signed-in theater the notifier and kiosk
// link. In theater mode (fullscreen) the controls step aside and only the dateline stays: the screen
// is for reading from across the room, and Esc — the browser's own exit — brings them back.
//
// Theater mode reuses the wall's kit (liveWakeLock.ts): fullscreen the page (which IS the theater — it
// has no other chrome) and hold a screen wake lock, re-acquired when the tab returns and released when
// fullscreen ends or the page unmounts.

import { useEffect, useState } from "react";
import { Kicker, chipButtonClass } from "@/components/ui";
import { enterTvMode, releaseWakeLock } from "../liveWakeLock";
import { TheaterOrgControls } from "./TheaterOrgControls";
import { SOUND_TOGGLE_ATTR, type SoundMode } from "./useTheaterSound";

export type TheaterMode = "org" | "kiosk" | "demo";

const SOUND_LABEL: Record<SoundMode, string> = {
  off: "Sound off",
  armed: "Sound: click anywhere to turn it on",
  on: "Sound on",
};

function useFullscreen(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      releaseWakeLock();
    };
  }, []);
  return full;
}

export function TheaterTopBar({
  slug,
  mode,
  note,
  sound,
  onToggleSound,
}: {
  slug: string;
  mode: TheaterMode;
  /** A qualifier beside the org name — "demo · fixture data", "kiosk · read-only". */
  note: string | null;
  sound: SoundMode;
  onToggleSound: () => void;
}) {
  const full = useFullscreen();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-6 py-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <Kicker>Ascent · Theater</Kicker>
        <span className="truncate type-title font-semibold text-white">{slug}</span>
        {note ? <span className="type-label tracking-[0.22em] text-amber-300">{note}</span> : null}
      </div>
      {full ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void enterTvMode()} className={chipButtonClass("idle")}>
            Enter theater mode
          </button>
          <button
            type="button"
            {...{ [SOUND_TOGGLE_ATTR]: "" }}
            onClick={onToggleSound}
            aria-pressed={sound === "on"}
            className={chipButtonClass(sound === "on" ? "success" : "idle", sound === "armed" ? "border-amber-400/60 text-amber-200" : "")}
          >
            {SOUND_LABEL[sound]}
          </button>
          {mode === "org" ? <TheaterOrgControls slug={slug} /> : null}
        </div>
      )}
    </div>
  );
}
