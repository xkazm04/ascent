// The data the Overview ledger renders from. Serialisable, derived once on the server in OverviewFleetPanel.

import type { Forecast } from "@/lib/maturity/forecast";
import type { TrendPoint } from "@/components/report/TrendChart";
import type { ScoreBadge } from "./OrgScoreBadges";
import type { HeatRow } from "./RepoDimensionHeatmap";
import type { RepoTrajectory } from "./repoTrajectory";

/** Everything the Overview renders from — serialisable, derived once on the server. */
export interface OverviewLedgerData {
  slug: string;
  /** The tab's current query string, threaded into deep links so scope survives a jump. */
  search: string;
  periodTitle: string;
  sortDim?: string;
  badges: ScoreBadge[];
  trend: { points: TrendPoint[]; label: string };
  /** The rollup's forward-looking fit over the maturity trend. Already computed on the landing path;
   *  the card gates it on presentability and renders nothing below the gate. */
  forecast: Forecast | null;
  postureCounts: Record<string, number>;
  dims: { dimId: string; avg: number }[];
  dimDeltas: { dimId: string; delta: number; cohortSize: number }[] | null;
  deltaLabel: string;
  trajectories: RepoTrajectory[];
  heatmapRows: HeatRow[];
}
