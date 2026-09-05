// The roadmap tab's two LEVEL callouts — where this repo sits on the trust ladder, and the cheapest
// combination of gaps that reaches the next rung. Pure relocation out of roadmapPieces.tsx, which sat
// at 298/300 lines and had to shed some before it could carry the shared first-step line (AGENTS.md:
// a file approaching the limit is the signal to extract). Both are re-exported from roadmapPieces, so
// no call site or test mock changes. Behaviour is unchanged; no hooks, no handlers — server-safe.

import type { LevelId, ScanReport } from "@/lib/types";
import { LEVELS } from "@/lib/maturity/model";
import { cheapestPathToNextLevel } from "@/lib/scoring/engine";
import { fastestPathNames, LEVEL_GLYPH, LEVEL_HEX, scoreHex } from "@/lib/ui";
import { Kicker, Surface } from "@/components/ui";

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
