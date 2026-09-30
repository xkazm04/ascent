// This-period value, fleet signals, and the trajectory. Composers stay the single source of the sentences.
import { Eyebrow, Frame, KeyValue, Lede, SectionHead, type KeyValueItem } from "@/components/kit";
import {
  briefingLoopProofLine,
  briefingProofLine,
  briefingTrajectory,
  briefingTrajectoryNote,
  engineMixCaveat,
  engineMixLabel,
  mockDisclosure,
  movementLine,
  valueRealizedHeading,
  valueRealizedLine,
  type ExecBriefing,
} from "@/lib/org/briefing";

export function executiveValue(briefing: ExecBriefing) {
  const line = valueRealizedLine(briefing.valueRealized, briefing.realScoredCount);
  const proof = briefingProofLine(briefing.proof);
  const loop = briefingLoopProofLine(briefing.loopProof);
  if (!line && !proof && !loop) return null;
  return (
    <Frame>
      <SectionHead
        eyebrow="This period"
        title={line ? valueRealizedHeading(briefing.valueRealized) : "Proof of the work"}
        lede={line ?? undefined}
      />
      {(proof || loop) && (
        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          {proof && (
            <div>
              <Eyebrow>Shipped</Eyebrow>
              <Lede className="mt-2">{proof}</Lede>
            </div>
          )}
          {loop && (
            <div>
              <Eyebrow>In review</Eyebrow>
              <Lede className="mt-2">{loop}</Lede>
            </div>
          )}
        </div>
      )}
    </Frame>
  );
}

export function executiveSignals(briefing: ExecBriefing) {
  const items: KeyValueItem[] = [];
  if (briefing.adoptionRate != null) {
    items.push({ key: "Fleet adoption", value: `${briefing.adoptionRate}% at high-adoption posture` });
  }
  const moved = movementLine(briefing.movement, briefing.realScoredCount);
  if (moved) items.push({ key: "Movement", value: moved });
  const cohort = briefing.benchmark?.cohort;
  if (cohort?.overallPercentile != null) {
    const adoption = cohort.adoptionPercentile != null ? ` · ${cohort.adoptionPercentile}th on AI adoption` : "";
    items.push({
      key: "Peer cohort",
      value: `${cohort.overallPercentile}th percentile vs ${cohort.repos} ${cohort.language} repos${adoption}`,
    });
  }
  const mock = mockDisclosure(briefing);
  if (mock) items.push({ key: "Mock scores", value: mock });
  if (briefing.engineMix.length > 0) {
    items.push({
      key: "Scored by",
      value: engineMixLabel(briefing.engineMix),
      hint: engineMixCaveat(briefing.engineMix) ?? undefined,
    });
  }
  if (items.length === 0) return null;
  return (
    <Frame>
      <SectionHead eyebrow="Signals" title="How these figures" named="were measured" />
      <KeyValue items={items} className="mt-4" />
    </Frame>
  );
}

export function executiveTrajectory(briefing: ExecBriefing, periodHasStart: boolean) {
  const traj = briefingTrajectory(briefing);
  const note = briefingTrajectoryNote(briefing);
  if (!traj.headline && !traj.insufficiency && briefing.regressionCount === 0) return null;
  const sentence = traj.headline ?? traj.insufficiency ?? "Not enough history yet to project a trajectory.";
  const n = briefing.regressionCount;
  return (
    <Frame>
      <SectionHead eyebrow="Trajectory" title={traj.headline ? "Projected forward" : "Not projected"} named="from this fit" lede={sentence} />
      {traj.headline && note ? <p className="mt-3 type-body-sm text-slate-400">{note}</p> : null}
      {n > 0 ? (
        <p className="mt-2 type-body-sm text-slate-200">
          <span aria-hidden className="type-body">▲ </span>
          <span className="sr-only">At risk: </span>
          {n} repo{n === 1 ? "" : "s"} regressed {periodHasStart ? "this period" : "since last scan"}.
        </p>
      ) : null}
    </Frame>
  );
}
