// THE RUNNER BRANCH, per repository: which base it merges into, how many commits it holds that the base
// does not, what landed last, the failure and dry streaks, any pause — and, for an owner on a
// self-hosted deployment, "Merge runner into <base>".
//
// "Commits ahead" is read from git at load (`readAheadCounts`); a count git could not produce prints
// "unknown", never 0 — zero means "nothing to merge", and an unknown shown as zero would hide work.
// The card lists the newest runner's repos even after it stopped: work on a stopped runner's branch is
// still the operator's to merge.

import Link from "next/link";
import { SectionEmpty } from "@/components/org/shared/ui";
import { LedgerSectionHeader } from "./LedgerSectionHeader";
import { fmtIn, plural, shortRepo, shortSha } from "./ledgerFormat";
import { LEDGER_ANCHOR, REPO_PAUSE_WORDS, RUNNER_BRANCH } from "./ledgerModel";
import { RunnerMerge } from "./RunnerMerge";
import type { DriveStatus, RunnerMergeResponse } from "./ledgerTypes";

export interface RunnerCardProps {
  slug: string;
  runner: DriveStatus | null;
  live: boolean;
  ahead: Record<string, number | null>;
  now: string;
  isOwner: boolean;
  selfHosted: boolean;
  cockpitHref: string;
  onMerged: (repo: string, result: RunnerMergeResponse) => void;
}

export function RunnerCard({ slug, runner, live, ahead, now, isOwner, selfHosted, cockpitHref, onMerged }: RunnerCardProps) {
  const repos = runner?.repoState ?? [];
  return (
    <section id={LEDGER_ANCHOR.runner} aria-labelledby="ledger-runner-h" className="scroll-mt-24 space-y-3">
      <LedgerSectionHeader
        id="ledger-runner-h"
        title="Runner branch"
        count={repos.length > 0 ? `${repos.length} ${repos.length === 1 ? "repo" : "repos"}` : null}
        about={`Verified work accumulates on ${RUNNER_BRANCH} in each repository and reaches your branch only when you merge it.`}
        // A stopped runner is a STATE, not a description: it stays on the page, beside the title.
        right={
          runner && !live ? (
            <span className="type-body-sm text-slate-500">Stopped — its branches keep what it landed</span>
          ) : undefined
        }
      />
      {repos.length === 0 ? (
        <SectionEmpty>
          {runner ? "The runner has not resolved a repository yet." : "No runner has worked here yet."}{" "}
          <Link href={cockpitHref} className="text-accent hover:text-accent-soft">
            Start one from the Cockpit
          </Link>
        </SectionEmpty>
      ) : (
        <ul className="divide-y divide-divider rounded-2xl border border-divider">
          {repos.map((r) => {
            const n = ahead[r.repo];
            const lifts = fmtIn(r.pausedUntil, now);
            return (
              <li key={r.repo} data-testid="runner-repo" className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0 space-y-1">
                  <p className="type-body text-slate-100">
                    <span className="font-mono" title={r.repo}>{shortRepo(r.repo)}</span>
                    <span className="type-caption text-slate-500"> → {r.baseBranch ?? "base not resolved yet"}</span>
                  </p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 type-caption tabular-nums text-slate-400">
                    <span data-testid="runner-ahead" title="Commits on the runner branch that the base branch does not have — what a merge would bring in.">
                      {n == null ? "ahead: unknown" : `${plural(n, "commit")} ahead`}
                    </span>
                    <span title="The runner branch's tip after the last landing.">last landed {shortSha(r.lastLandedSha)}</span>
                    <span title="Consecutive failed or guard-rejected lanes; three pause the repository.">{plural(r.failureStreak, "failure")} in a row</span>
                    <span title="Consecutive runs with no verified close; each backs the repository off for longer.">{plural(r.dryStreak, "dry run")} in a row</span>
                  </p>
                  {r.paused && (
                    <p className="type-caption text-warn">
                      Paused — {REPO_PAUSE_WORDS[r.paused]}
                      {lifts ? `, lifts ${lifts}` : ""}
                      {r.note ? <span className="text-slate-500"> · {r.note}</span> : null}
                    </p>
                  )}
                </div>
                {isOwner && selfHosted && r.baseBranch ? (
                  <RunnerMerge slug={slug} repo={r.repo} base={r.baseBranch} ahead={n ?? null} onMerged={onMerged} />
                ) : (
                  <span className="type-caption text-slate-500">
                    {!selfHosted ? "Merging needs the self-hosted checkout." : !isOwner ? "An owner merges the runner branch." : "Waiting for the base branch."}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
