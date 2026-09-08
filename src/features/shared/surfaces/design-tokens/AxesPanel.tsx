"use client";

// density-and-scale-axes: two user axes beyond color, each a token transform at the scope root that
// rebinds a DISJOINT slice (density: spacing and row height; text scale: type recipes), so compact
// plus large text composes. The ownership matrix is the proof of disjointness. The clip demo is the
// unit-discipline prerequisite: a container sized in px clips scaled text; one sized relative to
// text grows with it. The clip verdict is arithmetic over the authority, not a measurement.

import { AXIS_OWNERSHIP, DENSITY, TEXT_SCALES, TYPE_BASE_PX, type AxisId, type Density, type TextScale } from "./tokens";
import { Choice, Readout, Region, TH } from "./sceneParts";

const AXES = Object.keys(AXIS_OWNERSHIP) as AxisId[];
const ALL_ROLES = AXES.flatMap((a) => [...AXIS_OWNERSHIP[a]]);
const FIXED_PX = 44;
const LINES = 2;
const LINE_HEIGHT = 1.4;

export function AxesRegion({ density, scale, onDensity, onScale }: { density: Density; scale: TextScale; onDensity: (d: Density) => void; onScale: (s: TextScale) => void }) {
  const needed = Math.round(TYPE_BASE_PX["type-body"] * scale * LINE_HEIGHT * LINES);
  const clipped = needed > FIXED_PX;
  return (
    <Region technique="density-and-scale-axes" title="Axes that compose" note="Each axis owns a disjoint slice; compact means less air, not smaller words.">
      <div className="space-y-2">
        <Choice label="density" value={density} options={["comfortable", "compact"] as const} onChange={onDensity} />
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="text scale">
          <span className="type-label tracking-[0.22em] text-slate-500">text scale</span>
          {TEXT_SCALES.map((s) => (
            <button key={s} type="button" aria-pressed={s === scale} onClick={() => onScale(s)} className={s === scale ? "focus-ring rounded-md border border-accent bg-accent/10 px-2 py-1 type-caption text-accent-soft" : "focus-ring rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 hover:border-accent"}>
              {s}x
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <table className="w-full self-start type-caption">
          <thead>
            <tr>
              <th className={TH}>role</th>
              {AXES.map((a) => (
                <th key={a} className={TH}>
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_ROLES.map((role) => (
              <tr key={role} className="border-t border-divider text-slate-300">
                <td className="py-0.5 font-mono">{role}</td>
                {AXES.map((a) => {
                  const owns = (AXIS_OWNERSHIP[a] as readonly string[]).includes(role);
                  return (
                    <td key={a} className={`py-0.5 ${owns ? "text-accent-soft" : "text-slate-700"}`} data-owner={owns ? a : undefined}>
                      {owns ? "rebinds" : "never"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-2">
          <Readout label="row height" value={`${DENSITY[density]["row-h"]}px`} />
          <Readout label="body size" value={`${Math.round(TYPE_BASE_PX["type-body"] * scale)}px`} />
          <div className="grid grid-cols-2 gap-2">
            <div className="overflow-hidden rounded-md border border-divider p-1" style={{ height: FIXED_PX }} data-clip-fixed={clipped}>
              <p style={{ fontSize: "var(--sx-type-body)", lineHeight: LINE_HEIGHT }} className={clipped ? "text-danger" : "text-slate-300"}>
                fixed {FIXED_PX}px box, two lines of body copy
              </p>
            </div>
            <div className="rounded-md border border-divider p-1" style={{ minHeight: `${LINES * LINE_HEIGHT}em`, fontSize: "var(--sx-type-body)" }}>
              <p style={{ lineHeight: LINE_HEIGHT }} className="text-slate-300">
                em-sized box, the same copy, grows with the text
              </p>
            </div>
          </div>
          <Readout label="fixed box" value={<span data-clipped={clipped}>{clipped ? `clips: needs ${needed}px` : `fits: needs ${needed}px`}</span>} tone={clipped ? "text-danger" : "text-success-soft"} />
        </div>
      </div>
    </Region>
  );
}
