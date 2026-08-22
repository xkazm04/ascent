// Public surface of the loop cockpit (the Live tab's default view).

export { LiveCockpit } from "./LiveCockpit";
export type { LiveCockpitProps } from "./LiveCockpit";
export { CockpitSetup } from "./CockpitSetup";
export type { CockpitSetupState } from "./CockpitSetup";
export { useLoopRun } from "./useLoopRun";
export { LANE_STOPS, laneActiveStop, laneCaption, laneIsLive, laneMarkerPct, laneStopIndex } from "./laneStages";
export type { LaneStop, LanePosition } from "./laneStages";
export { isOrgWide, proposalDimensions, shareLine, sharedDimensions } from "./cockpitDimensions";
export type { DimensionShare, SharedDimensions } from "./cockpitDimensions";
export { driftFor, runLift, scanningRepos } from "./cockpitDrift";
export type { CockpitDrift } from "./cockpitDrift";
export type { CockpitMode, LoopProposal, LoopStatusPayload } from "./loopTypes";
