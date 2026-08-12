// "Fast preview first" — the W6b default for a first App-path import: run the instant mock preview
// NOW (real pipeline, deterministic scores, ~8s/repo, disclosed as preview) and start the LIVE scan
// from the dashboard header right after, where its stream survives tab navigation and the engine-
// aware dedup upgrades each preview row in place.
//
// Same two-consumer store shape as OnboardingSelectStep.watchOptIn (the sibling this mirrors): the
// checkbox lives in the select step's cost disclosure while `startScan` inside useOnboardingFlow
// reads the value synchronously — one source of truth, so the disclosed behavior and the committed
// request can never drift. Default is ON: the preview costs nothing (mock runs no inference), so ON
// is the safe direction — turning it OFF is what moves the credit draw earlier, into the wizard.
// `resetPreviewFirst()` restores the default when a run is reset ("Scan another").

let previewFirst = true;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Subscribe (useSyncExternalStore contract). Returns the unsubscribe. */
export function subscribePreviewFirst(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current choice. Default TRUE — preview now, live upgrade on the dashboard. */
export function getPreviewFirst(): boolean {
  return previewFirst;
}

export function setPreviewFirst(next: boolean): void {
  if (previewFirst === next) return;
  previewFirst = next;
  emit();
}

/** Back to the default. Called when a run is reset so one run's choice can't leak into the next. */
export function resetPreviewFirst(): void {
  setPreviewFirst(true);
}
