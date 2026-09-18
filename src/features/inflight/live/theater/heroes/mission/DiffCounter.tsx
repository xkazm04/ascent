"use client";

// THE DIFF COUNTER — the lane's worktree diff (+ lines, − lines, files) as the engine last measured it.
// A figure ROLLS to its new value only when the measurement changed (a real event: the engine re-read
// the worktree and it differs); the first render and an unchanged pulse show it still. Content-bearing
// degradation: under reduced motion the true value simply replaces the old — never a count-up from 0.

import { AnimatePresence, motion } from "framer-motion";
import { EASE_ENTER, EASE_EXIT, fs, TICK_S, TYPE } from "./missionTokens";

function Tick({ value, reducedMotion }: { value: string; reducedMotion: boolean }) {
  if (reducedMotion) return <span className="tabular-nums">{value}</span>;
  return (
    <span className="relative inline-grid overflow-hidden align-bottom tabular-nums">
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          className="[grid-area:1/1]"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: TICK_S, ease: EASE_ENTER } }}
          exit={{ y: "-100%", opacity: 0, transition: { duration: TICK_S * 0.7, ease: EASE_EXIT } }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function DiffCounter({
  diff,
  scale,
  dim,
  reducedMotion,
}: {
  diff: { files: number; plus: number; minus: number } | null;
  scale: number;
  dim: boolean;
  reducedMotion: boolean;
}) {
  if (!diff) {
    return (
      <div className="flex flex-col items-end gap-1 text-right">
        <span className="font-mono text-slate-600" style={fs(TYPE.diff, scale)}>
          ±0
        </span>
        <span className="font-mono uppercase tracking-[0.2em] text-slate-500" style={fs(TYPE.label, scale)}>
          no diff yet
        </span>
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-end gap-1 text-right ${dim ? "opacity-60" : ""}`} aria-label={`+${diff.plus} −${diff.minus} in ${diff.files} files`}>
      <span className="flex items-baseline gap-[0.4em] font-mono font-semibold leading-none" style={fs(TYPE.diff, scale)}>
        <span className="text-success-soft">
          +<Tick value={String(diff.plus)} reducedMotion={reducedMotion} />
        </span>
        <span className="text-danger">
          −<Tick value={String(diff.minus)} reducedMotion={reducedMotion} />
        </span>
      </span>
      <span className="font-mono uppercase tracking-[0.2em] text-slate-400" style={fs(TYPE.label, scale)}>
        <Tick value={String(diff.files)} reducedMotion={reducedMotion} /> {diff.files === 1 ? "file" : "files"} changed
      </span>
    </div>
  );
}
