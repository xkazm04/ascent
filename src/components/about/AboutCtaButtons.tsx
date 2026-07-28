// The /about deck's conversion pair — primary "Scan your org" + the secondary demo link — shared by
// BOTH the masthead (AboutHero) and the closing section (AboutCTA).
//
// It was hand-copied in the two places and had drifted in the one way that actually reaches a reader:
// the secondary button read "Explore the live demo →" in the hero and "Explore the demo →" in the CTA.
// "live demo" is the canonical copy — AboutCTA's own body sentence directly above the buttons says
// "or explore the live demo first", and the link goes to a real, scanned org (demoOrgHref), not a
// canned walkthrough. The CTA button had simply lost the word.
//
// `size` is the ONE difference kept, because it is deliberate: the hero pair sits in a dense
// two-column masthead beside the stat ledger ("md"), while the closing CTA is a full-screen
// conversion moment centred in a panel and carries the larger target ("lg").

import Link from "next/link";
import { demoOrgHref } from "@/lib/site";

const PAD = { md: "px-5 py-2.5", lg: "px-6 py-3" } as const;

export function AboutCtaButtons({
  size = "md",
  className = "",
}: {
  size?: keyof typeof PAD;
  className?: string;
}) {
  const pad = PAD[size];
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <Link
        href="/connect"
        className={`focus-ring rounded-xl bg-accent ${pad} font-semibold text-on-accent transition hover:bg-accent-soft`}
      >
        Scan your org
      </Link>
      <Link
        href={demoOrgHref()}
        className={`focus-ring rounded-xl border border-divider ${pad} font-medium text-slate-200 transition hover:border-accent hover:text-white`}
      >
        Explore the live demo →
      </Link>
    </div>
  );
}
