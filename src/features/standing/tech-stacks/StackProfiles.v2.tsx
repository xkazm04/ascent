"use client";

// The tech-stacks profiles, Prism composition: a ruled rail of stacks (each a show/hide toggle with its
// swatch, score and onward links) beside ONE shared radar overlaying the plotted stacks, no boxed surfaces.
// CONTROLLED, like StackProfiles: the selection lives in the parent (useStackSelection) so the same toggle
// also scopes the analysis below. A swatch colour names WHICH stack; the score is the radius.
import Link from "next/link";
import { Caption, Display, HairlineList, VoidMark } from "@/components/kit";
import { Legend, rendersValue } from "@/components/org/viz";
import { postureLabel } from "@/components/org/shared/ui";
import type { SegmentSummary } from "@/lib/db";
import { buildUrl, orgTabHref } from "@/lib/org/orgTabs";
import { StackRadarChart, type RadarSeries } from "./StackRadarChart";
import { dimValues, stackState } from "./stackMeasure";
import { stackColor } from "./stackViz";
import type { AnalysisScope } from "./analysisScope";

interface Props {
  org: string;
  stacks: SegmentSummary[];
  dims: string[];
  scope: AnalysisScope;
  active: Set<string>;
  allActive: boolean;
  hovered: string | null;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onHover: (id: string | null) => void;
}

/** repositories tab href with a `?stack=`/scope query appended, whichever separator the base needs. */
function repositoriesHref(org: string, query: string): string {
  const base = orgTabHref(org, "repositories");
  if (!query) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${query.replace(/^\?/, "")}`;
}

export function StackProfilesV2({ org, stacks, dims, scope, active, allActive, hovered, onToggle, onToggleAll, onHover }: Props) {
  const colorOf = new Map(stacks.map((s, i) => [s.id, stackColor(i)]));
  const series: RadarSeries[] = stacks
    .filter((s) => active.has(s.id ?? ""))
    .map((s) => ({ id: s.id ?? "", name: s.name, color: colorOf.get(s.id) ?? stackColor(0), values: dimValues(s, dims) }));
  // Only the states this picture actually contains: a plotted profile is measured, a hole in one is missing,
  // and a stack nobody has scanned is not judged.
  const legendStates = [
    ...(series.some((s) => s.values.some((v) => v != null)) ? (["measured"] as const) : []),
    ...(series.some((s) => s.values.some((v) => v == null)) ? (["missing"] as const) : []),
    ...(stacks.some((s) => stackState(s) === "not-judged") ? (["not-judged"] as const) : []),
  ];

  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(240px,320px)_1fr]">
      <div>
        <div className="flex items-center justify-between pb-2">
          <Caption>
            {scope.nounPlural} · {active.size}/{stacks.length}
          </Caption>
          <button
            type="button"
            onClick={onToggleAll}
            aria-label={allActive ? `Deselect all ${scope.nounPlural}` : `Select all ${scope.nounPlural}`}
            className="focus-ring type-caption text-slate-300 transition hover:text-white"
          >
            {allActive ? "Deselect all" : "Select all"}
          </button>
        </div>
        <HairlineList>
          {stacks.map((s) => {
            const state = stackState(s);
            const on = active.has(s.id ?? "");
            const color = colorOf.get(s.id) ?? stackColor(0);
            return (
              <li key={s.id} className={`py-3 transition ${on ? "" : "opacity-50"}`} onMouseEnter={() => onHover(s.id ?? "")} onMouseLeave={() => onHover(null)}>
                <button
                  type="button"
                  onClick={() => onToggle(s.id ?? "")}
                  onFocus={() => onHover(s.id ?? "")}
                  onBlur={() => onHover(null)}
                  aria-pressed={on}
                  title={`${on ? "Hide" : "Show"} ${s.name} · hover or focus to isolate this ${scope.noun} in the radar`}
                  className="focus-ring flex w-full items-center gap-3 text-left"
                >
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-[2px] border-2" style={{ borderColor: color, backgroundColor: on ? color : "transparent" }} />
                  <span className="min-w-0 flex-1 truncate font-medium text-white">{s.name}</span>
                  {rendersValue(state) && s.avgOverall !== null ? (
                    <Display as="div" level="figure" className="shrink-0">{s.avgOverall}</Display>
                  ) : (
                    <VoidMark subject={s.name} />
                  )}
                </button>
                <div className="mt-1 flex items-center justify-between pl-6">
                  <span className="type-caption text-slate-400">{rendersValue(state) ? postureLabel(s.posture) : `${s.repoCount} repos · never scanned`}</span>
                  <span className="type-caption">
                    <Link href={repositoriesHref(org, scope.scopeQ(s.id))} className="focus-ring text-slate-300 transition hover:text-white">
                      repos
                    </Link>
                    <span className="text-slate-500"> · </span>
                    <Link href={buildUrl(org, { tab: "executive", stack: s.id ?? null }, "")} className="focus-ring text-slate-300 transition hover:text-white">
                      brief
                    </Link>
                  </span>
                </div>
              </li>
            );
          })}
        </HairlineList>
      </div>

      <div className="flex flex-col">
        {series.length === 0 ? (
          <p className="flex flex-1 items-center justify-center py-16 text-center text-slate-400">Select a {scope.noun} on the left to plot its profile.</p>
        ) : (
          <div className="mx-auto aspect-square w-full max-w-[460px]">
            <StackRadarChart series={series} dims={dims} emphasisId={hovered} />
          </div>
        )}
        <Legend className="mt-2 justify-center" states={[...legendStates]} />
      </div>
    </div>
  );
}
