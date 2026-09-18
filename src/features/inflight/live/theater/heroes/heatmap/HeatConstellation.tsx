// THE CONSTELLATION — the fleet at the map's edge, one star per repo (heatFleet.ts), and the map's
// legend. A star's mark says its state at a glance: filled and lit in its phase colour when a lane
// works it, a hollow ring when it waits for a slot, amber when paused, dim when resting. Static:
// nothing here moves unless the pulse changed what it says.

import type { LanePhase } from "@/lib/local/runner-types";
import { Kicker } from "@/components/ui";
import { HeatMiniMap } from "./HeatMiniMap";
import type { FleetStar, StarState } from "./heatFleet";

const LIT: Partial<Record<LanePhase, string>> = {
  "agent-reading": "bg-accent shadow-[0_0_14px_2px] shadow-accent/60",
  "agent-editing": "bg-warn shadow-[0_0_14px_2px] shadow-warn/60",
  committing: "bg-success-soft shadow-[0_0_14px_2px] shadow-success/50",
  landing: "bg-success-soft shadow-[0_0_14px_2px] shadow-success/50",
  "agent-quiet": "bg-slate-500",
};
const MARK: Record<StarState, string> = {
  working: "bg-slate-100",
  queued: "border-2 border-slate-300",
  waiting: "border-2 border-slate-400",
  paused: "border-2 border-amber-400 bg-amber-400/20",
  resting: "bg-slate-600",
  seen: "bg-slate-700",
};
const WORDS: Record<StarState, string> = {
  working: "text-slate-300",
  queued: "text-slate-400",
  waiting: "text-slate-400",
  paused: "text-amber-300",
  resting: "text-slate-500",
  seen: "text-slate-500",
};

function Star({ star, now }: { star: FleetStar; now: number }) {
  const mark = star.state === "working" && star.phase ? (LIT[star.phase] ?? MARK.working) : MARK[star.state];
  return (
    <li data-star={star.repo} data-state={star.state} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={`h-3.5 w-3.5 shrink-0 rounded-full min-[2400px]:h-6 min-[2400px]:w-6 ${mark}`} />
        <span className={`truncate type-title font-semibold min-[2400px]:text-4xl ${star.state === "working" ? "text-white" : "text-slate-300"}`}>{star.name}</span>
      </div>
      <p className={`pl-[1.625rem] type-body-sm min-[2400px]:pl-9 min-[2400px]:text-2xl ${WORDS[star.state]}`}>{star.words}</p>
      {star.ahead || star.landings ? (
        <p className="pl-[1.625rem] font-mono type-caption text-slate-400 min-[2400px]:pl-9 min-[2400px]:text-xl">
          {[
            star.landings ? <span key="l" className="text-success-soft">✓ {star.landings} landed</span> : null,
            star.ahead ? <span key="a">{star.ahead} ready to merge</span> : null,
          ]
            .filter(Boolean)
            .flatMap((x, i) => (i ? [<span key={`s${i}`}> · </span>, x] : [x]))}
        </p>
      ) : null}
      {star.map ? (
        <div className="pl-[1.625rem] min-[2400px]:pl-9">
          <HeatMiniMap repo={star.map} now={now} />
        </div>
      ) : null}
    </li>
  );
}

function Swatch({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`h-3.5 w-5 rounded-sm border min-[2400px]:h-6 min-[2400px]:w-9 ${cls}`} />
      {label}
    </span>
  );
}

export function HeatConstellation({ stars, now }: { stars: readonly FleetStar[]; now: number }) {
  return (
    <aside aria-label="Fleet" className="flex w-64 shrink-0 flex-col gap-4 border-l border-divider pl-5 min-[2400px]:w-[30rem] min-[2400px]:pl-8">
      <Kicker tone="muted" className="tracking-[0.22em] min-[2400px]:text-2xl">
        Fleet
      </Kicker>
      <ul className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
        {stars.map((s) => (
          <Star key={s.repo} star={s} now={now} />
        ))}
      </ul>
      <div aria-label="Map legend" className="flex flex-col gap-1.5 border-t border-divider pt-3 type-body-sm text-slate-400 min-[2400px]:text-2xl">
        <Swatch cls="border-accent bg-accent/70" label="read" />
        <Swatch cls="border-warn bg-warn/80" label="edited" />
        <span>tiles cool as the agent goes quiet</span>
        <span className="text-success-soft">✓ landed here</span>
      </div>
    </aside>
  );
}
