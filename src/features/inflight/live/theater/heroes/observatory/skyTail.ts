// THE COMET TAIL — a lane's accumulated activity laid out behind its nucleus along the ring. Pure.
//
// One particle per event this screen has seen for the lane's session, NEWEST AT THE HEAD. A particle's
// place is its ORDER (slot i sits i steps back along the ring), never its age — so the tail only
// shifts when a real event lands at the head and pushes the others back. Age is spent on brightness
// instead: every particle (and the ribbon under them) fades by `now - at`, so a lane that goes quiet
// visibly cools, and a frozen clock (a stale pulse) freezes the cooling with it.
//   warm (amber)  = an edit or write      cool (azure) = a read or search      pale = anything else

import type { SkyTone } from "./skyModel";
import type { SeenActivity } from "./skyMemory";
import { arcBack, outward, r1, walkBack, hash01, type Pt, type SkyFrame } from "./skyEllipse";
import { toMs } from "../../theaterFormat";
import { FADE_FLOOR, FADE_HALF_LIFE_MS, SPRAY_BASE, SPRAY_PER_SLOT, TAIL_HEAD_GAP, TAIL_MAX_LEN, TAIL_STEP } from "./skyConstants";

export type ParticleKind = "edit" | "read" | "other";

export interface Particle {
  key: string;
  x: number;
  y: number;
  r: number;
  kind: ParticleKind;
  /** 0…1 from the event's age. */
  glow: number;
  /** Arrived after this screen's first pulse — entitled to an entrance. */
  fresh: boolean;
}

export interface RibbonSegment {
  points: string;
  opacity: number;
}

export interface CometTail {
  particles: Particle[];
  ribbon: RibbonSegment[];
  /** Brightness of the newest event (0 when there is none) — the ribbon's and the nucleus's warmth. */
  heat: number;
  tone: SkyTone;
  /** Events drawn / events this screen has seen for the session. */
  shown: number;
}

/** Brightness left in an event `ageMs` old. */
export const fade = (ageMs: number): number => Math.pow(0.5, Math.max(0, ageMs) / FADE_HALF_LIFE_MS);

const kindOf = (k: SeenActivity["kind"]): ParticleKind =>
  k === "edit" || k === "write" ? "edit" : k === "read" || k === "search" ? "read" : "other";
const RADIUS: Record<ParticleKind, number> = { edit: 7, read: 4.8, other: 3.2 };

/** How much arc a tail may use before it would reach the next at-work body behind it. */
export function tailRoom(f: SkyFrame, deg: number, others: readonly number[]): number {
  let room = TAIL_MAX_LEN;
  for (const o of others) room = Math.min(room, arcBack(f, 0, deg, o) - 48);
  return Math.max(0, room);
}

const shift = (p: Pt, n: Pt, by: number): Pt => ({ x: p.x + n.x * by, y: p.y + n.y * by });

function ribbon(f: SkyFrame, deg: number, length: number, heat: number): RibbonSegment[] {
  if (length <= TAIL_HEAD_GAP || heat <= FADE_FLOOR) return [];
  const samples: number[] = [];
  for (let d = 8; d <= length; d += 12) samples.push(d);
  const walked = walkBack(f, 0, deg, samples);
  const edge = walked.map((w, i) => {
    const t = i / Math.max(1, walked.length - 1);
    const half = 13 * (1 - t) + 1.5;
    const n = outward(f, 0, w.deg);
    return { a: shift(w.at, n, half), b: shift(w.at, n, -half), t };
  });
  const out: RibbonSegment[] = [];
  for (let i = 0; i + 1 < edge.length; i += 3) {
    const run = edge.slice(i, Math.min(edge.length, i + 4));
    const pts = [...run.map((e) => e.a), ...[...run].reverse().map((e) => e.b)];
    out.push({ points: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), opacity: 0.34 * heat * (1 - edge[i]!.t * 0.9) });
  }
  return out;
}

export function cometTail(f: SkyFrame, deg: number, room: number, events: readonly SeenActivity[], tone: SkyTone, now: number): CometTail {
  const newestFirst = [...events].reverse();
  const slots = Math.max(0, Math.min(newestFirst.length, Math.floor((room - TAIL_HEAD_GAP) / TAIL_STEP) + 1));
  const drawn = newestFirst.slice(0, slots);
  const walked = walkBack(f, 0, deg, drawn.map((_, i) => TAIL_HEAD_GAP + i * TAIL_STEP));
  const particles: Particle[] = [];
  drawn.forEach((e, i) => {
    const glow = fade(now - (toMs(e.at) ?? now));
    if (glow < FADE_FLOOR) return;
    const w = walked[i]!;
    // A spray, not a bead string: each event keeps its own side and offset (hash of its identity),
    // widening down the tail.
    const h = hash01(e.key);
    const spray = (SPRAY_BASE + i * SPRAY_PER_SLOT) * (0.35 + 0.65 * ((h * 7) % 1)) * (h < 0.5 ? -1 : 1);
    const at = shift(w.at, outward(f, 0, w.deg), spray);
    const kind = kindOf(e.kind);
    particles.push({ key: e.key, x: r1(at.x), y: r1(at.y), r: RADIUS[kind], kind, glow, fresh: e.fresh });
  });
  const newest = newestFirst[0];
  const heat = newest ? fade(now - (toMs(newest.at) ?? now)) : 0;
  const length = drawn.length ? TAIL_HEAD_GAP + (drawn.length - 1) * TAIL_STEP + 10 : 0;
  return { particles, ribbon: ribbon(f, deg, length, heat), heat, tone, shown: particles.length };
}
