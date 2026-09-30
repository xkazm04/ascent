// Masthead figures for the Prism passports tab. Counts only: a cohort total is a real count (zero
// means none of the passports in view sit there), and a placeholder is labelled as a floor.
import type { MastheadFigure } from "@/components/kit";
import { COHORT_META, cohortOf } from "@/lib/org/passport-display";
import type { PassportRow } from "./PassportTable";

export function passportFigures(rows: PassportRow[]): MastheadFigure[] {
  let ready = 0;
  let gap = 0;
  let placeholder = 0;
  for (const r of rows) {
    const cohort = cohortOf(r.autoScore, r.prodScore);
    if (cohort === "ready") ready += 1;
    else if (cohort === "gap") gap += 1;
    if (r.placeholder) placeholder += 1;
  }
  return [
    { label: "Ready to ship", value: ready, tone: ready > 0 ? "good" : undefined, detail: COHORT_META.ready.blurb },
    {
      label: "Automatable, not production-ready",
      value: gap,
      tone: gap > 0 ? "watch" : undefined,
      detail: COHORT_META.gap.blurb,
    },
    {
      label: "Placeholder scans",
      value: placeholder,
      tone: placeholder > 0 ? "watch" : undefined,
      detail: placeholder > 0 ? "A floor, not a grade" : "None in this view",
    },
  ];
}
