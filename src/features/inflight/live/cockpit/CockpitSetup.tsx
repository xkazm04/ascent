"use client";

// The cockpit's FOUR not-ready states. Each one names the single next action, because "you can't run
// a loop here" without saying why is the failure mode this panel exists to prevent.
//
// The field is never hidden behind any of them: the sky chart is a reading of the fleet's standing
// and is worth looking at whether or not this deployment can dispatch agents. These render in the
// right rail only.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { sourceRepoHref } from "@/lib/site";

export type CockpitSetupState = "hosted" | "unpaired" | "autopilot-off" | "no-repos" | "not-owner";

export interface CockpitSetupProps {
  state: CockpitSetupState;
  slug: string;
  /** The route's own 409 copy, when the block is ASCENT_AUTOPILOT. */
  message?: string | null;
}

const tabHref = (slug: string, tab: string) => `/org/${encodeURIComponent(slug)}?tab=${tab}`;

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-px font-mono text-xs tabular-nums text-accent">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-slate-400">{children}</span>
    </li>
  );
}

export function CockpitSetup({ state, slug, message = null }: CockpitSetupProps) {
  if (state === "hosted") {
    const href = sourceRepoHref("docs/SETUP.md");
    return (
      <div>
        <Kicker tone="accent">Loops run where your code is</Kicker>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          An improvement loop dispatches a coding agent into a real working copy on disk, so it exists only on a
          self-hosted Ascent. This chart is the read-only half — the fleet&rsquo;s standing in adoption × rigor — and it
          works here.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          {href ? (
            <a href={href} className="focus-ring rounded text-accent hover:text-accent-soft">
              Self-hosting guide →
            </a>
          ) : (
            <>See <span className="font-mono text-xs">docs/SETUP.md</span> in the source repository.</>
          )}
        </p>
      </div>
    );
  }

  if (state === "no-repos") {
    return (
      <div>
        <Kicker tone="accent">Nothing to plot yet</Kicker>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          The observatory places repos by their last scan. Watch and scan a few and they will appear here.
        </p>
        <Link href={tabHref(slug, "repositories")} className="focus-ring mt-3 inline-block rounded font-mono text-xs text-accent hover:text-accent-soft">
          Repositories →
        </Link>
      </div>
    );
  }

  if (state === "autopilot-off") {
    return (
      <div>
        <Kicker tone="accent">Loop disabled on this deployment</Kicker>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {message ??
            "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 (and make sure the claude CLI is available)."}
        </p>
        <p className="mt-3 font-mono text-xs text-slate-500">Restart the server after setting it.</p>
      </div>
    );
  }

  if (state === "not-owner") {
    return (
      <div>
        <Kicker tone="accent">Read-only</Kicker>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Starting a run dispatches editing agents into paired working copies, so it takes org-owner access. You can
          still read the chart and every past run.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Kicker tone="accent">Three steps to your first run</Kicker>
      <ol className="mt-3 space-y-2.5">
        <Step n={1}>
          <Link href={tabHref(slug, "pairing")} className="focus-ring rounded text-accent hover:text-accent-soft">
            Pair a local checkout
          </Link>{" "}
          — point a watched repo at its path on this machine.
        </Step>
        <Step n={2}>Pick repos on the chart — click a body, or lasso a cluster.</Step>
        <Step n={3}>Review the proposed batch and press Run.</Step>
      </ol>
    </div>
  );
}
