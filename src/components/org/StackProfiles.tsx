"use client";

// Tech-stacks "Profiles" view — a left rail lists every stack as a toggle (click to add/remove it
// from the picture) with its own repos/brief links and a select/deselect-all control; the right pane
// is ONE large shared radar overlaying the active stacks so the whole fleet's shape comparison reads
// in a single eyesight. CONTROLLED: the selection lives in the parent (TechStacksAnalysis) so the
// same toggle also scopes the dimension analysis below — one selection drives both.

import Link from "next/link";
import { Surface } from "@/components/ui";
import { postureLabel } from "@/components/org/ui";
import type { SegmentSummary } from "@/lib/db";
import { scoreHex } from "@/lib/ui";
import { StackRadarChart, type RadarSeries } from "./StackRadarChart";
import { stackColor } from "./stackViz";
import type { AnalysisScope } from "./analysisScope";

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

const valuesFor = (s: SegmentSummary, dims: string[]): number[] => {
  const byId = new Map(s.dimAverages.map((d) => [d.dimId, d.avg]));
  return dims.map((d) => byId.get(d) ?? 0);
};

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

/** One list item: the top line (swatch + full-width name + score) is the show/hide toggle; the
 *  posture + repos/brief links sit on their own line beneath, so a long name (both backends read
 *  "Backend · …") never truncates away its language. */
function StackRow({ org, s, color, scopeQ, active, onToggle, onHover, onLeave }: {
  org: string; s: SegmentSummary; color: string; scopeQ: (id: string | null) => string; active: boolean;
  onToggle: () => void; onHover: () => void; onLeave: () => void;
}) {
  return (
    <li
      className={`rounded-lg px-2 py-1.5 transition hover:bg-surface/60 ${active ? "" : "opacity-45"}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        onClick={onToggle}
        onFocus={onHover}
        onBlur={onLeave}
        aria-pressed={active}
        className="focus-ring flex w-full items-center gap-2.5 text-left"
      >
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-sm border-2"
          style={{ borderColor: color, backgroundColor: active ? color : "transparent" }}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-white">{s.name}</span>
        <span className="shrink-0 font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(s.avgOverall) }}>
          {s.avgOverall}
        </span>
      </button>
      <div className="mt-1 flex items-center justify-between pl-[1.375rem]">
        <span className="font-mono text-xs text-slate-500">{postureLabel(s.posture)}</span>
        <span className="font-mono text-sm">
          <Link href={`/org/${org}/repositories${scopeQ(s.id)}`} className="text-accent transition hover:text-white">repos</Link>
          <span className="text-slate-700"> · </span>
          <Link href={`/org/${org}/executive${scopeQ(s.id)}`} className="text-accent transition hover:text-white">brief</Link>
        </span>
      </div>
    </li>
  );
}

export function StackProfiles({ org, stacks, dims, scope, active, allActive, hovered, onToggle, onToggleAll, onHover }: Props) {
  const colorOf = new Map(stacks.map((s, i) => [s.id, stackColor(i)]));

  const series: RadarSeries[] = stacks
    .filter((s) => active.has(s.id ?? ""))
    .map((s) => ({ id: s.id ?? "", name: s.name, color: colorOf.get(s.id) ?? stackColor(0), values: valuesFor(s, dims) }));

  return (
    <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(230px,300px)_1fr]">
      {/* Left rail — the entity list, each a show/hide toggle with its own onward links. */}
      <Surface radius="2xl" className="p-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">{scope.nounPlural}</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-600">{active.size}/{stacks.length}</span>
            <SelectAllButton allActive={allActive} nounPlural={scope.nounPlural} onToggle={onToggleAll} />
          </div>
        </div>
        <ul className="space-y-0.5">
          {stacks.map((s) => (
            <StackRow key={s.id} org={org} s={s} color={colorOf.get(s.id) ?? stackColor(0)} scopeQ={scope.scopeQ}
              active={active.has(s.id ?? "")} onToggle={() => onToggle(s.id ?? "")}
              onHover={() => onHover(s.id ?? "")} onLeave={() => onHover(null)} />
          ))}
        </ul>
      </Surface>

      {/* Right pane — the shared overlay radar. */}
      <Surface radius="2xl" className="flex flex-col p-4">
        <p className="mb-1 font-mono text-sm text-slate-500">
          Overlaid maturity profiles · color = {scope.noun} · radius = each dimension&apos;s score · hover a {scope.noun} to isolate it
        </p>
        {series.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-center text-slate-500">
            Select a {scope.noun} on the left to plot its profile.
          </div>
        ) : (
          <div className="mx-auto aspect-square w-full max-w-[460px]">
            <StackRadarChart series={series} dims={dims} emphasisId={hovered} />
          </div>
        )}
      </Surface>
    </div>
  );
}
