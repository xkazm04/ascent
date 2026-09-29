// Fixed top bar: the mark and wordmark, section links, the source link and the primary action. Flips to a
// dark-on-paper form while the identity section (which sits on paper) is under it.

import Link from "next/link";
import type { RefObject } from "react";
import { PrismScanLink } from "./PrismScanLink";
import { PrismMark, PrismWordmark } from "./PrismDefs";
import { PRISM_NAV } from "./prismNav";
import { sourceOrSelfHost, type PrismLinks } from "./prismLinks";

interface Props {
  links: PrismLinks;
  paper: boolean;
  active: string | null;
  progressRef: RefObject<HTMLElement | null>;
}

export function PrismTop({ links, paper, active, progressRef }: Props) {
  const source = sourceOrSelfHost(links);
  return (
    <>
      <div className="progress" aria-hidden="true">
        <i ref={progressRef} />
      </div>
      <header className={paper ? "top paper" : "top"}>
        <a className="brandlink" href="#hero" aria-label="Ascent, home">
          <PrismMark className="mk" />
          <PrismWordmark className="wm" />
        </a>
        <nav className="nav" aria-label="Page">
          {PRISM_NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className={active === n.id ? "on" : undefined}>{n.label}</a>
          ))}
          {links.source ? <a href={source} target="_blank" rel="noreferrer">Source</a> : <Link href={source}>Source</Link>}
          <PrismScanLink className="btn primary" href={links.scan}>Scan a repository</PrismScanLink>
        </nav>
      </header>
    </>
  );
}
