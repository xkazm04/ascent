// ONE LANE, ONE BAND — read left to right from across the room: WHO (repo, cycle, where on the stage
// track), WHAT (the phase word, huge; what the agent last said; the files it is touching, arriving
// live), HOW MUCH (the diff so far; the time used of the watchdog ceiling). The left rule glows with
// the age of the newest real event and cools to nothing as the lane goes silent. A landing washes the
// band green and lights the whole track, then the band clears (the next session, or a finished row).

import { repoShort } from "../../theaterFormat";
import { chipCounts, stripChips, type LaneAcc } from "./missionAccumulate";
import { decay, type LaneTone, type LaneView } from "./missionModel";
import { DeadlineRing } from "./DeadlineRing";
import { DiffCounter } from "./DiffCounter";
import { FileStrip } from "./FileStrip";
import { MissionPhaseWord } from "./MissionPhaseWord";
import { StageTrack } from "./StageTrack";
import { BAND_COLUMNS, fs, LANDED_WASH_S, STRIP_VISIBLE, TYPE } from "./missionTokens";

const RULE: Record<LaneTone, string> = {
  working: "bg-accent",
  quiet: "bg-slate-600",
  landed: "bg-success",
  held: "bg-amber-400",
  failed: "bg-danger",
  done: "bg-slate-500",
};

function trailCaption(acc: LaneAcc | undefined): string {
  const { total, edited } = chipCounts(acc);
  if (total === 0) return "No file touched yet";
  const scope = acc?.complete ? "this session" : "since this screen opened";
  return `${total} ${total === 1 ? "file" : "files"} · ${edited} edited — ${scope}`;
}

export function MissionLane({
  view,
  acc,
  now,
  scale,
  enter,
  reducedMotion,
}: {
  view: LaneView;
  acc: LaneAcc | undefined;
  now: number;
  scale: number;
  /** The session began while the screen watched: the band fades up once (it is keyed by session). */
  enter: boolean;
  reducedMotion: boolean;
}) {
  const { lane, tone } = view;
  const repo = repoShort(lane.repo);
  const quiet = tone === "quiet";
  const landed = tone === "landed";
  const wash = reducedMotion ? "" : `transition-[background-color,border-color] ${enter ? "animate-fade-up" : ""}`;
  const noteFresh = acc?.note ? decay(acc.note.at, now) : 0;
  return (
    <li
      data-lane={lane.laneId}
      data-tone={tone}
      data-quiet={quiet || undefined}
      className={`relative grid min-h-0 flex-1 items-stretch gap-x-[2.2vw] overflow-hidden rounded-2xl border pl-[2vw] pr-[1.6vw] ${wash} ${
        landed ? "border-success/45 bg-success/10" : "border-divider bg-surface/40"
      }`}
      style={{ gridTemplateColumns: BAND_COLUMNS, paddingBlock: `${(1.6 * scale).toFixed(2)}vh`, transitionDuration: `${LANDED_WASH_S}s` }}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[0.4vw] min-w-[5px] ${RULE[tone]}`}
        style={{ opacity: tone === "working" ? 0.3 + 0.7 * view.glow : 0.85, transition: reducedMotion ? undefined : "opacity 1s linear" }}
      />

      <div className="flex min-w-0 flex-col justify-center" style={{ gap: `${(3.2 * scale).toFixed(2)}vh` }}>
        <div className="min-w-0">
          <p className={`truncate font-semibold leading-none tracking-tight ${quiet ? "text-slate-300" : "text-white"}`} style={fs(TYPE.repo, scale)}>
            {repo}
          </p>
          <p className="mt-[0.5em] font-mono uppercase tracking-[0.18em] text-slate-500" style={fs(TYPE.label, scale)}>
            cycle {lane.cycle}
            {lane.turns ? ` · ${lane.turns} turns` : ""}
          </p>
        </div>
        <StageTrack stage={view.stage} tone={tone} scale={scale} reducedMotion={reducedMotion} />
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-[1.1vh]">
        <MissionPhaseWord phaseKey={view.phaseKey} word={view.word} sub={view.sub} tone={tone} scale={scale} reducedMotion={reducedMotion} />
        {/* The agent's own last words — dropped when four or more lanes share the slot (density). */}
        {acc?.note && !landed && scale >= 0.8 ? (
          <p
            className="truncate italic text-slate-300"
            style={{ ...fs(TYPE.meta, scale * 0.92), opacity: quiet ? 0.45 : 0.55 + 0.45 * noteFresh, transition: reducedMotion ? undefined : "opacity 1s linear" }}
            title={acc.note.text}
          >
            “{acc.note.text}”
          </p>
        ) : null}
        <div className="flex min-w-0 flex-col gap-[0.5vh] py-[3px]">
          <FileStrip repo={repo} chips={stripChips(acc, STRIP_VISIBLE)} now={now} quiet={quiet || landed} scale={scale} reducedMotion={reducedMotion} />
          <p className="font-mono text-slate-500" style={fs(TYPE.label, scale)}>
            {trailCaption(acc)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-[1.6vw]">
        <DiffCounter diff={lane.diffStat} scale={scale} dim={quiet} reducedMotion={reducedMotion} />
        {view.ring ? (
          <DeadlineRing key={acc?.session ?? lane.laneId} repo={repo} ring={view.ring} scale={scale} dim={quiet} landed={landed} reducedMotion={reducedMotion} />
        ) : null}
      </div>
    </li>
  );
}
