"use client";

// THE FOOTER — the honesty label (what this screen is fed by: live, a kiosk, or the demo fixture),
// the one sentence every bar on the wall owes ("time used and money used, never work done"), and the
// wall's two controls: sound (the theater's opt-in, armed until a gesture) and full screen (the
// classic theater's kit: `enterTvMode` + wake lock, released when fullscreen ends or the page closes).
// In full screen the controls step aside; F enters it from the keyboard.

import { useEffect, useState } from "react";
import { enterTvMode, releaseWakeLock } from "../../liveWakeLock";
import type { TheaterSource } from "../TheaterShell";
import { SOUND_TOGGLE_ATTR, type SoundMode } from "../useTheaterSound";
import styles from "./onairWall.module.css";

const SOUND_LABEL: Record<SoundMode, string> = { off: "Sound off", armed: "Sound: click anywhere to turn it on", on: "Sound on" };

function useFullscreen(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement));
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "f" && e.key !== "F")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!document.fullscreenElement) void enterTvMode();
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("keydown", onKey);
      releaseWakeLock();
    };
  }, []);
  return full;
}

function Label({ source }: { source: TheaterSource }) {
  if (source.kind === "demo") {
    return (
      <>
        <b>demo · fixture data</b>
        {source.scenario === "running" ? "" : ` · ${source.scenario}`} · simulated clock · {source.slug}
      </>
    );
  }
  if (source.kind === "kiosk") {
    return (
      <>
        <b>kiosk · read-only</b> · {source.slug} · agent prose withheld
      </>
    );
  }
  return (
    <>
      <b>Live</b> · {source.slug} · <span className={styles.fr}>pulse every 2 s</span>
    </>
  );
}

export function OnAirFooter({ source, sound, onToggleSound }: { source: TheaterSource; sound: SoundMode; onToggleSound: () => void }) {
  const full = useFullscreen();
  return (
    <footer className={styles.foot}>
      <div className={styles.label} data-role="onair-label">
        <Label source={source} />
      </div>
      <div className={styles.rt}>bars show time used and money used, never work done</div>
      {full ? null : (
        <>
          <button
            type="button"
            className={styles.ctl}
            {...{ [SOUND_TOGGLE_ATTR]: "" }}
            onClick={onToggleSound}
            aria-pressed={sound === "on"}
            data-on={sound === "on" ? "" : undefined}
            data-armed={sound === "armed" ? "" : undefined}
          >
            {SOUND_LABEL[sound]}
          </button>
          <button type="button" className={styles.ctl} onClick={() => void enterTvMode()} title="Full screen, and keep the screen awake (F)">
            Full screen
          </button>
        </>
      )}
    </footer>
  );
}
