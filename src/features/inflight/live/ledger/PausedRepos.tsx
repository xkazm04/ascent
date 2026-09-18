"use client";

// WHAT THE RUNNER IS WAITING ON A PERSON FOR, beside the plan inbox: a runner-wide pause (its reason and
// when it lifts) and every repository paused on a breaker only a person clears — each with Resume
// (owner). A repo resting after dry runs is not here: it lifts itself on a timer and is not asking.

import { useState } from "react";
import { fmtIn, shortRepo } from "./ledgerFormat";
import { REPO_PAUSE_WORDS, RUNNER_PAUSE_WORDS, needsOperator } from "./ledgerModel";
import { resumeRepo } from "./ledgerClient";
import type { DriveStatus } from "./ledgerTypes";

export function PausedRepos({
  slug,
  runner,
  now,
  isOwner,
  onResumed,
}: {
  slug: string;
  runner: DriveStatus | null;
  now: string;
  isOwner: boolean;
  onResumed: (drive: DriveStatus) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!runner) return null;
  const paused = (runner.repoState ?? []).filter(needsOperator);
  const runnerPaused = runner.phase === "paused";
  if (!runnerPaused && paused.length === 0) return null;

  const resume = async (repo: string) => {
    setBusy(repo);
    setErrors((e) => ({ ...e, [repo]: "" }));
    try {
      onResumed(await resumeRepo(slug, repo));
    } catch (e) {
      setErrors((prev) => ({ ...prev, [repo]: e instanceof Error ? e.message : "Could not resume." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="ledger-paused" className="space-y-2">
      {runnerPaused && (
        <p className="rounded-lg border border-warn/40 px-4 py-2.5 type-body-sm text-slate-200">
          <span className="text-warn">The whole runner is paused</span> — {runner.pausedReason ? RUNNER_PAUSE_WORDS[runner.pausedReason] : "a breaker fired"}
          {fmtIn(runner.pausedUntil, now) ? `; it lifts ${fmtIn(runner.pausedUntil, now)}.` : "."}
        </p>
      )}
      {paused.length > 0 && (
        <ul className="divide-y divide-divider rounded-lg border border-divider">
          {paused.map((r) => (
            <li key={r.repo} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="type-body-sm text-slate-200">
                  <span className="font-mono" title={r.repo}>{shortRepo(r.repo)}</span>
                  <span className="text-warn"> paused — {r.paused ? REPO_PAUSE_WORDS[r.paused] : "paused"}</span>
                </p>
                {r.note && <p className="type-caption text-slate-500">{r.note}</p>}
                {errors[r.repo] && (
                  <p role="alert" className="type-caption text-danger">
                    {errors[r.repo]}
                  </p>
                )}
              </div>
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => void resume(r.repo)}
                  disabled={busy !== null}
                  className="focus-ring rounded-lg border border-divider px-3 py-1.5 type-caption text-slate-200 hover:border-accent disabled:opacity-50"
                >
                  {busy === r.repo ? "Resuming…" : "Resume"}
                </button>
              ) : (
                <span className="type-caption text-slate-500" title="Resuming a repository spends agent sessions — an owner's decision.">
                  owner resumes
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
