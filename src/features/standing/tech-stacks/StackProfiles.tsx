"use client";

// Tech-stacks "Profiles" view — a left rail lists every stack as a toggle (click to add/remove it
// from the picture) with its own repos/brief links and a select/deselect-all control; the right pane
// is ONE large shared radar overlaying the active stacks so the whole fleet's shape comparison reads
// in a single eyesight. CONTROLLED: the selection lives in the parent (TechStacksAnalysis) so the
// same toggle also scopes the dimension analysis below — one selection drives both.
//
// The paragraph that used to sit over the radar ("color = stack · radius = each dimension's score ·
// hover a stack to isolate it") was a legend written as prose. Colour-is-identity is the rail's own
// swatch, radius-is-score is the ring ticks the chart already labels 25/50/75/100, and the hover
// affordance is now each row's `title`. What prose could NOT do is say which marks are absent — that
// is the kit `Legend` below the radar, showing only the states this selection actually contains.

import { Legend } from "@/components/org/viz";
import { Surface } from "@/components/ui";
import type { SegmentSummary } from "@/lib/db";
import { StackRadarChart, type RadarSeries } from "@/features/standing/tech-stacks/StackRadarChart";
import { StackRow } from "@/features/standing/tech-stacks/StackRow";
import { dimValues, stackState } from "@/features/standing/tech-stacks/stackMeasure";
import { stackColor } from "@/features/standing/tech-stacks/stackViz";
import type { AnalysisScope } from "@/features/standing/tech-stacks/analysisScope";

interface Props {
  org: string;
  stacks: SegmentSummary[];
  dims: string[];
  /** Module noun + scope-query seam (stack vs segment). */
  scope: AnalysisScope;
  /** Controlled selection (entity ids currently plotted). */
  active: Set<string>;
  allActive: boolean;
  /** The rail-hovered entity id, raised in the radar (others recede). */
  hovered: string | null;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onHover: (id: string | null) => void;
}

/** Select-all / deselect-all icon toggle — a check appears when every entity is shown. */
function SelectAllButton({ allActive, nounPlural, onToggle }: { allActive: boolean; nounPlural: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={allActive ? `Deselect all ${nounPlural}` : `Select all ${nounPlural}`}
      title={allActive ? "Deselect all" : "Select all"}
      className="focus-ring rounded p-0.5 text-slate-400 transition hover:text-accent"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
        {allActive && <path d="M5 8.2l2 2 4-4.4" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </button>
  );
}

export function StackProfiles({ org, stacks, dims, scope, active, allActive, hovered, onToggle, onToggleAll, onHover }: Props) {
  const colorOf = new Map(stacks.map((s, i) => [s.id, stackColor(i)]));

  const series: RadarSeries[] = stacks
    .filter((s) => active.has(s.id ?? ""))
    .map((s) => ({ id: s.id ?? "", name: s.name, color: colorOf.get(s.id) ?? stackColor(0), values: dimValues(s, dims) }));

  // Only the states this picture actually contains (Legend's contract): a plotted profile is
  // `measured`, a hole in one is `missing`, and a stack nobody has scanned is `not-judged`.
  const legendStates = [
    ...(series.some((s) => s.values.some((v) => v != null)) ? (["measured"] as const) : []),
    ...(series.some((s) => s.values.some((v) => v == null)) ? (["missing"] as const) : []),
    ...(stacks.some((s) => stackState(s) === "not-judged") ? (["not-judged"] as const) : []),
  ];

  return (
    <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(230px,300px)_1fr]">
      {/* Left rail — the entity list, each a show/hide toggle with its own onward links. */}
      <Surface radius="2xl" className="p-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="type-label tracking-widest text-slate-500">{scope.nounPlural}</span>
          <div className="flex items-center gap-2">
            <span className="type-caption text-slate-600">{active.size}/{stacks.length}</span>
            <SelectAllButton allActive={allActive} nounPlural={scope.nounPlural} onToggle={onToggleAll} />
          </div>
        </div>
        <ul className="space-y-0.5">
          {stacks.map((s) => (
            <StackRow key={s.id} org={org} s={s} color={colorOf.get(s.id) ?? stackColor(0)} scopeQ={scope.scopeQ}
              noun={scope.noun} active={active.has(s.id ?? "")} onToggle={() => onToggle(s.id ?? "")}
              onHover={() => onHover(s.id ?? "")} onLeave={() => onHover(null)} />
          ))}
        </ul>
      </Surface>

      {/* Right pane — the shared overlay radar. */}
      <Surface radius="2xl" className="flex flex-col p-4">
        {series.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-center text-slate-500">
            Select a {scope.noun} on the left to plot its profile.
          </div>
        ) : (
          <div className="mx-auto aspect-square w-full max-w-[460px]">
            <StackRadarChart series={series} dims={dims} emphasisId={hovered} />
          </div>
        )}
        <Legend className="mt-2 justify-center" states={[...legendStates]} />
      </Surface>
    </div>
  );
}
