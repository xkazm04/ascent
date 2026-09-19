// Step 2 of Pairing: GitHub, OPTIONAL. Server-safe (no hooks).
//
// Nothing in step 1 depends on it. What the App adds is only what a local checkout cannot do: open
// pull requests (the scaffold, one migration PR per artifact type, a dispatch's PR, contributing
// signals back) and read a registry that is NOT on this machine. Stated as exactly that, so an
// operator who never connects it knows what they are not missing.

import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryPairingView } from "./pairingClient";

export function RegistryGithubStep({ org, github, paired }: { org: string; github: RegistryPairingView["github"]; paired: boolean }) {
  const connected = github.appConfigured && github.installed;
  const state = connected ? (github.canWrite ? "connected" : "connected · read-only for you") : github.appConfigured ? "not installed" : "not configured";
  return (
    <section className="space-y-2 rounded-xl border border-dashed border-divider p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="type-mono-sm text-slate-500">02</span>
        <h3 className="type-body font-medium text-slate-300">GitHub · optional</h3>
        <span className="rounded-full border border-divider px-2 py-0.5 font-mono type-micro uppercase tracking-widest text-slate-500">{state}</span>
      </div>
      <p className="max-w-3xl type-body-sm text-slate-500">
        Only needed for pull requests — the scaffold, migration PRs, a dispatch&apos;s PR, contributing signals back — or for a registry that
        is not checked out on this machine.{" "}
        {paired ? "Your paired checkout already feeds every registry module without it." : "Pair the checkout above first; nothing there waits on this."}
      </p>
      <div className="flex flex-wrap gap-4 type-caption">
        {!connected && github.installUrl && (
          <a href={github.installUrl} target="_blank" rel="noreferrer" className="text-accent transition hover:text-white">
            Install the GitHub App ↗
          </a>
        )}
        <Link href={orgTabHref(org, "registry")} className="text-accent transition hover:text-white">
          Registry tab →
        </Link>
      </div>
    </section>
  );
}
