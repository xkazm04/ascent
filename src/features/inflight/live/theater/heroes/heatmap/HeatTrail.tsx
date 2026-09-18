// THE TRAIL — the agent's path through the code: a thin line joining the last few files it touched,
// in the order it touched them, each leg fading with the age of the touch it leads to. It moves only
// when a new touch arrives (the head jumps to the new file) and otherwise only fades, so a quiet agent
// leaves a trail that dims away. The newest touch, while under `CURSOR_MS`, is the CURSOR — "it is
// here" — ringed on its cell (HeatTreemap) and dotted brightest here. Pure render, no hooks.
//
// `live` is the honesty switch. A lane that has left the files — verifying, committing, landing —
// keeps its trail (it really walked there, and the legs go on cooling) but loses the big head dot,
// because nothing is on that file now. `cursorOf` is likewise asked only of a live lane.

import type { ModuleBox } from "./heatLayout";
import { CURSOR_MS, DECAY_TRANSITION_MS, TRAIL_MAX, TRAIL_MS, heat } from "./heatStyle";
import type { RepoHeat, TouchKind } from "./heatTypes";

export interface Touch {
  path: string;
  at: number;
  kind: TouchKind;
}

/** The last `TRAIL_MAX` distinct files the CURRENT session touched within `TRAIL_MS`, oldest first. */
export function recentTouches(repo: RepoHeat, now: number): Touch[] {
  const out: Touch[] = [];
  const from = repo.session?.startMs ?? Number.NEGATIVE_INFINITY;
  for (const f of repo.files) {
    const edit = f.editAt ?? -Infinity;
    const read = f.readAt ?? -Infinity;
    const at = Math.max(edit, read);
    if (Number.isFinite(at) && at >= from && now - at >= 0 && now - at < TRAIL_MS) out.push({ path: f.path, at, kind: edit >= read ? "edit" : "read" });
  }
  return out.sort((a, b) => a.at - b.at).slice(-TRAIL_MAX);
}

/** The file the agent is on, if its newest touch is fresh enough to say so. */
export function cursorOf(touches: readonly Touch[], now: number): string | null {
  const last = touches[touches.length - 1];
  return last && now - last.at < CURSOR_MS ? last.path : null;
}

export function HeatTrail({
  boxes,
  touches,
  now,
  reducedMotion,
  live,
  w,
  h,
}: {
  boxes: readonly ModuleBox[];
  touches: readonly Touch[];
  now: number;
  reducedMotion: boolean;
  /** An agent session is in the files right now — the only state whose head dot may say "here". */
  live: boolean;
  w: number;
  h: number;
}) {
  const centre = new Map<string, { x: number; y: number }>();
  for (const b of boxes)
    for (const c of b.cells) centre.set(c.file.path, { x: b.rect.x + c.rect.x + c.rect.w / 2, y: b.rect.y + c.rect.y + c.rect.h / 2 });
  const pts = touches.flatMap((t) => {
    const p = centre.get(t.path);
    return p ? [{ ...p, t }] : [];
  });
  if (pts.length < 2) return null;
  // Line weight follows the map's size, so the trail reads the same on a laptop and a 2160p wall.
  const k = Math.min(2.5, Math.max(1, w / 900));
  const fade = reducedMotion ? undefined : { transition: `opacity ${DECAY_TRANSITION_MS}ms linear` };
  return (
    <svg aria-hidden data-trail data-live={live || undefined} className="pointer-events-none absolute inset-0 z-[5] overflow-visible" width={w} height={h}>
      {pts.slice(1).map((p, i) => {
        const from = pts[i]!;
        return (
          <line
            key={`${from.t.path}>${p.t.path}`}
            x1={from.x}
            y1={from.y}
            x2={p.x}
            y2={p.y}
            strokeWidth={2.5 * k}
            strokeLinecap="round"
            strokeDasharray={`${k} ${7 * k}`}
            className="stroke-slate-100"
            style={{ opacity: 0.15 + 0.7 * heat(p.t.at, now), ...fade }}
          />
        );
      })}
      {pts.map((p, i) => (
        <circle
          key={p.t.path}
          data-head={(live && i === pts.length - 1) || undefined}
          cx={p.x}
          cy={p.y}
          r={(live && i === pts.length - 1 ? 6 : 3.5) * k}
          className="fill-slate-100"
          style={{ opacity: 0.2 + 0.8 * heat(p.t.at, now), ...fade }}
        />
      ))}
    </svg>
  );
}
