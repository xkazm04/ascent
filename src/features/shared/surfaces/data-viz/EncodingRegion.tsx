"use client";

// encoding-vocabulary: one multi-series chart that answers ONE question with colour. In identity
// mode hue is bound to each series' id (never its index) — re-sort the fleet and every line keeps its
// colour; the end-mark shape and the direct label are the redundant channels. In status mode hue is
// the score ramp (the same LEVEL_HEX the badges use) and identity moves entirely to the label, so
// two same-status series never share a swatch that pretends to distinguish them. The grayscale check
// is the audit: would it still read printed in gray? The palette declares a capacity.

import { useState } from "react";
import { LEVEL_HEX, scoreHex } from "@/lib/ui";
import { PALETTE_CAPACITY, SCORE_DOMAIN, aliases, latest, seriesColor } from "./chartMath";
import type { Repo } from "./fixtures";
import { MiniLine, type Marker } from "./MiniLine";
import { BTN, Chips, Readout, Region } from "./sceneParts";

type Mode = "identity" | "status";
const MODES: readonly { id: Mode; label: string }[] = [
  { id: "identity", label: "colour = who" },
  { id: "status", label: "colour = how it is doing" },
];
const MARKERS: readonly Marker[] = ["dot", "square", "diamond", "dot", "square"];
const SERIES = 4;

export function EncodingRegion({ repos, reduced }: { repos: readonly Repo[]; reduced: boolean }) {
  const [mode, setMode] = useState<Mode>("identity");
  const [gray, setGray] = useState(false);
  const [order, setOrder] = useState<"id" | "score">("id");
  const base = repos.filter((r) => r.shape !== "new" && r.shape !== "gap").slice(0, SERIES);
  const shown = order === "id" ? base : [...base].sort((a, b) => (latest(b.score) ?? 0) - (latest(a.score) ?? 0));
  const colorOf = (r: Repo) => (mode === "identity" ? seriesColor(r.id) : scoreHex(latest(r.score) ?? 0));
  const markerOf = (r: Repo) => MARKERS[(Number(r.id.replace(/\D/g, "")) - 1) % MARKERS.length]!;
  const collisions = shown.filter((a, i) => shown.some((b, j) => j < i && aliases(a.id, b.id))).length;

  return (
    <Region technique="encoding-vocabulary" title="Colour answers one question" note="Identity or status, never both. The hues are the product's tokens — the chart's green is the badge's green.">
      <div className="flex flex-wrap items-center gap-2">
        <Chips label="What colour carries" value={mode} options={MODES} onPick={setMode} />
        <button type="button" className={BTN} onClick={() => setOrder((o) => (o === "id" ? "score" : "id"))}>
          re-sort by {order === "id" ? "score" : "id"}
        </button>
        <button type="button" className={BTN} aria-pressed={gray} onClick={() => setGray((g) => !g)}>
          grayscale check
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]" data-mode={mode} data-order={order} style={gray ? { filter: "grayscale(1)" } : undefined}>
        <div className="relative">
          {shown.map((r, i) => (
            <div key={r.id} className={i === 0 ? "" : "absolute inset-0"}>
              <MiniLine series={r.score} domain={SCORE_DOMAIN} color={colorOf(r)} reduced={reduced} chrome={i === 0} marker={markerOf(r)} endLabel={r.name} h={110} w={260} pad={12} ariaLabel={`${r.name} overall score, 14 days`} />
            </div>
          ))}
        </div>
        <ul className="space-y-1 self-start" aria-label="legend">
          {shown.map((r) => (
            <li key={r.id} className="flex items-center gap-2 type-caption text-slate-300" data-legend={r.id} data-color={colorOf(r)}>
              <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
                {markerOf(r) === "dot" ? <circle cx={6} cy={6} r={4} fill={colorOf(r)} /> : <rect x={2} y={2} width={8} height={8} fill={colorOf(r)} transform={markerOf(r) === "diamond" ? "rotate(45 6 6)" : undefined} />}
              </svg>
              <span>{r.name}</span>
              <span className="text-slate-600">{mode === "status" ? `L${Object.values(LEVEL_HEX).indexOf(colorOf(r)) + 1}` : r.id}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="colour bound to" value={mode === "identity" ? "series id (survives re-sort)" : "score level (LEVEL_HEX) — identity rides the label"} />
        <Readout label="palette capacity" value={`${PALETTE_CAPACITY} hues · ${collisions === 0 ? "no aliasing" : `${collisions} alias — cap to top-N + other`}`} tone={collisions ? "text-warn" : "text-slate-200"} />
        <Readout label="redundant channel" value="end-mark shape + direct label" />
      </div>
    </Region>
  );
}
