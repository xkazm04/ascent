// The import REQUEST plan: how one wizard run translates the settled money-gate decision
// (scanMode.ts) plus the user's two select-step choices (preview-first, autoscan opt-in) into the
// exact { mock, watch, schedule } the import POST carries — and whether a live UPGRADE run is owed
// afterwards. Pure so the whole matrix is pinnable by tests; useOnboardingFlow only wires it.
//
// The one subtle row is `upgradeAfter`:
//   - It exists ONLY on the App path with real headroom (`canRunReal` and an installation). The
//     public funnel is excluded on purpose — its live run is already free-and-real in the wizard,
//     and the dashboard's /api/org/scan (membership + App token) is unreachable for it anyway.
//   - An upgrade run imports as `mock: true` (the instant preview) but must ALSO `watch: true`
//     regardless of the autoscan opt-in: the header's live upgrade goes through /api/org/scan,
//     which scans WATCHED repos only — an unwatched preview would leave the upgrade with nothing to
//     scan. Watching alone is fleet bookkeeping, not a standing spend; the RECURRING draw is the
//     schedule, so a user who didn't opt in gets `schedule: "off"` — watched, never auto-billed.
//   - When the user opted into the weekly autoscan, the schedule rides along unchanged.
// Every non-upgrade row is byte-identical to the pre-W6b behavior (watch = opt-in, schedule
// defaulted by runImportScan, mock = !canRunReal).

export interface ImportPlan {
  /** Request the instant deterministic preview instead of live inference. */
  mock: boolean;
  /** Enroll the scanned repos in the org watchlist (required for the header's live upgrade). */
  watch: boolean;
  /** Explicit cadence override; undefined lets runImportScan apply its weekly default under watch. */
  schedule: "off" | "weekly" | undefined;
  /** A live upgrade run is owed after this import — write the one-shot handoff flag on success. */
  upgradeAfter: boolean;
}

export function resolveImportPlan(args: {
  /** Money gate verdict for this run (scanMode.ts): real inference is affordable/entitled. */
  canRunReal: boolean;
  /** This is the token-less public funnel — real, free, and outside the upgrade choreography. */
  publicFunnel: boolean;
  /** App-path installation id (null on the public-handle path). */
  sourceInstallId: string | null;
  /** The select step's "fast preview first" choice. */
  previewFirst: boolean;
  /** The select step's recurring weekly autoscan opt-in. */
  watchOptIn: boolean;
}): ImportPlan {
  const { canRunReal, publicFunnel, sourceInstallId, previewFirst, watchOptIn } = args;
  const upgradeAfter = canRunReal && !publicFunnel && Boolean(sourceInstallId) && previewFirst;
  if (upgradeAfter) {
    return {
      mock: true,
      watch: true,
      schedule: watchOptIn ? "weekly" : "off",
      upgradeAfter: true,
    };
  }
  return {
    mock: !canRunReal,
    watch: watchOptIn,
    schedule: undefined,
    upgradeAfter: false,
  };
}
