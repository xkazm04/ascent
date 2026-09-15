"use client";

// The cockpit's FOUR not-ready states. Each one names the single next action, because "you can't run
// a loop here" without saying why is the failure mode this panel exists to prevent.
//
// The field is never hidden behind any of them: the sky chart is a reading of the fleet's standing
// and is worth looking at whether or not this deployment can dispatch agents. These render in the
// right rail only.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { DOCS_ARE_UPSTREAM, selfHostGuideHref } from "@/lib/site";

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
      <span aria-hidden className="mt-px type-caption tabular-nums text-accent">
        {n}
      </span>
      <span className="min-w-0 flex-1 type-body-sm leading-relaxed text-slate-400">{children}</span>
    </li>
  );
}

export function CockpitSetup({ state, slug, message = null }: CockpitSetupProps) {
  if (state === "hosted") {
    return (
      <div>
        <Kicker tone="accent">Local lanes run where your code is</Kicker>
        {/* PRIYA-L1-703: this used to say the loop "exists only on a self-hosted Ascent" — a denial
            this deployment's own POST route contradicts, since it accepts a `remote-agent` run. What
            is genuinely self-hosted-only is the LOCAL lane, which spawns an agent inside a checkout
            on the server's disk. A capability the deployment ships is never denied here; the panel
            names the one that is actually missing. */}
        <p className="mt-2 type-body-sm leading-relaxed text-slate-400">
          A <em className="not-italic text-slate-300">local</em> lane dispatches a coding agent into a real working
          copy on this machine, so starting one from here needs a self-hosted Ascent. This chart — the fleet&rsquo;s
          standing in adoption × rigor — works everywhere.
        </p>
        <p className="mt-2 type-body-sm leading-relaxed text-slate-400">
          <span className="text-slate-300">Remote-agent runs do work here.</span> Arm one against this org through the
          API or an MCP work client and its lanes, verdicts and outcome ledger render on this page like any other run.
        </p>
        {/* MC-B43. This panel's whole point is that the reader must self-host to get a local lane, and
            it used to hand them `sourceRepoHref("docs/SETUP.md")` — null whenever
            NEXT_PUBLIC_SOURCE_REPO_URL is unset, which is every deployment that has not set a
            BUILD-time env var — so the one actionable link on the not-ready state degraded to a
            printed file path. `docHref` (via `selfHostGuideHref`) is always a real destination and
            says when it is upstream's copy rather than this deployment's; the four marketing surfaces
            MC-B22 converted already read exactly this way, so the operator meets one link, one label
            and one guide wherever they hit the wall. The DOC also changes: the anchor is labelled
            "Self-hosting guide" and SETUP.md is the credentials-and-preconditions page, while
            SELF-HOSTING.md is the operator's guide the label promises. */}
        <p className="mt-3 type-body-sm leading-relaxed text-slate-500">
          <a href={selfHostGuideHref()} className="focus-ring rounded text-accent hover:text-accent-soft">
            Self-hosting guide{DOCS_ARE_UPSTREAM ? " (upstream)" : ""} →
          </a>
        </p>
      </div>
    );
  }

  if (state === "no-repos") {
    return (
      <div>
        <Kicker tone="accent">Nothing to plot yet</Kicker>
        <p className="mt-2 type-body-sm leading-relaxed text-slate-400">
          The observatory places repos by their last scan. Watch and scan a few and they will appear here.
        </p>
        <Link href={tabHref(slug, "repositories")} className="focus-ring mt-3 inline-block rounded type-caption text-accent hover:text-accent-soft">
          Repositories →
        </Link>
      </div>
    );
  }

  if (state === "autopilot-off") {
    return (
      <div>
        <Kicker tone="accent">Loop disabled on this deployment</Kicker>
        <p className="mt-2 type-body-sm leading-relaxed text-slate-400">
          {message ??
            "The loop is not enabled on this deployment — set ASCENT_AUTOPILOT=1 (and make sure the claude CLI is available)."}
        </p>
        <p className="mt-3 type-caption text-slate-500">Restart the server after setting it.</p>
      </div>
    );
  }

  if (state === "not-owner") {
    return (
      <div>
        <Kicker tone="accent">Read-only</Kicker>
        <p className="mt-2 type-body-sm leading-relaxed text-slate-400">
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
