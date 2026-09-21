"use client";

// PROTOTYPE ROUND (spark theater-upgrade, WP8) — MISSION-CONTROL LANES.
//
// One wide band per active repo, stacked in a stable order (by repo, so a lane never jumps), each read
// left to right from across the room: the repo and where it is on plan → baseline → agent → check →
// commit → land; the PHASE WORD, huge; the files it is touching arriving live as chips; the diff so
// far; the time used of the watchdog ceiling. Below the bands, the rest of the fleet as compact rows —
// waiting for a slot, paused with the reason, resting, finished — so the whole fleet is on one screen.
//
// Everything that moves is a real event (mission/missionTokens.ts carries the budget): a file first
// touched, a diff re-measured, a phase change, a landing — or the page clock the shell freezes on a
// stale pulse. The trail is accumulated across pulses (mission/missionAccumulate.ts) and says so.

import { useMissionAccumulator } from "./mission/useMissionAccumulator";
import { arrivedLive } from "./mission/missionAccumulate";
import { laneView, showsBand } from "./mission/missionModel";
import { emptyStatement, queueRows, summaryLines } from "./mission/missionQueue";
import { MissionLane } from "./mission/MissionLane";
import { MissionEmpty, MissionFleetRows } from "./mission/MissionFleetRows";
import { densityScale } from "./mission/missionTokens";
import type { TheaterHeroProps } from "../theaterHeroSlot";

export function MissionHero({ pulse, now, reducedMotion }: TheaterHeroProps) {
  const acc = useMissionAccumulator(pulse);
  const ordered = [...pulse.lanes].sort((a, b) => a.repo.localeCompare(b.repo) || a.laneId.localeCompare(b.laneId));
  const banded = ordered.filter((l) => showsBand(l, pulse.latest, now));
  const finished = ordered.filter((l) => !banded.includes(l));
  const views = banded.map((l) => laneView(l, acc.lanes[l.laneId], pulse.latest, now));
  const rows = queueRows(pulse, finished, now);
  const scale = densityScale(banded.length);
  const empty = views.length === 0 ? emptyStatement(pulse, now) : null;
  return (
    <section aria-label="Lanes at work" data-hero-slot="mission" className="flex min-h-0 flex-1 flex-col gap-[1.4vh] px-6 py-[2vh]">
      <ul className="sr-only" aria-label="Summary">
        {summaryLines(views, rows, acc).map((line) => (
          <li key={line}>{line}</li>
        ))}
        {empty ? <li>{`${empty.headline}. ${empty.sub}${empty.wake ? ` ${empty.wake.label} at ${empty.wake.clock}.` : ""}`}</li> : null}
      </ul>
      {empty ? (
        <MissionEmpty statement={empty} scale={1} />
      ) : (
        <ul aria-hidden className="flex min-h-0 flex-1 flex-col gap-[1.4vh]">
          {views.map((v) => {
            const laneAcc = acc.lanes[v.lane.laneId];
            return (
              <MissionLane
                key={laneAcc?.session ?? v.lane.laneId}
                view={v}
                acc={laneAcc}
                now={now}
                scale={scale}
                enter={arrivedLive(acc, laneAcc)}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </ul>
      )}
      <MissionFleetRows rows={rows} scale={Math.min(1, scale + 0.1)} />
    </section>
  );
}
