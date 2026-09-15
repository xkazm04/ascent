// The /org shared visual kit — the barrel every wave of the redesign imports.
//
// `import { ... } from "@/components/org/viz"` is the ONLY entry point a feature directory should
// use. Nothing here fetches, and nothing here imports from `src/features/**`: the dependency runs
// one way, features → kit.

export {
  HATCH_ID,
  HATCH_STROKE,
  HATCH_TILE,
  DECLARED_DASH,
  VOID_DASH,
  SUPERSEDED_OPACITY,
  DEFAULT_BASE,
  KICKER_SVG_CLASS,
  STATE_HINT,
  STATE_LABEL,
  VIZ_STATES,
  VizDefs,
  isStruck,
  isVoid,
  rendersValue,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
} from "./states";
export type { VizState } from "./states";

export { clamp, finite, fmtNum, isNum, pct, r2 } from "./vizNum";

export { concentrationOf } from "./lorenz";
export type { Concentration, LorenzPoint } from "./lorenz";

export { StateSwatch } from "./StateSwatch";
export { Legend } from "./Legend";
export type { LegendExtra } from "./Legend";
export { WhyChip } from "./WhyChip";

export { Distribution } from "./Distribution";
export type { DistributionProps } from "./Distribution";
export { BandLadder } from "./BandLadder";
export type { LadderBand, LadderEdge } from "./BandLadder";
export { BudgetPack } from "./BudgetPack";
export type { Omission } from "./BudgetPack";
export { FlowRibbon } from "./FlowRibbon";
export type { FlowStage } from "./FlowRibbon";
export { StateTrack } from "./StateTrack";
export type { TrackRow, TrackSegment } from "./StateTrack";
export { MatrixGrid } from "./MatrixGrid";
export type { MatrixCell, MatrixRow } from "./MatrixGrid";
export { ConcentrationCurve } from "./ConcentrationCurve";
