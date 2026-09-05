// Opt-in state for the onboarding import's RECURRING weekly autoscan enrolment.
//
// The defect this closes: the App path committed every scanned repo to `watch:true, schedule:"weekly"`
// with no control anywhere in the wizard. `runImportScan` defaults `watch` to `Boolean(installationId)`
// and the server defaults it to `true` (api/org/import/route.ts), so clicking "Scan N repos" silently
// enrolled N repos in a standing, billable weekly draw. Disclosure without a switch is not consent —
// the enrolment is now OFF unless the user ticks the box on the select step.
//
// Why a store and not a prop: the checkbox lives in the select step's cost disclosure, while the value
// is read by `startScan` inside `useOnboardingFlow`. Threading it would mean widening the SelectStep →
// OnboardingFlow → hook prop chain through a component outside this change's scope. A two-consumer
// module store with `useSyncExternalStore` keeps ONE source of truth (the checkbox renders from the
// same value startScan reads — they cannot drift) and stays synchronously readable from the async
// startScan body. `resetAutoWatchOptIn()` returns it to the safe default on "Scan another".

let optedIn = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Subscribe (useSyncExternalStore contract). Returns the unsubscribe. */
export function subscribeAutoWatchOptIn(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current opt-in. Default FALSE — a wizard run that never touches the checkbox must not enroll. */
export function getAutoWatchOptIn(): boolean {
  return optedIn;
}

export function setAutoWatchOptIn(next: boolean): void {
  if (optedIn === next) return;
  optedIn = next;
  emit();
}

/** Back to the safe default. Called when a run is reset so one run's choice can't leak into the next. */
export function resetAutoWatchOptIn(): void {
  setAutoWatchOptIn(false);
}
