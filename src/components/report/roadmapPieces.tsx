import type { DimensionId, LlmRoadmapItem, ScanReport } from "@/lib/types";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import { projectDimensionClose } from "@/lib/scoring/engine";
import {
  isQuickWin,
  QuickWinBadge,
  sortRoadmap,
  type RoadmapLifts,
  type RoadmapSortMode,
} from "@/components/report/roadmapPriority";
import { ExpectedLiftBasis } from "@/components/report/ExpectedLiftBasis";
import { EFFORT_CLASS, IMPACT_CLASS } from "@/lib/ui";
import { PRACTICES } from "@/lib/practices";
import { Kicker, Surface } from "@/components/ui";

// The two level callouts moved to roadmapLadder.tsx (300-LOC headroom) and are re-exported here, so
// `import { TrustLadder, NextLevelPath } from "@/components/report/roadmapPieces"` keeps working.
export { TrustLadder, NextLevelPath } from "@/components/report/roadmapLadder";

/**
 * The canonical "impact / effort" chip pair. The default (roadmap list) variant renders
 * `rounded-md border px-2 py-0.5` chips labelled `impact: X` / `effort: Y`; `compact` (the sandbox
 * simulators) tightens to `rounded border px-1.5 py-0.5` and drops the colon. `className` overrides the
 * wrapper (e.g. the simulators' `mt-1 … gap-1.5`) so each call site keeps its surrounding spacing.
 */
export function RoadmapMeta({
  item,
  compact = false,
  className,
}: {
  item: Pick<LlmRoadmapItem, "impact" | "effort">;
  compact?: boolean;
  className?: string;
}) {
  const chip = compact ? "rounded border px-1.5 py-0.5" : "rounded-md border px-2 py-0.5";
  const sep = compact ? " " : ": ";
  return (
    <div className={className ?? "flex items-center gap-2 type-body-sm"}>
      <span className={`${chip} ${IMPACT_CLASS[item.impact]}`}>impact{sep}{item.impact}</span>
      <span className={`${chip} ${EFFORT_CLASS[item.effort]}`}>effort{sep}{item.effort}</span>
    </div>
  );
}

/**
 * The tracker's triage progress header. Pure relocation out of RecommendationTracker.tsx, which sat at
 * 296/300 lines and had to shed some before it could carry the measured-sort toggle (AGENTS.md: a file
 * approaching the limit is the signal to extract). Behaviour is unchanged, including the two corners
 * this header exists to get right: dismissed items leave the denominator (a fully-triaged backlog must
 * be able to reach 100%), and ALL-dismissed is not success — it gets a neutral fill and its own
 * sentence, never a triumphant green bar over work nobody did.
 */
export function TrackerProgress({
  done,
  actionable,
  dismissed,
  allDismissed,
  pct,
}: {
  done: number;
  actionable: number;
  dismissed: number;
  allDismissed: boolean;
  pct: number;
}) {
  return (
    <Surface radius="xl" className="p-4">
      <div className="flex items-center justify-between type-body">
        {allDismissed ? (
          <span className="font-medium text-slate-400">
            All {dismissed} recommendation{dismissed === 1 ? "" : "s"} dismissed, nothing left to track
          </span>
        ) : (
          <>
            <span className="font-medium text-white">
              {done} of {actionable} done
              {dismissed > 0 && <span className="text-slate-500"> · {dismissed} dismissed</span>}
            </span>
            <span className="text-slate-400">{pct}%</span>
          </>
        )}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        {allDismissed ? (
          <div className="h-full rounded-full bg-slate-700" style={{ width: "100%" }} />
        ) : (
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        )}
      </div>
    </Surface>
  );
}

/**
 * The roadmap's ordering switch (moonshot #9). CONTROLLED and hook-free, so it stays in this
 * server-safe module while its state lives in the client tracker. The caller renders it only when at
 * least one item has a measured clause: offering "by measured lift" over a ledger that has measured
 * nothing would advertise evidence that does not exist.
 */
