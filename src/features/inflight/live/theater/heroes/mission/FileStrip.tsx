"use client";

// THE LIVE FILE STRIP — every file the lane touched since this screen opened, newest first: a READ is a
// cool azure chip, an EDIT a warm amber one. A chip slides in from the strip's newest edge the moment
// the file first appears in a pulse (entrance, once per identity — `live` from the accumulator); an
// edit of a file first read re-enters at the front, warm. Older chips fade toward the far edge and
// drop out past `STRIP_VISIBLE`. Each chip's brightness is its freshness — the age of the newest event
// that touched it against `now` — so a silent lane visibly cools. Nothing moves without an event.

import { AnimatePresence, motion } from "framer-motion";
import type { ChipRec } from "./missionAccumulate";
import { decay, splitPath } from "./missionModel";
import { CHIP_ENTER_S, CHIP_EXIT_S, CHIP_FADE_S, CHIP_LAYOUT_S, CHIP_TRAVEL_PX, EASE_ENTER, fs, STRIP_FADE, TYPE } from "./missionTokens";

const KIND = {
  read: { box: "border-accent/45 bg-accent/15", ring: "ring-2 ring-accent/60", name: "text-accent-soft", tag: "text-accent/80", label: "read" },
  edit: { box: "border-amber-400/55 bg-amber-400/15", ring: "ring-2 ring-amber-300/70", name: "text-amber-100", tag: "text-amber-300", label: "edit" },
} as const;

function chipOpacity(index: number, chip: ChipRec, now: number, quiet: boolean): number {
  const place = STRIP_FADE[index] ?? STRIP_FADE[STRIP_FADE.length - 1]!;
  // A chip at rest sits at 70 %; a fresh touch lifts it to full. A quiet lane rests everything.
  const fresh = quiet ? 0 : decay(chip.lastAt, now);
  return place * (0.7 + 0.3 * fresh);
}

export function FileStrip({
  repo,
  chips,
  now,
  quiet,
  scale,
  reducedMotion,
}: {
  repo: string;
  chips: readonly ChipRec[];
  now: number;
  quiet: boolean;
  scale: number;
  reducedMotion: boolean;
}) {
  return (
    <ol
      aria-label={`Files ${repo} touched, newest first`}
      className="flex min-w-0 items-stretch gap-[0.5em] overflow-hidden [mask-image:linear-gradient(to_right,black_78%,transparent)]"
      style={fs(TYPE.chip, scale)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {chips.map((chip, i) => {
          const k = KIND[chip.kind];
          const { dir, name } = splitPath(chip.path);
          const fresh = !quiet && decay(chip.lastAt, now) > 0.85;
          return (
            <motion.li
              key={chip.path}
              layout={reducedMotion ? false : "position"}
              data-chip={chip.path}
              data-kind={chip.kind}
              title={chip.path}
              className={`flex max-w-[16em] shrink-0 flex-col justify-center rounded-lg border px-[0.7em] py-[0.35em] leading-tight ${reducedMotion ? "" : "transition-colors duration-500"} ${k.box} ${
                fresh ? k.ring : ""
              }`}
              initial={reducedMotion || !chip.live ? false : { opacity: 0, x: -CHIP_TRAVEL_PX }}
              animate={{ opacity: chipOpacity(i, chip, now, quiet), x: 0 }}
              exit={reducedMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: { duration: CHIP_EXIT_S } }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { x: { duration: CHIP_ENTER_S, ease: EASE_ENTER }, opacity: { duration: CHIP_FADE_S, ease: "easeOut" }, layout: { duration: CHIP_LAYOUT_S, ease: EASE_ENTER } }
              }
            >
              <span className="flex items-baseline gap-[0.5em]">
                <span className={`font-mono uppercase tracking-[0.14em] ${k.tag}`} style={{ fontSize: "0.62em" }}>
                  {k.label}
                </span>
                <span className="truncate font-mono text-slate-500" style={{ fontSize: "0.72em" }}>
                  {dir}
                </span>
              </span>
              <span className={`truncate font-mono font-semibold ${k.name}`}>{name}</span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
