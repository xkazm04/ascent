// Foundation grid cells. A draft PR is partial (proposed, not observed). No Ascent PR is unmeasured:
// a hand-committed foundation is invisible here, so it is not "missing". Conformance null is
// unmeasured, never zero. A reported percent stays a paper figure beside the word "reported".
import type { CellState } from "@/components/kit";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import type { ReportBackState, ReportBackStatus } from "@/lib/github/reportback-credential";

export interface FoundationMark {
  state: CellState;
  word: string;
}

export function foundationPrMark(row: FoundationRolloutRow): FoundationMark {
  return row.foundationPrAt
    ? { state: "partial", word: "PR opened" }
    : { state: "unmeasured", word: "No Ascent PR" };
}

/** The row's report-back state. A hand-built row with no `reportBack` falls back to `reportBackAt`. */
export function reportBackOf(row: FoundationRolloutRow): ReportBackStatus {
  return row.reportBack ?? (row.reportBackAt ? { state: "live" } : { state: "none" });
}

const BACK_MARK: Record<ReportBackState, FoundationMark> = {
  live: { state: "met", word: "Provisioned" },
  "legacy-shared": { state: "partial", word: "Legacy shared" },
  failed: { state: "missing", word: "Failed" },
  "credential-revoked": { state: "missing", word: "Credential revoked" },
  none: { state: "missing", word: "Not provisioned" },
};

/** Live is the only "Provisioned". A legacy shared credential still reports, but is one rotation from
 *  silence; a failed write and a retired credential cannot report at all. */
export function foundationBackMark(row: FoundationRolloutRow): FoundationMark {
  return BACK_MARK[reportBackOf(row).state];
}

export const BACK_TITLE: Record<ReportBackState, string> = {
  live: "This repo holds its own live report-back credential.",
  "legacy-shared": "Provisioned under the old org-wide shared credential. Re-provision to give this repo its own.",
  failed: "The last provision attempt failed, so Ascent wrote no working credential here.",
  "credential-revoked": "The credential written into this repo has since been revoked. Its CI cannot report.",
  none: "Ascent has written no report-back secrets here. That is not 'off': the repo may still run .ai/doctor.mjs locally, unseen.",
};

export type ReportBackAction =
  | { kind: "provision" | "revoke"; label: string }
  | { kind: "configure"; label: string; href: string };

/** The one action that fits the row's state. */
export function reportBackAction(row: FoundationRolloutRow): ReportBackAction {
  const back = reportBackOf(row);
  switch (back.state) {
    case "live":
      return { kind: "revoke", label: "Remove" };
    case "legacy-shared":
    case "credential-revoked":
      return { kind: "provision", label: "Re-provision" };
    case "failed":
      return back.reason === "missing-permission" && back.configureUrl
        ? { kind: "configure", label: "Grant Secrets write", href: back.configureUrl }
        : { kind: "provision", label: "Retry" };
    default:
      return { kind: "provision", label: "Set up report-back" };
  }
}

export function foundationConformanceMark(row: FoundationRolloutRow): FoundationMark {
  return row.conformance == null
    ? { state: "unmeasured", word: "not measured" }
    : { state: "met", word: "reported" };
}
