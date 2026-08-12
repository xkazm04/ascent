"use client";

import { ScanRowView, type ScanRow } from "@/components/onboarding/OnboardingScanRow";
import { InvitePanel } from "@/components/onboarding/OnboardingInvitePanel";
import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

// One-line, plain-language read of each maturity level for the onboarding legend (ONB-4) — the
// scores otherwise land with no interpretation. Keyed by level id; names come from the rubric.
const LEVEL_BLURB: Record<LevelId, string> = {
  L1: "Manual — AI used ad hoc, little shared tooling or guardrails.",
  L2: "Assisted — AI tooling adopted, basic tests/CI starting to form.",
  L3: "Augmented — shared AI guidance, CI gates, and tests are the norm.",
  L4: "Integrated — AI is in the loop with strong process + quality enforcement.",
  L5: "Autonomous — repeatable AI harness, evals, and trustworthy automation.",
};

/** The scanning + done phases: live region, progress bar, streamed rows, and (on done) a short
 *  dashboard handoff + the invite panel. (W6b trimmed the old activation checklist out of the done
 *  phase — the dashboard, not the wizard, is where activation continues.) */
export function ScanStep({
  phase,
  rows,
  error,
  announce,
  preview = false,
  previewCause = null,
  upgradePlanned = false,
  creditSkipped = 0,
  onCancel,
  onViewDashboard,
  onScanAnother,
  onRetryRepo,
  inviteOrg = null,
  onInvited,
}: {
  phase: "scanning" | "done";
  rows: Record<string, ScanRow>;
  error: string | null;
  announce: string;
  /** The scan was a deterministic PREVIEW (mock), not a real LLM scan — disclosed so the numbers
   *  aren't mistaken for live scores. */
  preview?: boolean;
  /** WHY the run was a preview, when the default explanation would misdiagnose: "credit_unknown"
   *  means the credit read failed (balance unknown, fail-closed) — the user may well have the App
   *  installed AND credits, so the banner must not tell them to install/top up. */
  previewCause?: "credit_unknown" | null;
  /** W6b: this preview was "fast preview first" — a LIVE upgrade scan is queued behind the one-shot
   *  handoff flag and auto-starts from the dashboard header. Switches the preview banner + done CTA
   *  to the handoff copy (the default "install the App / top up" recovery would misdiagnose). */
  upgradePlanned?: boolean;
  /** Repos the server deferred for insufficient credits — disclosed on the done screen so the run
   *  isn't presented as complete coverage when some repos were skipped. */
  creditSkipped?: number;
  onCancel: () => void;
  onViewDashboard: () => void;
  onScanAnother: () => void;
  /** Re-run a single errored repo. Without it one failed row out of ten costs the user the whole
   *  wizard — the only recovery was "Scan another", which resets the run back to the pick step. */
  onRetryRepo?: (repo: string) => void;
  /** When set (the GitHub-App path, where the viewer owns a real org), enables the invite panel
   *  on the done state — POSTs handles to that org as `viewer`. Null on the public-handle funnel. */
  inviteOrg?: string | null;
  /** Called after a successful invite so the wizard can mark the "invite your team" step done. */
  onInvited?: () => void;
}) {
  // Skipped (credit-deferred) rows are terminal too, so they count toward completion — otherwise the
  // progress bar would stay stuck below 100% on the done screen when some repos were skipped.
  const completed = Object.values(rows).filter((r) => r.level || r.error || r.skipped).length;
  const errorCount = Object.values(rows).filter((r) => r.error).length;
  const scanTotal = Object.keys(rows).length;
  const pct = scanTotal ? Math.round((completed / scanTotal) * 100) : 0;

  return (
    <div key={phase} className="animate-phase-in">
      {/* Polite live region — announces scan progress + completion for screen readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* ONB a11y #1: focus target for the step transition (focus moves here on phase change).
          h2, not h1: the page-level h1 lives in onboarding/page.tsx; a step-level h1 made two h1s
          coexist in the document (ambiguity-ui #4). Visual size is explicit, so nothing changes. */}
      <h2 data-step-heading tabIndex={-1} className="flex items-center gap-2 text-2xl font-bold text-white focus:outline-none">
        {phase === "done" && (
          <span
            aria-hidden
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-base ${
              errorCount > 0
                ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                : "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
            }`}
          >
            {errorCount > 0 ? "!" : "✓"}
          </span>
        )}
        {phase === "done" ? "Scan complete" : "Scanning repositories"}
      </h2>
      <p className="mt-1 text-slate-400">
        {phase === "done"
          ? errorCount > 0
            ? `Here's how your repositories scored — ${errorCount} couldn't be scanned.`
            : "Here's how your repositories scored."
          : `Scanning ${scanTotal} repositories…`}
      </p>

      {/* Progress bar (accessible) — eased width, role=progressbar. */}
      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Scan progress: ${completed} of ${scanTotal} repositories`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-sm tabular-nums text-slate-400">
          {pct}% · {completed}/{scanTotal}
        </span>
        {phase === "scanning" && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-danger/50 hover:text-danger-soft"
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-base text-danger-soft">
          {error}
        </p>
      )}

      <div className="mt-5 space-y-1.5">
        {Object.values(rows).map((row) => (
          <ScanRowView key={row.repo} row={row} onRetry={onRetryRepo} />
        ))}
      </div>

      {phase === "done" && preview && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
          {upgradePlanned ? (
            // Preview-then-upgrade: the live scan is queued, not missing — the default recovery copy
            // ("install the App / top up") would misdiagnose a fully set-up, paying org.
            <>
              These are <strong>preview</strong> scores — instant estimates, nothing charged. Your{" "}
              <strong>live scan is queued</strong>: open the dashboard and it starts automatically,
              replacing these previews in place while you look around.
            </>
          ) : previewCause === "credit_unknown" ? (
            // The credit read failed (balance unknown) — the user may have the App AND credits, so the
            // default "install the App" recovery copy would misdiagnose. Explain the real cause + the
            // real recovery: nothing was charged; scan again once the balance is readable.
            <>
              These are <strong>preview</strong> scores — we couldn&apos;t verify your credit balance
              (a temporary error), so this scan ran as a free preview and <strong>no credits were
              used</strong>. Your setup is fine: use &quot;Scan another&quot; or rescan from the
              dashboard to retry with live numbers.
            </>
          ) : (
            <>
              These are <strong>preview</strong> scores — a fast, illustrative estimate. For live numbers,
              install the GitHub App and run a real scan (it draws prepaid credits) from the dashboard.
            </>
          )}
        </p>
      )}

      {phase === "done" && creditSkipped > 0 && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
          {creditSkipped} {creditSkipped === 1 ? "repository was" : "repositories were"}{" "}
          <strong>skipped — out of credits</strong>. Top up your prepaid balance, then scan the rest from the dashboard.
        </p>
      )}

      {phase === "done" && (
        <>
          {/* ONB-4: a compact "what your score means" legend, so the scores land with meaning. */}
          <details className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <summary className="cursor-pointer font-mono text-sm uppercase tracking-widest text-slate-400 hover:text-white">
              How maturity levels work
            </summary>
            <ul className="mt-2 space-y-1.5">
              {LEVELS.map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-sm text-slate-300">
                  <span aria-hidden className={`mt-0.5 ${LEVEL_CLASSES[l.id as LevelId]?.text ?? "text-slate-400"}`}>
                    {LEVEL_GLYPH[l.id as LevelId]} {l.id}
                  </span>
                  <span>{LEVEL_BLURB[l.id as LevelId] ?? l.name}</span>
                </li>
              ))}
            </ul>
          </details>

          {/* W6b handoff: the wizard's job ends here — activation (alerts, schedules, practices,
              goals) continues on the dashboard, which now renders for this org even before the live
              scan lands. The old in-wizard activation checklist duplicated that surface and is gone. */}
          <p className="mt-6 max-w-xl text-slate-400">
            {upgradePlanned
              ? "Your dashboard is live — the preview above is being upgraded to a full live scan the moment you open it. You can browse every tab while it runs."
              : "Your dashboard is live — alerts, rescan schedules, and the rest of the setup continue there."}
          </p>

          {/* Invite teammates at peak motivation (App path only) — grants viewer access to the
              scanned org via the RBAC backend. No GitHub App install needed for the invitee. */}
          {inviteOrg && <InvitePanel inviteOrg={inviteOrg} onInvited={onInvited} />}

          <div className="mt-6 flex gap-3">
            <button
              onClick={onViewDashboard}
              className="rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              {upgradePlanned ? "Open dashboard — live scan starts there" : "View dashboard"}
            </button>
            <button
              onClick={onScanAnother}
              className="rounded-lg border border-slate-700 px-4 py-2.5 text-base text-slate-300 hover:border-slate-600"
            >
              Scan another
            </button>
          </div>
        </>
      )}
    </div>
  );
}
