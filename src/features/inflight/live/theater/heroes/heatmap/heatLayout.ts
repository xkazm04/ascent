// THE MAP'S GEOMETRY — modules as an ORDERED binary treemap, files as a grid inside each module.
//
// Order is first-seen (modules of one top-level folder kept together), never size: a squarified
// treemap re-sorts by weight and would shuffle the whole map every time one folder gains a file,
// which on a passive screen reads as the agent jumping around. An ordered binary split keeps a
// module roughly where it was when the map grows; the one reflow a new file causes is a real event.
// Pixel geometry (the container is measured) so label sizes can follow tile sizes — the same code
// reads at 1080p and 2160p because the tiles, not the viewport, choose the type.

import type { FileHeat } from "./heatTypes";
import { areaOf, moduleLabel } from "./heatModules";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Split `items` (in order) at their weight midpoint along the rect's longer side, recursively. */
export function binaryTreemap<T>(items: readonly { key: T; weight: number }[], r: Rect): { key: T; rect: Rect }[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ key: items[0]!.key, rect: r }];
  const total = items.reduce((s, i) => s + i.weight, 0);
  let acc = 0;
  let k = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < items.length; i++) {
    acc += items[i - 1]!.weight;
    const d = Math.abs(total / 2 - acc);
    if (d < best) [best, k] = [d, i];
  }
  const left = items.slice(0, k);
  const f = total > 0 ? left.reduce((s, i) => s + i.weight, 0) / total : 0.5;
  const [a, b]: [Rect, Rect] =
    r.w >= r.h
      ? [{ ...r, w: r.w * f }, { ...r, x: r.x + r.w * f, w: r.w * (1 - f) }]
      : [{ ...r, h: r.h * f }, { ...r, y: r.y + r.h * f, h: r.h * (1 - f) }];
  return [...binaryTreemap(left, a), ...binaryTreemap(items.slice(k), b)];
}

export interface ModuleGroup {
  module: string;
  files: FileHeat[];
}

/** Files → modules, ordered by their top-level folder's first sight, then the module's. */
export function groupModules(files: readonly FileHeat[]): ModuleGroup[] {
  const groups = new Map<string, ModuleGroup>();
  const areaFirst = new Map<string, number>();
  files.forEach((f, i) => {
    if (!groups.has(f.module)) groups.set(f.module, { module: f.module, files: [] });
    groups.get(f.module)!.files.push(f);
    const a = areaOf(f.module);
    if (!areaFirst.has(a)) areaFirst.set(a, i);
  });
  const first = (g: ModuleGroup) => files.indexOf(g.files[0]!);
  return [...groups.values()].sort((a, b) => areaFirst.get(areaOf(a.module))! - areaFirst.get(areaOf(b.module))! || first(a) - first(b));
}

// ── type follows the tile ─────────────────────────────────────────────────────────────────────────
// A label is sized to its tile — about an eighth of a module's height, a third of a cell's, never
// wider than its tile allows — then snapped DOWN to the type ladder, so the same map speaks at 21 px
// on a laptop and 49 px on a 2160p wall without a breakpoint.
export interface Tier {
  cls: string;
  /** The type size the class resolves to. */
  px: number;
  /** The label band's height in px, padding included. */
  band: number;
}
/** The ladder: the semantic type classes, then the hero-only raw sizes (globals.css permits 4xl–6xl). */
export const LADDER: readonly [px: number, cls: string][] = [
  [61, "text-6xl"],
  [49, "text-5xl"],
  [37, "text-4xl"],
  [31, "type-display"],
  [25, "type-heading"],
  [21, "type-title"],
  [15, "type-mono-sm"],
  [13, "type-caption"],
];
/** The largest ladder rung at or under `px`, or null under the floor. */
export function snap(px: number): [number, string] | null {
  return LADDER.find(([size]) => size <= px) ?? null;
}

export interface LabelFit {
  cls: string;
  /** The size the class resolves to — the size this module's cells must stay UNDER. */
  px: number;
  full: boolean;
}
/** The smallest a module label may shrink to keep its whole path (a narrower band drops the prefix). */
const FIT_FLOOR_PX = 21;
/** A module label that fits `room` px: the whole path at the tier's size, else the whole path a
 *  little smaller (never under `floorPx` or the tier), else only the bright last folder at full size.
 *  `floorPx` is how a caller that has already sized the module's CELLS forbids a shrink under them. */
