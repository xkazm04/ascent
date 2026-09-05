// PER-REPO RETRY on the done screen.
//
// One failed row out of ten used to cost the user the entire wizard: the only recovery was "Scan
// another", which resetRun()s everything back to the pick step — selection, rows, scores, checklist,
// all gone. This re-runs JUST the errored repo through the same import path, transitioning that one
// row error → scanning → done/error while every sibling row (and the preview banner, credit
// disclosure, and checklist) stays exactly as it was.
//
// Written as a function over injected deps rather than a closure inside useOnboardingFlow: the hook is
// already a dense module (the 300-LOC spirit for .ts), and this way the retry is directly testable.

import type { Dispatch, SetStateAction } from "react";
import { runImportScan } from "@/components/onboarding/importScan";
import { classifyScanFailure } from "@/components/onboarding/scanGate";
import { resolveScanMode, type CreditRead } from "@/components/onboarding/scanMode";
import type { OrgCredit } from "@/components/onboarding/OnboardingFlow.model";
import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";

export interface RepoRetryDeps {
  fullName: string;
  sourceLabel: string;
  sourceInstallId: string | null;
  credit: OrgCredit | null;
  creditReady: { current: Promise<CreditRead> | null };
  fetchCredit: (org: string) => Promise<CreditRead>;
  /** In-flight retries: the synchronous double-click guard AND the unmount abort registry. */
  retries: { current: Map<string, AbortController> };
  setRows: Dispatch<SetStateAction<Record<string, ScanRow>>>;
  setAnnounce: Dispatch<SetStateAction<string>>;
}

export async function runRepoRetry(deps: RepoRetryDeps): Promise<void> {
  const { fullName, sourceLabel, sourceInstallId, credit, creditReady, fetchCredit, retries, setRows, setAnnounce } =
    deps;

  // Synchronous guard (the wizard's established pattern, OnboardingFlow.tsx): the second half of a
  // double-click lands before any re-render, so only a ref can stop the duplicate POST.
  if (retries.current.has(fullName)) return;
  if (!sourceLabel) return;
  const controller = new AbortController();
  retries.current.set(fullName, controller);
  // Back to the non-terminal state — the row renders "scanning…" again, and ONLY this key changes.
  setRows((cur) => (cur[fullName] ? { ...cur, [fullName]: { repo: fullName } } : cur));
  setAnnounce(`Retrying ${fullName}.`);

  try {
    // Re-check the money gate exactly as the batch did: a retry must not charge an org whose balance
    // drained mid-run, nor downgrade a paying org to a mock.
    const { canRunReal } = await resolveScanMode({
      sourceInstallId,
      sourceLabel,
      credit,
      creditReady,
      fetchCredit,
    });
    const outcome = await runImportScan(
      { org: sourceLabel, repos: [fullName], installationId: sourceInstallId ?? undefined, mock: !canRunReal },
      controller,
      {
        // Only ever write the key being retried: a stray event for another repo must not resurrect or
        // overwrite a sibling row that already settled.
        onRepo: ({ repo, level, overall, error, skipped }) => {
          if (repo !== fullName) return;
          setRows((cur) => ({ ...cur, [repo]: { repo, level, overall, error, skipped } }));
          setAnnounce(`${repo} finished.`);
        },
        onResult: () => {
          // The stream ended with no event for this repo — the server deferred it (credits), the same
          // resolution the batch applies to its leftovers. Never leave a perpetual "scanning…" row.
          setRows((cur) => {
            const row = cur[fullName];
            if (!row || row.level || row.error || row.skipped) return cur;
            return { ...cur, [fullName]: { ...row, skipped: "insufficient_credits" } };
          });
        },
        onError: (message) => setRows((cur) => ({ ...cur, [fullName]: { repo: fullName, error: message } })),
      },
    );
    if (!outcome.ok) {
      setRows((cur) => ({ ...cur, [fullName]: { repo: fullName, error: retryRowMessage(outcome, sourceLabel) } }));
      setAnnounce(`${fullName} could not be scanned.`);
    }
  } finally {
    retries.current.delete(fullName);
  }
}

/** The short, human line a failed retry leaves in the row. An ACCESS refusal must not put a raw API
 *  string on screen here either (the gate step owns that copy); anything else keeps its diagnostic. */
export function retryRowMessage(
  outcome: { aborted: boolean; stalled: boolean; message?: string; status?: number },
  org: string,
): string {
  if (outcome.aborted) return outcome.stalled ? "Stalled. Try again." : "Canceled.";
  const gate = classifyScanFailure({ status: outcome.status, message: outcome.message }, org);
  if (gate?.kind === "signin") return "Sign in to rescan.";
  if (gate?.kind === "personal") return "Personal workspaces don't run org scans.";
  if (gate?.kind === "no-access") return "No access to this organization.";
  return outcome.message ?? "Scan failed.";
}
