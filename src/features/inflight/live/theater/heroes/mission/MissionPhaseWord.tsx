"use client";

// THE PHASE WORD — the one thing a glance from across the room must catch: "Reading the code",
// "Editing", "Checking the build", "Still working", "Landed". It swaps with a short vertical slide only
// when the lane's phase changes (keyed by the phase, not by a ticking quiet duration): the old word
// leaves first, a step faster, then the new one enters decelerating — two 100-px words never overlap.
// The first render and reduced motion show it still.

import { AnimatePresence, motion } from "framer-motion";
import type { LaneTone } from "./missionModel";
import { EASE_ENTER, EASE_EXIT, fs, PHASE_ENTER_S, PHASE_EXIT_S, TYPE } from "./missionTokens";

const WORD: Record<LaneTone, string> = {
  working: "text-white",
  quiet: "text-slate-400",
  landed: "text-success-soft",
  held: "text-amber-300",
  failed: "text-danger",
  done: "text-slate-300",
};

export function MissionPhaseWord({
  phaseKey,
  word,
  sub,
  tone,
  scale,
  reducedMotion,
}: {
  phaseKey: string;
  word: string;
  sub: string | null;
  tone: LaneTone;
  scale: number;
  reducedMotion: boolean;
}) {
  const body = (
    <>
      <span data-phase-word className={`block truncate font-semibold leading-[1.05] tracking-tight ${WORD[tone]}`} style={fs(TYPE.phase, scale)}>
        {word}
      </span>
      {sub ? (
        <span className={`mt-[0.2em] block truncate ${tone === "landed" ? "text-success-soft/80" : "text-slate-400"}`} style={fs(TYPE.meta, scale)}>
          {sub}
        </span>
      ) : null}
    </>
  );
  if (reducedMotion) return <div className="min-w-0">{body}</div>;
  return (
    <div className="relative min-w-0 overflow-hidden">
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={phaseKey}
          className="min-w-0"
          initial={{ y: "45%", opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: PHASE_ENTER_S, ease: EASE_ENTER } }}
          exit={{ y: "-45%", opacity: 0, transition: { duration: PHASE_EXIT_S, ease: EASE_EXIT } }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