export function fitModuleLabel(tier: Tier, chars: number, room: number, floorPx = FIT_FLOOR_PX): LabelFit {
  const fitPx = room / (chars * 0.62);
  if (fitPx >= tier.px) return { cls: tier.cls, px: tier.px, full: true };
  const smaller = snap(fitPx);
  return smaller && smaller[0] >= Math.min(tier.px, floorPx) ? { cls: smaller[1], px: smaller[0], full: true } : { cls: tier.cls, px: tier.px, full: false };
}
/** Characters a label is expected to hold, at ~0.62 em per mono glyph. */
const MODULE_CHARS = 13;
const CELL_CHARS = 12;
export function moduleTier(w: number, h: number): Tier | null {
  const hit = snap(Math.min(h * 0.12, w / (MODULE_CHARS * 0.62)));
  return hit ? { cls: hit[1], px: hit[0], band: Math.round(hit[0] * 1.3 + 10) } : null;
}
/** A file's label, never louder than one step under its module's (the module answers "where"). */
export function cellTier(w: number, h: number, maxPx = Number.POSITIVE_INFINITY): string | null {
  if (h < 22) return null;
  return snap(Math.min(h * 0.3, w / (CELL_CHARS * 0.62), maxPx))?.[1] ?? null;
}
/** The ladder step under `px` — the cap for a module's cells, so the folder is always the louder
 *  word. Under the ladder's bottom rung the cells say nothing at all (0): a file name level with its
 *  folder's turns the map into a list of file names, and the structure is what carries at 3 m. */
export function stepUnder(px: number | null): number {
  if (px == null) return 15;
  return LADDER.find(([size]) => size < px)?.[0] ?? 0;
}

export interface CellBox {
  file: FileHeat;
  rect: Rect;
  label: string | null;
}
export interface ModuleBox {
  module: string;
  files: FileHeat[];
  rect: Rect;
  tier: Tier | null;
  /** The label as it will actually be set — the size the cells were fitted under. */
  label: LabelFit | null;
  cells: CellBox[];
}

/** Cells in reading order; the column count keeps cells wide (file names are wide words). */
function cellGrid(files: readonly FileHeat[], r: Rect, gap: number, maxPx: number): CellBox[] {
  const n = files.length;
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * r.w) / Math.max(1, r.h) / 2.4)) || 1));
  const rows = Math.ceil(n / cols);
  const ch = (r.h - gap * (rows - 1)) / rows;
  return files.map((file, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols; // the last row stretches to the edge
    const cw = (r.w - gap * (inRow - 1)) / inRow;
    const rect = { x: r.x + (i % cols) * (cw + gap), y: r.y + row * (ch + gap), w: cw, h: ch };
    return { file, rect, label: cellTier(cw, ch, maxPx) };
  });
}

export const MODULE_GAP = 6;
export const CELL_GAP = 3;
const PAD = 4;
/** The label band's own padding — room the module's words do not get. */
export const LABEL_ROOM_PAD = 24;

/** Characters a module's label sets: the dim leading folders plus the bright last one. */
export function labelChars(module: string): number {
  const { dim, name } = moduleLabel(module);
  return dim.length + name.length;
}

/** The whole map in a `w`×`h` box. A module weighs its files plus one (its label band). */
export function layoutMap(files: readonly FileHeat[], w: number, h: number): ModuleBox[] {
  const groups = groupModules(files);
  const placed = binaryTreemap(
    groups.map((g) => ({ key: g, weight: g.files.length + 1 })),
    { x: 0, y: 0, w, h },
  );
  return placed.map(({ key: g, rect }) => {
    const r = { x: rect.x + MODULE_GAP / 2, y: rect.y + MODULE_GAP / 2, w: Math.max(0, rect.w - MODULE_GAP), h: Math.max(0, rect.h - MODULE_GAP) };
    const tier = moduleTier(r.w, r.h);
    // The label is fitted FIRST, because the size it settles at is the ceiling for its cells: a
    // module that had to shrink to hold its path must still out-speak the file names inside it.
    const label = tier ? fitModuleLabel(tier, labelChars(g.module), r.w - LABEL_ROOM_PAD) : null;
    const band = tier?.band ?? 0;
    const inner = { x: PAD, y: band + PAD, w: Math.max(0, r.w - 2 * PAD), h: Math.max(0, r.h - band - 2 * PAD) };
    return { module: g.module, files: g.files, rect: r, tier, label, cells: cellGrid(g.files, inner, CELL_GAP, stepUnder(label?.px ?? null)) };
  });
}