export function RoadmapSortToggle({
  mode,
  onChange,
}: {
  mode: RoadmapSortMode;
  onChange: (mode: RoadmapSortMode) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 type-body-sm">
      <Kicker tone="muted" as="span">
        order
      </Kicker>
      {(["priority", "measured"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`rounded-md border px-2 py-0.5 transition-colors ${
            mode === m ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-700 text-slate-400 hover:text-slate-200"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function ExploreList({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-divider bg-slate-950/40 p-3">
      <Kicker tone="accent">Explore</Kicker>
      <ul className="mt-1.5 space-y-1 type-body text-slate-300">
        {items.map((q, i) => (
          <li key={i} className="flex gap-2">
            <span className="select-none text-slate-600">→</span>
            <span>{q}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "What good looks like here" — the one Pillar-1 card element (docs/VISION-TRANSITION.md, Pillar 1)
 * that the repo report card was missing: a pointer to the reusable practice that closes this gap.
 * Joined by dimension id at render time against the org's practice catalog (src/lib/practices.ts) —
 * no schema change, no persisted field. Renders nothing for a dimension with no mapped practice.
 */
export function ExemplarPointer({ dim }: { dim: DimensionId }) {
  const practice = PRACTICES.find((p) => p.dimId === dim);
  if (!practice) return null;
  return (
    <div className="mt-3 rounded-lg border border-accent/20 bg-accent/[0.06] p-3">
      <Kicker tone="accent">What good looks like</Kicker>
      <p className="mt-1.5 type-body leading-relaxed text-slate-300">
        <span className="font-semibold text-white">{practice.label}</span>: {practice.what}
      </p>
    </div>
  );
}

/** A what-if payoff chip: the overall-score upside of fully closing this dimension's gap. */
export function PayoffChip({ report, dim }: { report: ScanReport; dim: DimensionId }) {
  const proj = projectDimensionClose(report, dim);
  if (proj.deltaScore <= 0) return null;
  return (
    <span
      className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent"
      title="Projected effect on your overall score if this gap is fully closed"
    >
      ↑ up to +{proj.deltaScore} pts{proj.levelUp ? ` · ${proj.fromLevel}→${proj.level}` : ""}
    </span>
  );
}

/**
 * The one concrete first move on a roadmap row, when the scan recorded one.
 *
 * Shared by BOTH renderings of the roadmap — the public `RoadmapSteps` below and the persisted
 * `RecommendationTracker` — because it was previously inlined in RoadmapSteps only: every org with
 * persistence enabled saw the tracker, which selected, typed and shipped `firstStep` over the wire and
 * then never rendered it. One component means the two surfaces cannot drift on it again (the same
 * failure the shared `sortRoadmap` contract exists to prevent).
 *
 * Renders NOTHING when the field is absent or blank — no "no first step recorded" placeholder, which
 * would read as a finding about the gap rather than a silence about the model's output.
 */
export function RoadmapFirstStep({ firstStep }: { firstStep?: string | null }) {
  if (!firstStep?.trim()) return null;
  return (
    <p className="mt-1.5 type-body leading-relaxed text-slate-300">
      <span className="font-semibold text-slate-200">First step:</span> {firstStep}
    </p>
  );
}

/**
 * Prioritized, numbered next-steps for public scans — quick wins first.
 *
 * `lifts` is the org's measured basis map (moonshot #9). It is OPTIONAL and defaults to absent, so an
 * anonymous public scan — which has no tenant and therefore no ledger — renders exactly the roadmap it
 * always did. When it is supplied each row gains a basis clause, and `sort` may order by measured
 * evidence; the default stays `priority`.
 */
export function RoadmapSteps({
  items,
  report,
  lifts,
  sort = "priority",
}: {
  items: LlmRoadmapItem[];
  report: ScanReport;
  lifts?: RoadmapLifts;
  sort?: RoadmapSortMode;
}) {
  const ordered = sortRoadmap(items, lifts, sort);
  return (
    <ol className="space-y-3">
      {ordered.map((item, i) => {
        const axis = DIMENSION_BY_ID[item.dimension]?.axis;
        const quick = isQuickWin(item);
        return (
          <li
            key={i}
            className="rounded-xl border bg-surface/40 p-5"
            style={quick ? { borderColor: "rgba(16,185,129,0.35)" } : { borderColor: "rgb(30,41,59)" }}
          >
            <div className="flex items-start gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 font-mono type-body text-slate-300">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  {quick && <QuickWinBadge />}
                </div>
                <RoadmapFirstStep firstStep={item.firstStep} />
                {item.rationale && (
                  <p className="mt-1.5 type-body leading-relaxed text-slate-400">{item.rationale}</p>
                )}
                <ExpectedLiftBasis item={item} lifts={lifts} />
                <ExploreList items={item.explore} />
                <ExemplarPointer dim={item.dimension} />
                <div className="mt-2.5 flex flex-wrap items-center gap-2 type-body-sm">
                  <RoadmapMeta item={item} className="contents" />
                  {axis && (
                    <span className="rounded-md border border-slate-700 px-2 py-0.5 text-slate-400">
                      lifts {axis === "adoption" ? "AI Adoption" : "Engineering Rigor"}
                    </span>
                  )}
                  <PayoffChip report={report} dim={item.dimension} />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
