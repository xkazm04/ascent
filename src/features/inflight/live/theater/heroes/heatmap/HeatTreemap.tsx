"use client";

// THE MAP — one repo's explored code as module tiles holding file cells, painted by heat (heatStyle).
// Every change on it is a pulse fact: a cell brightens because a tail event touched that file, the
// tiles make room because a path nobody had named appeared, a ring leaves an edited cell because an
// edit arrived, a stamp sits on a module because a landing did. Between facts, the only change is the
// cooling, which is time since the touch against the frozen-when-stale clock.

import { motion } from "framer-motion";
import { LABEL_ROOM_PAD, fitModuleLabel, labelChars, layoutMap, type CellBox, type ModuleBox } from "./heatLayout";
import { baseName, moduleLabel } from "./heatModules";
import { StampBadge, StampMark, stampHeld } from "./HeatStamp";
import { HeatTrail, cursorOf, recentTouches } from "./HeatTrail";
import { BURN_RING_WINDOW_MS, MAX_BURN_RINGS, cellPaint, cellTextClass, fileTone, moduleHeat, modulePaint } from "./heatStyle";
import type { HeatStamp, RepoHeat } from "./heatTypes";
import type { BoxSize } from "./useBoxSize";

/** The cells whose edit is fresh enough to ring, newest first, capped by the motion budget. */
export function burningPaths(repo: RepoHeat, now: number): Set<string> {
  return new Set(
    repo.files
      .filter((f) => f.editAt != null && now - f.editAt >= 0 && now - f.editAt < BURN_RING_WINDOW_MS)
      .sort((a, b) => b.editAt! - a.editAt!)
      .slice(0, MAX_BURN_RINGS)
      .map((f) => f.path),
  );
}

/** The resting stamp badge's width in the label band, for the label-fit test — with its word, and
 *  compacted to the check alone when the folder's name needs that room. */
const BADGE_PX = 96;
const BADGE_TICK_PX = 46;
/** A mono glyph's width as a fraction of its type size (the label band is mono). */
const GLYPH = 0.62;
/** The burn ring grows a fixed distance outward whatever the cell's shape. */
const RING_GROW_PX = 10;

interface CellProps {
  cell: CellBox;
  origin: ModuleBox;
  now: number;
  reducedMotion: boolean;
  ring: boolean;
  cursor: boolean;
}

function Cell({ cell, origin, now, reducedMotion, ring, cursor }: CellProps) {
  const { file, rect, label } = cell;
  const tone = fileTone(file, now);
  return (
    <div
      data-file={file.path}
      data-tone={tone.kind}
      data-heat={tone.h.toFixed(2)}
      data-edited={file.edited || undefined}
      data-cursor={cursor || undefined}
      title={file.path}
      className="absolute flex items-end overflow-visible rounded-md border"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, ...cellPaint(file, now, reducedMotion) }}
    >
      {ring && !reducedMotion ? (
        <motion.span
          key={`${file.path}|${file.editAt}`}
          aria-hidden
          data-burn
          className="pointer-events-none absolute inset-0 rounded-md border-2 border-warn"
          initial={{ opacity: 0.9, scaleX: 1, scaleY: 1 }}
          animate={{ opacity: 0, scaleX: 1 + (2 * RING_GROW_PX) / Math.max(1, rect.w), scaleY: 1 + (2 * RING_GROW_PX) / Math.max(1, rect.h) }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      ) : null}
      {cursor ? <span aria-hidden className="pointer-events-none absolute inset-0 rounded-md ring-[3px] ring-white/90 ring-inset min-[2400px]:ring-[6px]" /> : null}
      {label ? (
        <span className={`relative w-full truncate px-2 pb-1 font-mono ${label} ${cursor ? "font-bold text-white" : cellTextClass(file, now)}`}>{baseName(file.path)}</span>
      ) : null}
      <span className="sr-only">{origin.module}</span>
    </div>
  );
}

interface TileProps {
  box: ModuleBox;
  stamp: HeatStamp | null;
  now: number;
  reducedMotion: boolean;
  rings: Set<string>;
  cursor: string | null;
}

function ModuleTile({ box, stamp, now, reducedMotion, rings, cursor }: TileProps) {
  const { rect, tier } = box;
  const { dim, name } = moduleLabel(box.module);
  const hot = moduleHeat(box.files, now);
  const held = stamp != null && stampHeld(stamp, now);
  // A resting badge takes room from the band. What gives way, in order: the badge's word, then the
  // label's dim prefix. Never the label's SIZE — it was the ceiling the cells were fitted under, and
  // a folder that shrinks to its files' size stops being the structure they sit in.
  const resting = stamp != null && !held;
  const roomFor = (badge: number) => rect.w - LABEL_ROOM_PAD - badge;
  const wideBadge = resting && roomFor(BADGE_PX) >= name.length * GLYPH * (box.label?.px ?? 0);
  const label = tier && resting ? fitModuleLabel(tier, labelChars(box.module), roomFor(wideBadge ? BADGE_PX : BADGE_TICK_PX), box.label?.px ?? tier.px) : box.label;
  return (
    <div
      data-module={box.module || "/"}
      className="absolute rounded-lg border-2 bg-surface-strong/60"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, ...modulePaint(box.files, now, reducedMotion) }}
    >
      {tier ? (
        <div className={`flex min-w-0 items-center gap-2 px-2.5 pt-1 font-mono ${label?.cls ?? tier.cls}`} style={{ height: tier.band }}>
          <span className="min-w-0 truncate" title={box.module || "repo root"}>
            {label?.full ? <span className="text-slate-500">{dim}</span> : null}
            <span className={hot > 0.3 ? "font-semibold text-white" : "text-slate-300"}>{name}</span>
          </span>
          {resting ? <StampBadge stamp={stamp} compact={!wideBadge} /> : null}
        </div>
      ) : null}
      {box.cells.map((c) => (
        <Cell key={c.file.path} cell={c} origin={box} now={now} reducedMotion={reducedMotion} ring={rings.has(c.file.path)} cursor={cursor === c.file.path} />
      ))}
      {held ? <StampMark stamp={stamp} now={now} reducedMotion={reducedMotion} big={rect.w > 260 && rect.h > 120} /> : null}
    </div>
  );
}

interface MapProps {
  repo: RepoHeat;
  size: BoxSize;
  now: number;
  reducedMotion: boolean;
  /** An agent session is in the files right now. Only then may the map claim a place: no cursor and
   *  no bright trail head while the build is being CHECKED — a verifying or committing lane is not
   *  touching that cell. The trail itself stays (those touches really happened) and fades by age. */
  live: boolean;
}

export function HeatTreemap({ repo, size, now, reducedMotion, live }: MapProps) {
  const boxes = layoutMap(repo.files, size.w, size.h);
  const rings = burningPaths(repo, now);
  const stamps = new Map(repo.stamps.map((s) => [s.module, s]));
  const touches = recentTouches(repo, now);
  const cursor = live ? cursorOf(touches, now) : null;
  return (
    <>
      {boxes.map((b) => (
        <ModuleTile key={b.module || "/"} box={b} stamp={stamps.get(b.module) ?? null} now={now} reducedMotion={reducedMotion} rings={rings} cursor={cursor} />
      ))}
      <HeatTrail boxes={boxes} touches={touches} now={now} reducedMotion={reducedMotion} live={live} w={size.w} h={size.h} />
    </>
  );
}
