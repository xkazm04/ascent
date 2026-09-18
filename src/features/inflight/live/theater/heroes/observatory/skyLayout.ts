// WHERE EVERYTHING SITS — seats on the rings and the labels beside them. Pure.
//
// Ring 0 (at work) is laid out for READING, not scatter: its bodies take seats on the ring's left and
// right ends (ordered by a stable hash of the repo name) so every big label has the open sky beside it
// and never sits on the core. Rings 1–2 seat each body at the angle its name hashes to, spread to a
// minimum separation, then nudged off any big label — a seat carries no meaning, only stability.
// Labels are placed greedily: the big ones first (swept apart vertically, with a leader line when
// pushed off their body), then the small ones wherever they fit; a small label that fits nowhere is
// dropped from the SKY (the text alternative and the narration still say it).

import type { SkyBody, SkyModel, SkyRing } from "./skyModel";
import { hash01, inside, overlaps, pointOn, type Box, type Pt, type SkyFrame } from "./skyEllipse";
import { RING_MIN_SEP } from "./skyConstants";

export interface Seat {
  ring: SkyRing;
  deg: number;
}

export interface PlacedLabel {
  repo: string;
  box: Box;
  anchor: "start" | "end" | "middle";
  /** The body point, when the label was pushed far enough off it to need a leader line. */
  lead: Pt | null;
  /** A small label that only had room for the name. */
  nameOnly: boolean;
}

/** Big-label type, in user units — the brand scale's display-lg / display / heading / mono-sm. The
 *  box is a FIXED size (the widest a label may render), never measured from its text: a label that
 *  grew by a second ("for 9 s" → "for 10 s") must not nudge another body into a glide. */
export const PRIMARY = { name: 37, phase: 31, file: 25, small: 15, baselines: [33, 73, 108, 135], h: 146, w: 420 } as const;
const GAP_X = 38;
const SWEEP_GAP = 14;
/** How far an outer-ring body keeps from a big label or the core's words. */
const AVOID_PAD = 34;
const FILE_CHARS = 27;

/** A path that fits the label: the END is what identifies a file, so trim from the front at a "/". */
export function fitPath(path: string, max = FILE_CHARS): string {
  if (path.length <= max) return path;
  const tail = path.slice(-(max - 1));
  const cut = tail.indexOf("/");
  return `…${cut >= 0 && cut < tail.length - 8 ? tail.slice(cut) : tail}`;
}

export function primaryLines(b: SkyBody): { small: string } {
  return { small: [b.inPhase, b.diff].filter(Boolean).join(" · ") };
}

/** Seats on ring 0: split by hash order between the right and left ends, spread top → bottom. */
function atWorkSeats(bodies: readonly SkyBody[]): Map<string, number> {
  const sorted = [...bodies].sort((a, b) => hash01(a.repo) - hash01(b.repo));
  const right = sorted.slice(0, Math.ceil(sorted.length / 2));
  const left = sorted.slice(right.length);
  const out = new Map<string, number>();
  const spread = (side: SkyBody[], mirror: boolean) => {
    const k = side.length;
    const span = k <= 1 ? 0 : Math.min(62, 21 * k);
    side.forEach((b, i) => {
      const deg = k <= 1 ? 0 : span - (2 * span * i) / (k - 1);
      out.set(b.repo, mirror ? 180 - deg : deg);
    });
  };
  spread(right, false);
  spread(left, true);
  return out;
}

/** Hash seats on an outer ring, relaxed to a minimum separation, nudged off `avoid`. */
function outerSeats(f: SkyFrame, ring: 1 | 2, bodies: readonly SkyBody[], avoid: readonly Box[]): Map<string, number> {
  const minSep = RING_MIN_SEP[ring];
  const seats = bodies.map((b) => ({ repo: b.repo, deg: hash01(`${b.repo}#${ring}`) * 360 })).sort((a, b) => a.deg - b.deg);
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < seats.length && seats.length > 1; i++) {
      const a = seats[i]!;
      const b = seats[(i + 1) % seats.length]!;
      const gap = (((b.deg - a.deg) % 360) + 360) % 360;
      if (gap < minSep) b.deg = a.deg + minSep;
    }
  }
  const out = new Map<string, number>();
  for (const s of seats) {
    let deg = s.deg;
    for (let k = 1; k <= 24 && avoid.some((box) => inside(pointOn(f, ring, deg), box, AVOID_PAD)); k++) {
      deg = s.deg + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 7;
    }
    out.set(s.repo, ((deg % 360) + 360) % 360);
  }
  return out;
}

/** Push big labels on one side apart vertically, keeping them inside the sky. */
function sweep(labels: PlacedLabel[], f: SkyFrame) {
  labels.sort((a, b) => a.box.y - b.box.y);
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]!.box;
    labels[i]!.box.y = Math.max(labels[i]!.box.y, prev.y + prev.h + SWEEP_GAP);
  }
  const last = labels[labels.length - 1];
  const overflow = last ? last.box.y + last.box.h - (f.skyH - 6) : 0;
  if (overflow > 0) for (const l of labels) l.box.y -= overflow;
  for (const l of labels) l.box.y = Math.max(6, l.box.y);
}

