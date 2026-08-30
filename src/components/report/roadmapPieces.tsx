import type { DimensionId, LevelId, LlmRoadmapItem, ScanReport } from "@/lib/types";
import { DIMENSION_BY_ID, LEVELS } from "@/lib/maturity/model";
import { cheapestPathToNextLevel, projectDimensionClose } from "@/lib/scoring/engine";
import {
  isQuickWin,
  QuickWinBadge,
  sortRoadmap,
  type RoadmapLifts,
  type RoadmapSortMode,
} from "@/components/report/roadmapPriority";
import { ExpectedLiftBasis } from "@/components/report/ExpectedLiftBasis";
import { EFFORT_CLASS, fastestPathNames, IMPACT_CLASS, LEVEL_GLYPH, LEVEL_HEX, scoreHex } from "@/lib/ui";
import { PRACTICES } from "@/lib/practices";
import { Kicker, Surface } from "@/components/ui";

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

export function TrustLadder({ currentId }: { currentId: LevelId }) {
  const cur = LEVELS.findIndex((l) => l.id === currentId);
  const next = cur >= 0 && cur < LEVELS.length - 1 ? LEVELS[cur + 1] : null;
  return (
    <Surface radius="2xl" className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="type-body font-semibold text-white">Trust ladder</h2>
        <Kicker tone="muted">trust = adoption × rigor</Kicker>
      </div>
      <div className="mt-3 flex gap-1.5">
        {LEVELS.map((l, i) => {
          const reached = i <= cur;
          const isCurrent = i === cur;
          return (
            <div key={l.id} className="flex-1">
              <div className="h-1.5 rounded-full" style={{ backgroundColor: reached ? LEVEL_HEX[l.id] : "var(--color-divider)" }} />
              <div aria-hidden className="mt-1 type-body-sm leading-none" style={{ color: reached ? LEVEL_HEX[l.id] : "#475569" }}>
                {LEVEL_GLYPH[l.id]}
              </div>
              <div className={`mt-0.5 type-mono-sm ${isCurrent ? "text-white" : "text-slate-500"}`}>
                {l.id}
                {isCurrent ? " ◂ you" : ""}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 type-body-sm text-slate-400">
        {next
          ? `The next rung is ${next.id} ${next.name}: ${next.tagline}. The gaps below are inputs to explore on the way.`
          : "At the top of the ladder, the work now is sustaining trust and sharing what works."}
      </p>
    </Surface>
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

/** Headline of the cheapest combination of gaps to close to reach the next maturity band. */
export function NextLevelPath({ report }: { report: ScanReport }) {
  const path = cheapestPathToNextLevel(report);
  if (!path.target || !path.reachable || path.steps.length === 0) return null;
  const names = fastestPathNames(path.steps);
  return (
    <div className="mt-3 rounded-lg border border-accent/20 bg-accent/[0.06] p-3 type-body">
      <Kicker tone="accent">Fastest path</Kicker>
      <p className="mt-1 text-slate-300">
        Closing <span className="font-semibold text-white">{names}</span> projects to{" "}
        <span className="font-semibold text-white">~{path.projected.overallScore}/100</span>, enough to reach{" "}
        <span className="font-semibold" style={{ color: scoreHex(path.target.score) }}>
          {path.target.level} {path.target.name}
        </span>
        .
      </p>
    </div>
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
