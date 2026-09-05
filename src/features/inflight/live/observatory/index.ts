// Public surface of the observatory (the live tab's fleet sky chart).

export {
  FIELD,
  OBSERVATORY_THRESHOLD,
  QUADRANT_LABEL,
  QUADRANT_POSTURE,
  frontier,
  isPlotted,
  layoutBodies,
  projectX,
  projectY,
  quadrantOf,
} from "./observatoryModel";
export type {
  LayoutOpts,
  ObservatoryBody,
  ObservatoryHistory,
  ObservatoryHistoryPoint,
  ObservatoryScope,
  ObservatorySeed,
  PlottedBody,
  QuadrantId,
  TrailPoint,
} from "./observatoryModel";

export { clusterBodies, driftPath, driftPoint, isCluster, lassoHitTest, pointInPolygon, rectPolygon } from "./observatoryGeometry";
export type { ObservatoryCluster, ObservatoryItem, Pt } from "./observatoryGeometry";

export { DRIFT_MS, driftFrames, lerpHex, prefersReducedMotion, useDriftProgress } from "./observatoryMotion";
export type { DriftFrame } from "./observatoryMotion";

export { ObservatoryField } from "./ObservatoryField";
export type { ObservatoryDrift, ObservatoryFieldProps } from "./ObservatoryField";
export { ObservatoryList } from "./ObservatoryList";
export type { ObservatoryListProps } from "./ObservatoryList";
