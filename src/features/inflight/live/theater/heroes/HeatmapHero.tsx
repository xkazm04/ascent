"use client";

// PROTOTYPE ROUND (spark theater-upgrade, WP8) — THE CODEBASE HEAT MAP.
//
// Each working lane's repo drawn as a treemap of its modules, built from the paths the lane touched —
// accumulated across pulses, so the map is "as far as the agent has explored it since this screen
// opened", and says so. A file GLOWS cool when read and BURNS warm when edited, and cools by time
// since its last touch, so a quiet agent visibly cools (heatStyle.ts). A landing STAMPS the modules
// its session edited, then rests as a badge. The fleet (waiting, paused, resting repos) sits at the
// edge as a constellation. Everything lives in ./heatmap/; this file only chooses what to show.

import type { LanePulse, LoopPulse } from "@/lib/local/runner-types";
import type { TheaterHeroProps } from "../theaterHeroSlot";
import { HeatConstellation } from "./heatmap/HeatConstellation";
import { HeatEmptyMap } from "./heatmap/HeatEmptyMap";
import { laneOfRepo } from "./heatmap/heatFold";
import { fleetStars } from "./heatmap/heatFleet";
import { HeatLanePanel } from "./heatmap/HeatLanePanel";
import { panelModel } from "./heatmap/heatPanelModel";
import { fleetSentence, panelSentence } from "./heatmap/heatSummary";
import type { HeatAcc, RepoHeat } from "./heatmap/heatTypes";
import { useHeatAcc } from "./heatmap/useHeatAcc";

/** Big panels at most; the rest of the fleet is stars. */
export const MAX_PANELS = 4;
/** With no lane working, the most recently touched maps stay up — cooling — this many. */
const MAX_RESTING = 2;

interface Panel {
  lane: LanePulse | null;
  repo: RepoHeat | null;
  key: string;
}

export function heroPanels(pulse: LoopPulse, acc: HeatAcc): Panel[] {
  const working = laneOfRepo(pulse.lanes)
    .filter((l) => l.phase !== "done" && l.phase !== "queued")
    .sort((a, b) => a.repo.localeCompare(b.repo))
    .slice(0, MAX_PANELS);
  if (working.length) return working.map((l) => ({ lane: l, repo: acc.repos[l.repo] ?? null, key: l.repo }));
  return Object.values(acc.repos)
    .filter((r) => r.files.length > 0)
    .sort((a, b) => (b.lastTouchAt ?? 0) - (a.lastTouchAt ?? 0))
    .slice(0, MAX_RESTING)
    .map((r) => ({ lane: null, repo: r, key: r.repo }));
}

function emptyWords(pulse: LoopPulse): { title: string; sub: string } {
  const sub = "The map draws itself from the files an agent opens — cool when it reads, warm when it edits.";
  const phase = pulse.runner?.phase;
  if (!pulse.runner) return { title: "No agent is in the code", sub };
  if (phase === "paused") return { title: "Paused — no agent is in the code", sub: "Nothing opens a file while the runner is paused; the map resumes with it." };
  if (phase === "idle") return { title: "Every repo is resting", sub: "Each repo is backing off after dry runs; its map draws itself here when it wakes." };
  if (pulse.waiting.length) return { title: "Waiting for a run slot", sub };
  return { title: "Between lanes — no agent is in the code", sub };
}

const GRID: Record<number, string> = { 1: "grid-cols-1 grid-rows-1", 2: "grid-cols-2 grid-rows-1", 3: "grid-cols-3 grid-rows-1", 4: "grid-cols-2 grid-rows-2" };

export function HeatmapHero({ pulse, now, reducedMotion }: TheaterHeroProps) {
  const acc = useHeatAcc(pulse, now);
  const panels = heroPanels(pulse, acc);
  const stars = fleetStars(pulse, acc, now, new Set(panels.map((p) => p.key)));
  const empty = emptyWords(pulse);
  const lines = panels.map((p) => panelSentence(panelModel(p.lane, p.repo, now), p.repo, now));
  const fleet = fleetSentence(stars);
  return (
    <section
      aria-label={panels.length ? `Code heat map: ${lines[0]}` : `Code heat map: ${empty.title}`}
      data-hero-slot="heatmap"
      className="flex min-h-0 flex-1 gap-6 px-6 py-5 min-[2400px]:gap-10 min-[2400px]:px-10 min-[2400px]:py-8"
    >
      <div className={`grid min-h-0 min-w-0 flex-1 gap-6 min-[2400px]:gap-10 ${GRID[Math.max(1, panels.length)]}`}>
        {panels.length ? (
          panels.map((p) => <HeatLanePanel key={p.key} lane={p.lane} repo={p.repo} now={now} reducedMotion={reducedMotion} />)
        ) : (
          <div className="relative min-h-0">
            <HeatEmptyMap planning={false} title={empty.title} sub={empty.sub} />
          </div>
        )}
      </div>
      {stars.length ? <HeatConstellation stars={stars} now={now} /> : null}
      <ul className="sr-only" data-testid="heat-summary">
        {(panels.length ? lines : [`${empty.title}.`]).map((l) => (
          <li key={l}>{l}</li>
        ))}
        {fleet ? <li>{fleet}</li> : null}
      </ul>
    </section>
  );
}
