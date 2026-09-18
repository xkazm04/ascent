"use client";

// THE STANDING RUNNER, in the setup dialog (spark theater-upgrade, 2026-09-18) — what the operator
// sets (scope, daily ceiling) and what they cannot (the fixed summary), side by side.
//
// THE FIXED SUMMARY IS SHOWN, NOT HIDDEN. Three things about the runner are decided by the product,
// not the dialog: where its work lands, that every lane plans first, and what pauses it. An operator
// starting something that runs until stopped is owed those sentences BEFORE they press Start — a rule
// they meet later, as a surprise, is a rule they will read as a bug.
//
// THE CEILING IS TYPED, NOT PICKED: it is money, and the right figure is the operator's. `0` is the
// explicit "no ceiling"; an EMPTY box is an error (`parseCeilingUsd`), never a silent "no ceiling".
// The default is the contract's (`DEFAULT_SPEND_CEILING_MICROS`), read back in dollars, so the dialog
// and the route cannot disagree about what "default" means.

import { TextInput } from "@/components/ui";
import { REPO_FAILURE_STREAK, RUNNER_BRANCH } from "@/lib/local/runner-types";
import { Segmented, SetupRow } from "./RunSetupControls";
import { SetupGroup, type SetupSectionProps } from "./RunSetupSections";
import { parseCeilingUsd } from "./startInputs";

/** What the runner does that this dialog cannot change — in the order it happens. */
export const RUNNER_DOES: readonly string[] = [
  `Lands verified work on each repo's ${RUNNER_BRANCH} branch — your working branch is never touched`,
  "Plans every lane first; only architecture moves wait for you",
  `Pauses on: spend ceiling, session limit, ${REPO_FAILURE_STREAK} failed lanes on a repo, a branch conflict`,
];

export function RunnerDoes() {
  return (
    <section data-testid="runner-does" className="mt-5 rounded-lg border border-divider bg-surface/40 px-4 py-3">
      <h3 className="type-label tracking-[0.22em] text-slate-400">What the runner does · fixed</h3>
      <ul className="mt-2 space-y-1">
        {RUNNER_DOES.map((line) => (
          <li key={line} className="type-body-sm leading-relaxed text-slate-300">
            <span aria-hidden className="mr-2 text-slate-600">·</span>
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RepoChips({ repos }: { repos: readonly string[] }) {
  if (repos.length === 0) return <p className="type-note text-warn">No repos in this scope.</p>;
  return (
    <ul data-testid="runner-scope-repos" className="flex flex-wrap gap-1">
      {repos.slice(0, 12).map((r) => (
        <li key={r} className="rounded border border-divider px-1.5 py-px type-caption text-slate-400" title={r}>
          {r.split("/")[1] ?? r}
        </li>
      ))}
      {repos.length > 12 && <li className="type-caption text-slate-600">+{repos.length - 12} more</li>}
    </ul>
  );
}

export interface RunnerSectionProps extends SetupSectionProps {
  /** The default scope as this page knows it: every watched repo with a paired checkout. */
  repos: readonly string[];
  /** The rail's runnable selection — the alternative scope. */
  selection: readonly string[];
}

export function RunnerSection({ dials, onChange, repos, selection }: RunnerSectionProps) {
  const ceiling = parseCeilingUsd(dials.spendCeiling);
  const all = dials.runnerScope === "all";
  return (
    <SetupGroup title="The standing runner">
      <SetupRow
        label="Repos"
        info="The runner works each repo's backlog, then its craft ladder, indefinitely. By default that is every watched repo with a paired checkout — the same scope a drive defaults to — resolved by the server when the runner starts."
      >
        <Segmented
          ariaLabel="Runner scope"
          testId="setup-runner-scope"
          value={dials.runnerScope}
          onChange={(v) => onChange("runnerScope", v)}
          options={[
            { value: "all", label: "Every watched, paired repo" },
            {
              value: "selection",
              label: `The ${selection.length} selected`,
              disabled: selection.length === 0,
              title: selection.length === 0 ? "Select paired repos on the sky chart first" : undefined,
            },
          ]}
        />
      </SetupRow>
      <RepoChips repos={all ? repos : selection} />
      <SetupRow
        label="Daily spend ceiling (USD)"
        info="The whole runner pauses until local midnight (server time) once today's agent spend reaches it, and carries on by itself after."
      >
        <TextInput
          aria-label="Daily spend ceiling in US dollars"
          data-testid="setup-spend-ceiling"
          inputMode="decimal"
          value={dials.spendCeiling}
          onChange={(e) => onChange("spendCeiling", e.target.value)}
        />
      </SetupRow>
      {!ceiling.ok && <p className="type-note leading-relaxed text-danger">{ceiling.error}</p>}
      <p className="type-note leading-relaxed text-slate-500">
        0 means no ceiling. The session-limit breaker is always on: if the agent hits the account&apos;s session limit, the
        runner pauses until it resets.
      </p>
    </SetupGroup>
  );
}
