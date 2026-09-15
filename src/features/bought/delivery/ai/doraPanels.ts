// The four delivery-outcome readings, prepared for the small-multiple. Pure.
//
// ON "SHARED SCALE". The two RATE panels (change-failure, attribution coverage) genuinely share the
// 0–100 axis, and drawing them on it is what lets a reader compare them without arithmetic. Deploys
// per week and hours-to-next-success do not share a unit with those or with each other, so each
// carries its own domain, printed at the end of its track. Forcing all four onto one numeric axis
// would be the dual-axis mistake in a new costume; what is shared is the GEOMETRY — same track
// length, same height, same position for the figure — which is what makes four panels read as one
// instrument.
//
// A reading the sample floor withholds is `missing`, not zero. `MIN_DEPLOYMENTS` exists precisely so
// that one bad deploy out of one is never reported as a 100% failure rate, and a void track is the
// only drawing that keeps that refusal legible.

import { MIN_DEPLOYMENTS, type DeliveryOutcomes } from "@/lib/db/delivery-outcomes";
import type { VizState } from "@/components/org/viz";

export interface DoraPanel {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  /** The end of this panel's own track. */
  domainMax: number;
  /** Whether a higher value is the good news — decides the tone ramp at the call site. */
  higherIsBetter: boolean;
  state: VizState;
  /** The one sentence this reading needs, disclosed on a WhyChip. Never printed standing. */
  hint: string;
  sub: string;
}

/** Snap a raw max up to a "nice" 1/2/5×10^k so a count/hours track ends on a readable number. */
export function niceCeil(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

const state = (v: number | null): VizState => (v == null ? "missing" : "measured");

export function doraPanels(o: DeliveryOutcomes): DoraPanel[] {
  return [
    {
      id: "frequency",
      label: "Deploys / week",
      value: o.perWeek,
      unit: "",
      domainMax: niceCeil(Math.max(1, o.perWeek ?? 0)),
      higherIsBetter: true,
      state: state(o.perWeek),
      hint: "Successful deployments per week over the window's own span, from the GitHub Deployments API. A repository that deploys another way contributes nothing here.",
      sub: "successful only",
    },
    {
      id: "failure",
      label: "Change-failure rate",
      value: o.failureRate,
      unit: "%",
      domainMax: 100,
      higherIsBetter: false,
      state: state(o.failureRate),
      hint: `"Failure" means the deployment failed — not that the change caused an incident, which nothing here observes. Rates under ${MIN_DEPLOYMENTS} deployments are withheld rather than stated.`,
      sub: o.failureRate == null ? `under ${MIN_DEPLOYMENTS} deployments` : `${o.failed} of ${o.total} failed`,
    },
    {
      id: "restore",
      label: "Time to next success",
      value: o.medianRestoreHours,
      unit: "h",
      domainMax: niceCeil(Math.max(1, o.medianRestoreHours ?? 0)),
      higherIsBetter: false,
      state: state(o.medianRestoreHours),
      hint: "The median interval from a failed deployment to the next successful one in the same environment — a proxy for restore time, not a measurement of it.",
      sub: "median, after a failure",
    },
    {
      id: "coverage",
      label: "Attribution coverage",
      value: o.coverage,
      unit: "%",
      domainMax: 100,
      higherIsBetter: true,
      state: state(o.coverage),
      hint: "The share of deployments matched to a merged change by sha equality. It is what the authorship split below is worth: a rate over 12 of 51 deployments means something very different from one over 49. Merge trains, tag-based deploys and pre-tracking scans land in the unmatched remainder and are never defaulted into a bucket.",
      sub: `${o.attributed} of ${o.total} matched a change`,
    },
  ];
}
