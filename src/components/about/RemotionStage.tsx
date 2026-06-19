"use client";

// Shared wrapper for the /about Remotion diagrams: embeds a composition in the Player, plays it ONCE
// when scrolled into view (a beat, not a loop), holds the final frame when it ends (instead of
// rewinding), shows the final frame statically under reduced-motion, and offers a replay. The Player
// is mounted only after hydration (client-only) over a sized placeholder, so there's no SSR mismatch.

import { useEffect, useRef, type ReactNode } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useInView, useReducedMotion } from "framer-motion";
import { useMounted } from "@/components/report/chartMotion";

export function RemotionStage({
  component,
  durationInFrames,
  fps,
  width,
  height,
  legend,
}: {
  component: React.FC;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  legend?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerRef>(null);
  // No `once` — the deck snaps between full-viewport sections, so we replay every time this one is
  // entered and pause it when it's left (don't render frames off-screen).
  const inView = useInView(ref, { margin: "-120px" });
  const reduced = useReducedMotion();
  const mounted = useMounted();

  useEffect(() => {
    const player = playerRef.current;
    if (!mounted || !player) return;
    if (reduced) {
      player.seekTo(durationInFrames - 1);
    } else if (inView) {
      player.seekTo(0);
      player.play();
    } else {
      player.pause();
    }
  }, [inView, reduced, mounted, durationInFrames]);

  // Hold the final frame instead of rewinding to the start when playback ends. The re-entry guard is
  // essential: seeking to the last frame re-fires "ended", which would recurse infinitely.
  useEffect(() => {
    const player = playerRef.current;
    if (!mounted || !player) return;
    let holding = false;
    const hold = () => {
      if (holding) return;
      holding = true;
      player.seekTo(durationInFrames - 1);
      holding = false;
    };
    player.addEventListener("ended", hold);
    return () => player.removeEventListener("ended", hold);
  }, [mounted, durationInFrames]);

  return (
    <div ref={ref}>
      <div className="overflow-hidden rounded-xl border border-divider bg-surface-strong/40">
        {mounted ? (
          <Player
            ref={playerRef}
            component={component}
            durationInFrames={durationInFrames}
            fps={fps}
            compositionWidth={width}
            compositionHeight={height}
            style={{ width: "100%" }}
            loop={false}
            autoPlay={false}
            controls={false}
            clickToPlay={false}
            doubleClickToFullscreen={false}
            spaceKeyToPlayOrPause={false}
            acknowledgeRemotionLicense
          />
        ) : (
          <div className="aspect-video w-full" />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs text-slate-500">
        <span className="flex items-center gap-4">{legend}</span>
        <button
          type="button"
          onClick={() => {
            playerRef.current?.seekTo(0);
            playerRef.current?.play();
          }}
          className="focus-ring rounded-md px-2 py-1 uppercase tracking-wider transition hover:text-white"
        >
          ↻ replay
        </button>
      </div>
    </div>
  );
}
