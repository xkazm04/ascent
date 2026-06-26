"use client";

import { useState } from "react";
import { OnboardingChecklist, type ChecklistStep } from "@/components/onboarding/OnboardingChecklist";
import { ScanRowView, type ScanRow } from "@/components/onboarding/OnboardingScanRow";
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

/** The scanning + done phases: live region, progress bar, streamed rows, and (on done) the
 *  activation checklist + dashboard CTAs. */
export function ScanStep({
  phase,
  rows,
  error,
  announce,
  preview = false,
  creditSkipped = 0,
  checklistSteps,
  onCancel,
  onViewDashboard,
  onScanAnother,
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
  /** Repos the server deferred for insufficient credits — disclosed on the done screen so the run
   *  isn't presented as complete coverage when some repos were skipped. */
  creditSkipped?: number;
  checklistSteps: ChecklistStep[];
  onCancel: () => void;
  onViewDashboard: () => void;
  onScanAnother: () => void;
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

  // Invite-teammates state (App path only). Grants viewer access to the scanned org via the existing
  // owner-gated members endpoint — the onboarding user owns the org they installed the App on.
  const [handle, setHandle] = useState("");
  const [invited, setInvited] = useState<string[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  async function invite() {
    const login = handle.trim().replace(/^@/, "");
    if (!login || !inviteOrg) return;
    setInviteBusy(true);
    setInviteErr(null);
    try {
      const res = await fetch("/api/org/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: inviteOrg, login, role: "viewer" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't add that teammate.");
      setInvited((xs) => (xs.includes(login) ? xs : [...xs, login]));
      setHandle("");
      onInvited?.();
    } catch (e) {
      setInviteErr(e instanceof Error ? e.message : "Couldn't add that teammate.");
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div key={phase} className="animate-phase-in">
      {/* Polite live region — announces scan progress + completion for screen readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* ONB a11y #1: focus target for the step transition (focus moves here on phase change). */}
      <h1 data-step-heading tabIndex={-1} className="flex items-center gap-2 text-2xl font-bold text-white focus:outline-none">
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
      </h1>
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
          <ScanRowView key={row.repo} row={row} />
        ))}
      </div>

      {phase === "done" && preview && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
          These are <strong>preview</strong> scores — a fast, illustrative estimate. For live numbers,
          install the GitHub App and run a real scan (it draws prepaid credits) from the dashboard.
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

          <div className="mt-6">
            <OnboardingChecklist steps={checklistSteps} />
          </div>

          {/* Invite teammates at peak motivation (App path only) — grants viewer access to the
              scanned org via the RBAC backend. No GitHub App install needed for the invitee. */}
          {inviteOrg && (
            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <h2 className="text-base font-semibold text-white">Invite your team</h2>
              <p className="mt-1 text-sm text-slate-400">
                Add teammates as viewers on <span className="font-mono text-slate-300">{inviteOrg}</span> so they can see
                the dashboard. They&apos;ll need a GitHub login — no App install required.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-slate-600">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && invite()}
                  placeholder="github-handle"
                  aria-label="Teammate's GitHub handle"
                  className="w-48 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
                />
                <button
                  onClick={invite}
                  disabled={inviteBusy || !handle.trim()}
                  className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
                >
                  {inviteBusy ? "Adding…" : "Invite"}
                </button>
              </div>
              {invited.length > 0 && (
                <p className="mt-2 font-mono text-sm text-emerald-300">
                  Added as viewer: {invited.map((l) => `@${l}`).join(", ")}
                </p>
              )}
              {inviteErr && <p className="mt-2 font-mono text-sm text-orange-300">{inviteErr}</p>}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={onViewDashboard}
              className="rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              View dashboard
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
