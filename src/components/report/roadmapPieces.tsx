import type { DimensionId, Effort, Impact, LevelId, LlmRoadmapItem, ScanReport } from "@/lib/types";
import { DIMENSION_BY_ID, LEVELS } from "@/lib/maturity/model";
import { cheapestPathToNextLevel, projectDimensionClose } from "@/lib/scoring/engine";
import { DIMENSION_SHORT, EFFORT_CLASS, IMPACT_CLASS, LEVEL_GLYPH, LEVEL_HEX, scoreHex } from "@/lib/ui";
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
    <div className={className ?? "flex items-center gap-2 text-sm"}>
      <span className={`${chip} ${IMPACT_CLASS[item.impact]}`}>impact{sep}{item.impact}</span>
      <span className={`${chip} ${EFFORT_CLASS[item.effort]}`}>effort{sep}{item.effort}</span>
    </div>
  );
}

export function ExploreList({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-divider bg-slate-950/40 p-3">
      <Kicker tone="accent">Explore</Kicker>
      <ul className="mt-1.5 space-y-1 text-base text-slate-300">
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

export function TrustLadder({ currentId }: { currentId: LevelId }) {
  const cur = LEVELS.findIndex((l) => l.id === currentId);
  const next = cur >= 0 && cur < LEVELS.length - 1 ? LEVELS[cur + 1] : null;
  return (
    <Surface radius="2xl" className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Trust ladder</h2>
        <Kicker tone="muted">trust = adoption × rigor</Kicker>
      </div>
      <div className="mt-3 flex gap-1.5">
        {LEVELS.map((l, i) => {
          const reached = i <= cur;
          const isCurrent = i === cur;
          return (
            <div key={l.id} className="flex-1">
              <div className="h-1.5 rounded-full" style={{ backgroundColor: reached ? LEVEL_HEX[l.id] : "#1e293b" }} />
              <div aria-hidden className="mt-1 text-sm leading-none" style={{ color: reached ? LEVEL_HEX[l.id] : "#475569" }}>
                {LEVEL_GLYPH[l.id]}
              </div>
              <div className={`mt-0.5 font-mono text-sm ${isCurrent ? "text-white" : "text-slate-500"}`}>
                {l.id}
                {isCurrent ? " ◂ you" : ""}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-slate-400">
        {next
          ? `Next rung — ${next.id} ${next.name}: ${next.tagline}. The gaps below are inputs to explore on the way.`
          : "Top of the ladder — the work now is sustaining trust and sharing what works."}
      </p>
    </Surface>
  );
}

const IMPACT_RANK: Record<Impact, number> = { high: 3, medium: 2, low: 1 };
const EFFORT_RANK: Record<Effort, number> = { low: 1, medium: 2, high: 3 };
const priorityScore = (it: LlmRoadmapItem) => IMPACT_RANK[it.impact] * 10 - EFFORT_RANK[it.effort];
const isQuickWin = (it: LlmRoadmapItem) => it.impact === "high" && it.effort !== "high";

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
  const names = path.steps.map((s) => DIMENSION_SHORT[s.dimension]).join(" + ");
  return (
    <div className="mt-3 rounded-lg border border-accent/20 bg-accent/[0.06] p-3 text-base">
      <Kicker tone="accent">Fastest path</Kicker>
      <p className="mt-1 text-slate-300">
        Closing <span className="font-semibold text-white">{names}</span> projects to{" "}
        <span className="font-semibold text-white">~{path.projected.overallScore}/100</span> — enough to reach{" "}
        <span className="font-semibold" style={{ color: scoreHex(path.target.score) }}>
          {path.target.level} {path.target.name}
        </span>
        .
      </p>
    </div>
  );
}

/** Prioritized, numbered next-steps for public scans — quick wins first. */
export function RoadmapSteps({ items, report }: { items: LlmRoadmapItem[]; report: ScanReport }) {
  const ordered = [...items].sort((a, b) => priorityScore(b) - priorityScore(a));
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
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 font-mono text-base text-slate-300">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  {quick && (
                    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-sm font-semibold uppercase tracking-widest text-emerald-300">
                      ⚡ Quick win
                    </span>
                  )}
                </div>
                {item.rationale && (
                  <p className="mt-1.5 text-base leading-relaxed text-slate-400">{item.rationale}</p>
                )}
                <ExploreList items={item.explore} />
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
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
