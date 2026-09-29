// The nine lines as a tappable list. Shown instead of the fan on small screens (the hero's labels are
// hidden below 760px, see prism.css), so every line stays one tap from its scene.

import type { CSSProperties } from "react";
import { PRISM_DIMS, pct, weightOf, type Archetype } from "./prismModel";

export function PrismLines({ arch, onOpen }: { arch: Archetype; onOpen(i: number, from: HTMLElement | null): void }) {
  return (
    <section id="lines" aria-label="The nine lines">
      <div className="frame">
        <p className="eyebrow"><span className="sw"></span>The nine lines · tap one to open it</p>
        <ul className="linelist">
          {PRISM_DIMS.map((d, i) => (
            <li key={d.id}>
              <button type="button" style={{ "--c": d.hue } as CSSProperties} onClick={(e) => onOpen(i, e.currentTarget)}>
                <span className="bar"></span>
                <span className="id">{d.id}</span>
                <span>{d.name}</span>
                <span className="w">{pct(weightOf(i, arch))}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