function secondarySize(b: SkyBody, nameOnly: boolean): { w: number; h: number } {
  const [nameSize, noteSize] = b.ring === 1 ? [25, 17] : [21, 15];
  const w = Math.max(b.name.length * nameSize * 0.58, nameOnly ? 0 : (b.note ?? "").length * noteSize * 0.55);
  return { w, h: nameOnly || !b.note ? nameSize + 6 : nameSize + noteSize + 12 };
}

function placeSecondary(f: SkyFrame, b: SkyBody, at: Pt, taken: Box[], bodies: readonly { repo: string; box: Box }[]): PlacedLabel | null {
  for (const nameOnly of [false, true]) {
    const { w, h } = secondarySize(b, nameOnly);
    // Clear of the body AND its "landed today" halo rings.
    const r = (b.ring === 1 ? 16 : 13) + (b.halo ? 7 + 6 * (b.halo - 1) : 0);
    const right = at.x >= f.cx;
    const tries: [Box, PlacedLabel["anchor"]][] = [
      [{ x: right ? at.x + r : at.x - r - w, y: at.y - h / 2, w, h }, right ? "start" : "end"],
      [{ x: at.x - w / 2, y: at.y - r - h, w, h }, "middle"],
      [{ x: at.x - w / 2, y: at.y + r, w, h }, "middle"],
      [{ x: right ? at.x - r - w : at.x + r, y: at.y - h / 2, w, h }, right ? "end" : "start"],
    ];
    for (const [box, anchor] of tries) {
      const fits = box.x >= 8 && box.x + box.w <= f.w - 8 && box.y >= 4 && box.y + box.h <= f.skyH;
      const clear = !taken.some((t) => overlaps(t, box, 6)) && !bodies.some((o) => o.repo !== b.repo && overlaps(o.box, box, 2));
      if (fits && clear) {
        taken.push(box);
        return { repo: b.repo, box, anchor, lead: null, nameOnly };
      }
    }
  }
  return null;
}

/** The core's own label box (fixed, for the same reason as `PRIMARY.w`), so nothing sits on it. */
export function coreBox(f: SkyFrame, core: SkyModel["core"]): Box | null {
  if (!core.title && !core.sub) return null;
  return { x: f.cx - 200, y: f.cy + 14, w: 400, h: core.title ? 66 : 30 };
}

/** The legend's corner, kept clear the same way. */
export const legendBox = (): Box => ({ x: 16, y: 8, w: 520, h: 46 });

export interface SkyLayout {
  seats: Map<string, Seat>;
  labels: PlacedLabel[];
}

export function layoutSky(f: SkyFrame, model: SkyModel): SkyLayout {
  const seats = new Map<string, Seat>();
  const labels: PlacedLabel[] = [];
  const atWork = model.bodies.filter((b) => b.ring === 0);
  for (const [repo, deg] of atWorkSeats(atWork)) seats.set(repo, { ring: 0, deg });

  const sides: Record<"l" | "r", PlacedLabel[]> = { l: [], r: [] };
  for (const b of atWork) {
    const at = pointOn(f, 0, seats.get(b.repo)!.deg);
    const w = PRIMARY.w;
    const right = at.x >= f.cx;
    const box = { x: right ? at.x + GAP_X : at.x - GAP_X - w, y: at.y - PRIMARY.h / 2, w, h: PRIMARY.h };
    sides[right ? "r" : "l"].push({ repo: b.repo, box, anchor: right ? "start" : "end", lead: at, nameOnly: false });
  }
  for (const side of [sides.l, sides.r]) {
    sweep(side, f);
    for (const l of side) {
      // A leader line only when the sweep pushed the label off its body.
      const mid = l.box.y + PRIMARY.h / 2;
      if (l.lead && Math.abs(mid - l.lead.y) < 24) l.lead = null;
      labels.push(l);
    }
  }
  const taken: Box[] = [...labels.map((l) => l.box), legendBox()];
  const core = coreBox(f, model.core);
  if (core) taken.push(core);

  for (const ring of [1, 2] as const) {
    const onRing = model.bodies.filter((b) => b.ring === ring);
    for (const [repo, deg] of outerSeats(f, ring, onRing, taken)) seats.set(repo, { ring, deg });
  }
  // No small label may cover another body.
  const bodyBoxes = [...seats].map(([repo, s]) => {
    const p = pointOn(f, s.ring, s.deg);
    return { repo, box: { x: p.x - 12, y: p.y - 12, w: 24, h: 24 } };
  });
  // Small labels: the next-up ring first (it is closer to what happens next), then the resting ring.
  for (const ring of [1, 2] as const) {
    for (const b of model.bodies.filter((x) => x.ring === ring).sort((a, c) => a.repo.localeCompare(c.repo))) {
      const placed = placeSecondary(f, b, pointOn(f, ring, seats.get(b.repo)!.deg), taken, bodyBoxes);
      if (placed) labels.push(placed);
    }
  }
  return { seats, labels };
}
