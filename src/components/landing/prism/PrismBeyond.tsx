// Beyond one repository: the things around the reading (fleet view, autopilot on a branch, the read-only
// MCP door, the CI gate, the public badge). Copy is limited to shipped behaviour.

import Link from "next/link";
import type { ReactNode } from "react";
import { IllTag } from "./PrismBits";
import { MARK } from "./PrismDefs";
import { HUES } from "./prismModel";
import { SELF_HOST_HREF, type PrismLinks } from "./prismLinks";

const INK = "#f2eee6";

const ITEMS: ReadonlyArray<{ h: string; p: string; glyph: ReactNode }> = [
  {
    h: "The whole estate",
    p: "An org and fleet view: a cluster per org, a star per repository, each brightening as it climbs.",
    glyph: (
      <svg viewBox="0 0 80 60" fill="none" stroke={INK} strokeWidth="1.6">
        <circle cx="40" cy="30" r="5" fill="#fff" />
        {[[12, 12], [66, 10], [70, 44], [16, 50], [40, 4], [44, 56]].map((p, i) => {
          const h = HUES[Math.floor(i * 1.5)];
          return (
            <g key={h}>
              <path d={`M40 30L${p[0]} ${p[1]}`} stroke={h} opacity=".8" />
              <circle cx={p[0]} cy={p[1]} r="3" fill={h} stroke="none" />
            </g>
          );
        })}
      </svg>
    ),
  },
  {
    h: "Autopilot, on a branch",
    p: "Pair a repository to a folder and a local coding agent works the backlog on a branch. A human reviews every change.",
    glyph: (
      <svg viewBox="0 0 80 60" fill="none" stroke={INK} strokeWidth="1.8">
        <path d="M14 30a16 16 0 1 1 16 16" />
        <path d="M26 42l4 4-4 4" />
        <path d="M50 12V48M50 24C62 24 66 30 66 40V48" stroke="#62E59A" />
        <circle cx="50" cy="48" r="3" fill="#62E59A" stroke="none" />
        <circle cx="66" cy="48" r="3" fill="#62E59A" stroke="none" />
      </svg>
    ),
  },
  {
    h: "A read-only MCP server",
    p: "Your own coding agents can ask Ascent for the reading and its evidence. They cannot change either.",
    glyph: (
      <svg viewBox="0 0 80 60" fill="none" stroke={INK} strokeWidth="1.8">
        <rect x="8" y="18" width="26" height="24" rx="3" />
        <path d="M34 24H46M34 36H46" stroke="#4CB2FF" />
        <rect x="46" y="14" width="26" height="32" rx="3" />
        <path d="M54 24h10M54 30h10M54 36h6" opacity=".6" />
      </svg>
    ),
  },
  {
    h: "A CI gate",
    p: "Ascent ships as a GitHub Action, so the reading can hold a line in the pipeline.",
    glyph: (
      <svg viewBox="0 0 80 60" fill="none" stroke={INK} strokeWidth="1.8">
        <path d="M14 52V14M66 52V14" />
        <path d="M14 26L60 12" stroke="#FFC247" strokeWidth="3" />
        <path d="M4 52H76" opacity=".5" />
      </svg>
    ),
  },
  {
    h: "A public badge",
    p: "Put the level on the README, where the people who depend on the repository can see it.",
    glyph: (
      <svg viewBox="0 0 80 60" fill="none" stroke={INK} strokeWidth="1.6">
        <rect x="6" y="20" width="68" height="20" rx="3" />
        <rect x="40" y="20" width="34" height="20" rx="3" fill="#FFC247" stroke="none" />
        <path d="M12 36L17 25L22 36" strokeWidth="1.8" />
      </svg>
    ),
  },
];

export function PrismBeyond({ links }: { links: PrismLinks }) {
  return (
    <section id="beyond" className="sec" aria-labelledby="beyondTitle">
      <div className="frame beyond">
        <div>
          <p className="eyebrow"><span className="sw"></span>Beyond one repository</p>
          <h2 id="beyondTitle">Runs beside the code.<br /><b>On your machine.</b></h2>
          <p className="lede">Open source under AGPL-3.0. Ascent runs with any model, including a local one or a subscription you already pay for. It reads through the GitHub API or straight from disk with <span className="mono">git ls-files</span> and <span className="mono">git log</span>; no clone is uploaded.</p>
          <div className="ctas">
            {links.source ? (
              <a className="btn ghost" href={links.source} target="_blank" rel="noreferrer">Read the source</a>
            ) : (
              <Link className="btn ghost" href={SELF_HOST_HREF}>Run it yourself</Link>
            )}
            <Link className="btn ghost" href={links.org}>Open the org demo</Link>
          </div>
          <div className="badge">
            <svg viewBox="0 0 250 36" width="250" height="36" role="img" aria-label="Illustrative badge: Ascent L3 Augmented">
              <rect width="250" height="36" rx="4" fill="#0e1019" stroke="rgba(242,238,230,.2)" />
              <rect x="112" width="138" height="36" rx="4" fill="#FFC247" />
              <rect x="112" width="8" height="36" fill="#FFC247" />
              <use href={`#${MARK}`} x="10" y="6" width="24" height="24" color={INK} />
              <text x="42" y="23" fill={INK} fontFamily="Segoe UI,Arial,sans-serif" fontSize="14" fontWeight="600">ascent</text>
              <text x="126" y="23" fill="#07080c" fontFamily="Segoe UI,Arial,sans-serif" fontSize="14" fontWeight="600">L3 · Augmented</text>
            </svg>
            <IllTag />
          </div>
        </div>
        <ul className="kit">
          {ITEMS.map((k) => (
            <li key={k.h}>
              {k.glyph}
              <div><h3>{k.h}</h3><p>{k.p}</p></div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
