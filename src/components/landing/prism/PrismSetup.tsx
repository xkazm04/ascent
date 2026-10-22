// Self-hosted install only: the setup guidance the old landing deck carried. A self-hosted visitor is
// already running Ascent, so the "run it yourself" pitch is replaced by the one thing they may still need,
// finishing setup with the `/onboarding` skill (only while nothing is configured; `setup` is the
// first-run resolver's verdict, src/lib/first-run.ts). Renders nothing on the hosted cloud.

import Link from "next/link";
import { DOCS_ARE_UPSTREAM, selfHostGuideHref } from "@/lib/site";
import { Arrow } from "./PrismBits";
import type { PrismLinks } from "./prismLinks";

/** True when the landing should lead a visitor to finish setting up this install. */
export const needsSetup = (links: PrismLinks): boolean => !!links.selfHosted && links.setup === "unset";

/** The "Finish setup" call to action: only on a self-hosted install with nothing configured yet. */
export function PrismSetupLink({ links }: { links: PrismLinks }) {
  if (!needsSetup(links)) return null;
  return (
    <Link className="btn ghost" href="/onboarding">
      Finish setup &middot; /onboarding <Arrow />
    </Link>
  );
}

export function PrismSetup({ links }: { links: PrismLinks }) {
  if (!links.selfHosted) return null;
  const unset = needsSetup(links);
  return (
    <div className="setup">
      <p className="eyebrow"><span className="sw"></span>This install</p>
      <p>
        {unset
          ? "Nothing is configured yet. The /onboarding skill, run from Claude Code in this clone, probes the machine, collects your keys and boots the app."
          : "You are running Ascent yourself: the same AGPL-3.0 codebase as the cloud, every tier switched on."}
      </p>
      <div className="ctas">
        {unset ? <PrismSetupLink links={links} /> : <Link className="btn ghost" href="/onboarding">Scan your whole org</Link>}
        <a className="btn ghost" href={selfHostGuideHref()} target="_blank" rel="noreferrer">
          Self-hosting guide{DOCS_ARE_UPSTREAM ? " (upstream)" : ""}
        </a>
      </div>
    </div>
  );
}
