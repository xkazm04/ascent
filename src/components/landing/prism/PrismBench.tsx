// The optical bench: the five steps a repository goes through, drawn as one beam. Copy states only what
// the product does (deterministic analyzers, verbatim evidence, a model that calibrates inside a guardband).

import type { ReactNode } from "react";
import { HUES } from "./prismModel";

interface Step {
  h: string;
  p: string;
  glyph: ReactNode;
}

const PAPER = "#f2eee6";

const STEPS: readonly Step[] = [
  {
    h: "Source",
    p: "Your repository, read through the GitHub API or straight from disk with git ls-files and git log. No clone is uploaded.",
    glyph: (
      <svg viewBox="0 0 120 84">
        <g fill="none" stroke={PAPER} strokeWidth="2">
          <rect x="6" y="14" width="44" height="56" rx="4" />
          <path d="M14 28h26M14 38h20M14 48h28M14 58h16" />
          <path d="M50 42h66" strokeWidth="3" />
        </g>
        <circle cx="116" cy="42" r="4" fill="#fff" />
      </svg>
    ),
  },
  {
    h: "Nine analyzers",
    p: "Deterministic analyzers split the evidence into nine dimensions. The same repository gives the same evidence.",
    glyph: (
      <svg viewBox="0 0 120 84">
        <path d="M0 50L40 44" stroke="#fff" strokeWidth="3" />
        <path d="M26 76L52 10L78 76" fill="none" stroke={PAPER} strokeWidth="2.4" />
        {HUES.map((h, i) => (
          <path key={h} d={`M64 40L120 ${8 + i * 9}`} stroke={h} strokeWidth="2" />
        ))}
      </svg>
    ),
  },
  {
    h: "Evidence",
    p: "Every finding is kept verbatim with its file path, so any number can be checked by hand.",
    glyph: (
      <svg viewBox="0 0 120 84">
        <rect x="8" y="6" width="104" height="72" rx="3" fill="none" stroke="rgba(242,238,230,.5)" strokeWidth="1.5" />
        {HUES.map((h, i) => (
          <rect key={h} x={16 + i * 10.5} y="14" width={i % 3 ? 3 : 5} height="56" fill={h} opacity={i === 3 ? 0.25 : 0.9} />
        ))}
      </svg>
    ),
  },
  {
    h: "Calibration",
    p: "A model of your choice calibrates and explains the reading inside a guardband. It never invents a score.",
    glyph: (
      <svg viewBox="0 0 120 84" fill="none" stroke={PAPER} strokeWidth="2.2">
        <path d="M60 8C74 26 74 58 60 76C46 58 46 26 60 8Z" />
        <path d="M24 18H14V66H24M96 18H106V66H96" stroke="#f2c14e" />
        <path d="M0 42H44M76 42H120" strokeDasharray="3 4" opacity=".7" />
      </svg>
    ),
  },
  {
    h: "Reading",
    p: "A 0–100 index, a level on the five-step ladder, and a prioritised route to the next level.",
    glyph: (
      <svg viewBox="0 0 120 84">
        <rect x="4" y="30" width="112" height="10" rx="5" fill="rgba(242,238,230,.1)" />
        <rect x="4" y="30" width="66" height="10" rx="5" fill="url(#prism-rdg)" />
        <defs>
          <linearGradient id="prism-rdg">
            <stop offset="0" stopColor="#FF5A5F" stopOpacity=".2" />
            <stop offset="1" stopColor="#FFC247" />
          </linearGradient>
        </defs>
        {[25, 45, 65, 85].map((v) => (
          <path key={v} d={`M${4 + v * 1.12} 24V46`} stroke="rgba(242,238,230,.5)" />
        ))}
        <circle cx="70" cy="35" r="7" fill="#fff" />
        <path d="M70 50V70H108" fill="none" stroke={PAPER} strokeWidth="2" strokeDasharray="4 4" />
        <path d="M102 64l7 6-7 6" fill="none" stroke={PAPER} strokeWidth="2" />
      </svg>
    ),
  },
];

export function PrismBench() {
  return (
    <ol className="bench">
      {STEPS.map((s, i) => (
        <li key={s.h}>
          <div className="gl">{s.glyph}</div>
          <p className="step">0{i + 1}</p>
          <h3>{s.h}</h3>
          <p>{s.p}</p>
        </li>
      ))}
    </ol>
  );
}
