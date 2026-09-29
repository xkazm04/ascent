"use client";

// THE LOOP COCKPIT — the Live tab's default view. One dominant object (the observatory) and one
// right rail that is only ever showing ONE thing: what you have selected, what is running, or what a
// run did. The rail's mode is derived from the run's own lifecycle rather than from a tab bar,
// because at any moment exactly one of those three is the interesting question.
//
// A DRIVE is a fourth: a sequence of runs re-measured against the fleet's own green predicate after
// every one of them (src/lib/local/drive.ts). It outranks the run mode while it is pulling, because
// during a drive the interesting question is "is debt falling and how much rope is left", not "what
// is this one run doing" — and it settles into the SAME outcome ledger a single run does, with a
// verdict banner above it saying which of the three honest stops ended it.
//
// THE STANDING RUNNER (2026-09-18) is a drive too — a `continuous` one — and rides the same state:
// started from the setup dialog (`CockpitSetupDialog`), watched in the rail (`CockpitRunnerPanel`),
// stopped from the masthead, with a per-repo Resume in the rail beside the Ledger's.
//
// THE RAIL NEVER ENTERS OUTCOME MODE (wave-2). The outcome is a full-width SHEET under the grid
// (`OutcomeSection`) — one row per gap, one column per run — which also absorbed the history strip's
// job. A settled run still drifts the field and is still `setOutcome`'d; the rail simply keeps showing
// the inspector, with the selection intact, because the outcome now has a better place to be.
//
// This file is the ENTRY: it picks the composition by theme (v1 = the shipped layout, v2 = Prism) and owns the props
// contract both take. The state is `useLiveCockpitView`; each composition is layout only.

import type { ThemeId } from "@/lib/theme/theme";
import { LiveCockpitV1 } from "./LiveCockpit.v1";
import { LiveCockpitV2 } from "./LiveCockpit.v2";
import type { LoopRunDetail, LoopRunRecord, LoopRunSummary } from "./loopTypes";
import type { ObservatoryHistory, ObservatorySeed } from "../observatory";

export interface LiveCockpitProps {
  slug: string;
  /** The scoped fleet standing — the same seeds the wall gets, plus `scannedAt`. */
  seeds: ObservatorySeed[];
  histories: ObservatoryHistory[];
  /** Repos with a local pairing; empty on managed cloud. */
  pairedRepos: string[];
  /** The standing runner's default scope — every WATCHED repo with a paired checkout, the list the
   *  drive route resolves when no repos are sent. Absent = `pairedRepos` (which may include unwatched
   *  repos the server will skip). */
  runnerRepos?: string[];
  activeRun: LoopRunRecord | null;
  runs: LoopRunSummary[];
  /** The details of the listed runs (bounded), for the outcome matrix. Empty on managed cloud. */
  runDetails?: LoopRunDetail[];
  /** The server's render instant, so relative ages survive hydration unchanged. */
  nowMs?: number;
  /** `autopilotEnabled()` at render time — the ASCENT_AUTOPILOT gate. */
  loopEnabled: boolean;
  selfHosted: boolean;
  isOwner: boolean;
  /** `?view=wall`, with the tab's other params preserved. */
  wallHref: string;
  /** The Live view switch's targets, the tab's other params preserved (`liveViewHref`). */
  ledgerHref?: string;
  cockpitHref?: string;
  /** The look the server resolved (`getTheme()`). Absent or `altimeter` = the shipped composition; `prism` = v2. */
  theme?: ThemeId;
}

export function LiveCockpit(props: LiveCockpitProps) {
  return props.theme === "prism" ? <LiveCockpitV2 {...props} /> : <LiveCockpitV1 {...props} />;
}
