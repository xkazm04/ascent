"use client";

// The PERSONAL-TIER handoff, shown when the wizard's target is the viewer's individual workspace.
//
// The wizard has no personal branch: an individual who installs the App on their own GitHub account
// and picks it hit requireFleetOrg's 403, whose message quotes an internal API route ("track repos
// via /api/me/watch…") straight at an end user. This is the SLICE the direction asked for — detect,
// refuse kindly, hand off — not a full personal onboarding.
//
// It also carries the work forward: the chosen PUBLIC repos are written to the personal watchlist
// through the existing /api/me/watch contract (identity-gated, public-verified, capped at 10, which
// is exactly the wizard's own selection cap), so the user arrives at /me with their picks already
// tracked rather than starting over.

import { useRef, useState } from "react";
import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { eligibleForPersonalWatch, trackPersonalRepos } from "@/components/onboarding/personalWatch";
import type { OrgRepo } from "@/components/onboarding/types";

export function PersonalHandoff({ org, selectedRepos }: { org: string; selectedRepos: OrgRepo[] }) {
  const eligible = eligibleForPersonalWatch(selectedRepos);
  const privateCount = selectedRepos.length - eligible.length;
  const [busy, setBusy] = useState(false);
  const [tracked, setTracked] = useState<string[] | null>(null);
  const [refused, setRefused] = useState<{ repo: string; reason: string }[]>([]);
  // Synchronous re-entrancy lock (the wizard's established pattern): a state flag can't stop the
  // second half of a double-click, which would fan 2N writes at the capped watch route.
  const runningRef = useRef(false);

  async function track() {
    if (runningRef.current || eligible.length === 0) return;
    runningRef.current = true;
    setBusy(true);
    try {
      const outcome = await trackPersonalRepos(eligible);
      setTracked(outcome.tracked);
      setRefused(outcome.refused);
    } finally {
      setBusy(false);
      runningRef.current = false;
    }
  }

  return (
    <Surface radius="xl" className="mt-4 p-5">
      <Kicker>Personal workspace</Kicker>
      <p className="mt-2 text-base text-slate-300">
        <span className="font-mono text-white">{org}</span> is your personal workspace, not a fleet.
        Personal workspaces don&apos;t run their own org scans: they <em>track</em> public
        repositories and read the scores from the shared public history, so one repo keeps one
        continuous series no matter how many people watch it.
      </p>

      {eligible.length > 0 && tracked === null && (
        <p className="mt-3 text-base text-slate-400">
          We can carry your picks over: add{" "}
          <span className="font-mono tabular-nums text-slate-200">{eligible.length}</span>{" "}
          {eligible.length === 1 ? "repository" : "repositories"} to your personal watchlist now.
          {privateCount > 0 && (
            <>
              {" "}
              <span className="font-mono tabular-nums text-slate-200">{privateCount}</span> private{" "}
              {privateCount === 1 ? "repository is" : "repositories are"} left out. Personal
              workspaces track public repositories only.
            </>
          )}
        </p>
      )}

      {tracked !== null && (
        <div role="status" aria-live="polite" className="mt-3 text-base">
          {tracked.length > 0 && (
            <p className="text-success-soft">
              Now tracking{" "}
              <span className="font-mono tabular-nums">{tracked.length}</span>{" "}
              {tracked.length === 1 ? "repository" : "repositories"} in your workspace.
            </p>
          )}
          {refused.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm text-amber-300">
              {refused.map((r) => (
                <li key={r.repo}>
                  <span className="font-mono">{r.repo}</span>: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {eligible.length > 0 && tracked === null && (
          <button
            type="button"
            onClick={track}
            disabled={busy}
            aria-busy={busy}
            className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-4 py-2.5 text-base font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? "Adding…" : `Track ${eligible.length} ${eligible.length === 1 ? "repository" : "repositories"}`}
          </button>
        )}
        <Link
          href="/me"
          className="focus-ring rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
        >
          Open your workspace →
        </Link>
      </div>
    </Surface>
  );
}
