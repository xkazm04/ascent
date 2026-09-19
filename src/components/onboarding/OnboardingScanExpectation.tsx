import { scanExpectationCopy, type ScanExpectationMode } from "@/components/onboarding/scanExpectation";

// The scan step's time expectation (Direction 9), in its own file so OnboardingScanStep.tsx stays
// under the 300-LOC cap. No hooks, no handlers — deliberately NOT marked "use client".
//
// Deliberately NOT rendered on two states:
//  - the RECONNECTED run, where ReconnectedNotice already says the run is alive and being followed,
//    and where this tab does not know when it started (an "up to 12 minutes" from now would be wrong);
//  - the DONE state, where there is nothing left to wait for.

export function ScanExpectation({
  repoCount,
  mode,
  hidden = false,
}: {
  repoCount: number;
  /** What the client can know about the engine. A live wizard run has no resolved provider, so it
   *  passes "unknown" and the copy states the slowest-provider ceiling ("Up to …"). */
  mode: ScanExpectationMode;
  /** Suppressed on the reconnected surface and the done screen. */
  hidden?: boolean;
}) {
  if (hidden) return null;
  const copy = scanExpectationCopy(repoCount, mode);
  if (!copy) return null;

  return (
    <p data-scan-expectation className="mt-2 type-body-sm text-slate-500">
      {copy} You can leave this tab open — the scan keeps running on the server.
    </p>
  );
}
