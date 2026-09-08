"use client";

// micro-visualizations: a sparkline column inside a repository table. The column header names the
// metric and the window (the chrome the glyph has not got); every cell shares ONE domain and ONE
// window, so a flat row and a volatile row look different — flip the chip to per-cell auto-scale and
// they stop doing so. The number rides beside the glyph, never behind it. Below three observations
// no line is drawn: the cell says "collecting" and shows the count. A gap stays a gap at 20px tall.

import { useState } from "react";
import { fmtDelta, toneFor, DIRECTION_TONE } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { MIN_POINTS_FOR_SHAPE, SCORE_DOMAIN, domainFor, latest, measuredCount, shapeDelta } from "./chartMath";
import type { Repo } from "./fixtures";
import { MiniLine } from "./MiniLine";
import { Chips, Region } from "./sceneParts";

type CellScale = "shared" | "per-cell";
const SCALES: readonly { id: CellScale; label: string }[] = [
  { id: "shared", label: "one domain for the column" },
  { id: "per-cell", label: "per-cell auto (defect)" },
];

export function MicroRegion({ repos, volume, reduced }: { repos: readonly Repo[]; volume: number; reduced: boolean }) {
  const [scale, setScale] = useState<CellScale>("shared");
  return (
    <Region technique="micro-visualizations" title="A column of glyphs is an instrument" note="One question per glyph — which way is it going — asked eight times in parallel. The header carries the chrome.">
      <Chips label="Sparkline scale" value={scale} options={SCALES} onPick={setScale} />
      <table className="mt-3 w-full type-caption" data-cell-scale={scale}>
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">repository</th>
            <th className="text-right font-normal">score</th>
            <th className="font-normal">overall · daily · 14d</th>
            <th className="text-right font-normal">Δ 14d</th>
          </tr>
        </thead>
        <tbody>
          {repos.map((r) => {
            const n = measuredCount(r.score);
            const value = latest(r.score);
            const delta = shapeDelta(r.score);
            const domain = scale === "shared" ? SCORE_DOMAIN : domainFor("sample-floor", r.score);
            const tone = delta === null ? null : DIRECTION_TONE[toneFor(delta)];
            return (
              <tr key={r.id} className="h-8 border-t border-divider text-slate-300" data-row={r.id} data-shape={r.shape}>
                <td className="py-0.5">{r.name}</td>
                <td className="py-0.5 text-right font-mono tabular-nums" style={value === null ? undefined : { color: scoreHex(value) }}>
                  {value === null ? "—" : value}
                </td>
                <td className="w-32 py-0.5">
                  {n < MIN_POINTS_FOR_SHAPE ? (
                    <span className="type-caption text-slate-500" data-cell="collecting">
                      collecting · {n} of {MIN_POINTS_FOR_SHAPE}
                    </span>
                  ) : (
                    <div className="h-5 w-28" data-cell="line">
                      <MiniLine series={r.score} domain={domain} color={scoreHex(value ?? 0)} reduced={reduced} w={112} h={20} pad={2} ariaLabel={`${r.name} 14-day score trend, ${tone?.label ?? "forming"}`} />
                    </div>
                  )}
                </td>
                <td className="py-0.5 text-right font-mono tabular-nums" style={tone ? { color: tone.color } : undefined}>
                  {delta === null ? "—" : fmtDelta(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 type-caption text-slate-500">
        {repos.length} of {volume.toLocaleString()} repositories · the column is the doorway: the full chart is one click away, the glyph only says a pattern exists.
      </p>
    </Region>
  );
}
