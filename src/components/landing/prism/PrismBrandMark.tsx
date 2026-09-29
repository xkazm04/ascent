// Identity sheet, left column: how the mark is constructed on its grid, and how it holds at small sizes.

import type { CSSProperties } from "react";
import { MARK } from "./PrismDefs";

const GRID = (() => {
  let d = "";
  for (let x = 0; x <= 600; x += 50) d += `M${x} 0V600`;
  for (let y = 0; y <= 600; y += 50) d += `M0 ${y}H600`;
  return d;
})();

const tile = (px: number, extra: CSSProperties = {}): CSSProperties => ({ width: px, height: px, ...extra });
const PAPER_TILE: CSSProperties = { background: "#f2eee6", color: "#05060a", border: "1px solid rgba(11,12,18,.2)" };

function Use({ px }: { px: number }) {
  return (
    <svg width={px} height={px}>
      <use href={`#${MARK}`} />
    </svg>
  );
}

export function PrismBrandMark() {
  return (
    <div className="bcell">
      <h4>Mark · construction</h4>
      <div className="construct">
        <svg viewBox="-60 -30 720 620" aria-label="Construction of the Ascent mark on a grid" role="img">
          <g stroke="rgba(242,238,230,.08)" strokeWidth="1">
            <path d={GRID} />
          </g>
          <rect x="-20" y="-10" width="640" height="560" fill="none" stroke="rgba(242,238,230,.25)" strokeDasharray="6 6" />
          <g transform="translate(0 0) scale(6)">
            <use href={`#${MARK}`} width="100" height="100" color="#f2eee6" />
          </g>
          <g fill="none" stroke="#f2c14e" strokeWidth="1.4">
            <circle cx="300" cy="60" r="7" />
            <circle cx="166" cy="350" r="7" />
            <circle cx="412" cy="304" r="7" />
            <path d="M300 60V528" strokeDasharray="4 5" opacity=".6" />
            <path d="M84 528H516" strokeDasharray="4 5" opacity=".6" />
          </g>
          <g fontFamily="Cascadia Mono,Consolas,monospace" fontSize="14" fill="#f2c14e">
            <text x="330" y="22">apex · x50 y10</text>
            <text x="-50" y="296">entry</text>
            <text x="-50" y="316">62% down</text>
            <text x="-50" y="336">the left leg</text>
            <text x="540" y="446">exit</text>
            <text x="540" y="466">52% down</text>
            <text x="540" y="486">the right leg</text>
            <text x="92" y="556">legs 7.5 / 100 · open base</text>
            <text x="420" y="556">clear space = 1 leg</text>
            <text x="420" y="138" fill="#f2eee6">9 lines = 9 dimensions</text>
            <text x="420" y="160" fill="#a6abbd">5 at small sizes,</text>
            <text x="420" y="180" fill="#a6abbd">3 at 16 px</text>
          </g>
        </svg>
      </div>
      <div className="sizes" aria-label="Mark at small sizes">
        <figure><div className="tile" style={tile(96)}><Use px={64} /></div>64 px</figure>
        <figure><div className="tile" style={tile(52)}><Use px={32} /></div>32 px</figure>
        <figure>
          <div className="tile" style={tile(30, { borderRadius: 4 })}>
            <svg width="16" height="16" viewBox="0 0 100 100">
              <path d="M18 86L50 16L82 86" fill="none" stroke="#f2eee6" strokeWidth="10" />
              <path d="M4 64L31 58L66 51" stroke="#f2eee6" strokeWidth="7" />
              <path d="M66 51L98 38" stroke="#FF5A5F" strokeWidth="7" />
              <path d="M66 51L98 52" stroke="#62E59A" strokeWidth="7" />
              <path d="M66 51L98 66" stroke="#BC6DFF" strokeWidth="7" />
            </svg>
          </div>
          16 px
        </figure>
        <figure><div className="tile" style={tile(96, PAPER_TILE)}><Use px={64} /></div>on paper</figure>
      </div>
    </div>
  );
}
