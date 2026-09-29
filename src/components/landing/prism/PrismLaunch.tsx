// Closing section: the primary action once more, and the page's footer (the app's own footer is not
// rendered on this landing, so the legal links live here).

import Link from "next/link";
import { Arrow } from "./PrismBits";
import { PrismScanLink } from "./PrismScanLink";
import { SELF_HOST_HREF, type PrismLinks } from "./prismLinks";
import { PRISM_DIMS, PRISM_LEVELS, PRISM_RUBRIC } from "./prismModel";

export function PrismLaunch({ links }: { links: PrismLinks }) {
  return (
    <section id="launch" aria-labelledby="launchTitle">
      <div className="frame">
        <p className="eyebrow">
          <span className="sw"></span>Rubric {PRISM_RUBRIC} · {PRISM_LEVELS.length} levels · {PRISM_DIMS.length} dimensions · 0–100
        </p>
        <h2 id="launchTitle">Point it at <b>a repository.</b></h2>
        <div className="ctas">
          <PrismScanLink className="btn primary" href={links.scan}>Scan a repository <Arrow /></PrismScanLink>
          <Link className="btn ghost" href={links.org}>Open the org demo</Link>
          <Link className="btn ghost" href="/leaderboard">Leaderboard</Link>
        </div>
        <div className="foot">
          <span>Ascent · open source under AGPL-3.0</span>
          {links.source ? <a href={links.source} target="_blank" rel="noreferrer">Source on GitHub</a> : <Link href={SELF_HOST_HREF}>Run it yourself</Link>}
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/">Current landing</Link>
          <span>Ascent measures. It does not promise outcomes.</span>
        </div>
      </div>
    </section>
  );
}
