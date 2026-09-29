"use client";

// The ladder: five classes of light. Each level is a plate showing which of the nine lines burn at that
// level (stylised from the written level descriptions, not measured), and the stage beside it reads the
// level under the pointer or focus, falling back to the selected one.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { at } from "./at";
import { PRISM_DIMS, PRISM_LEVELS, levelAt, PRISM_RUBRIC, weightOf, type Archetype } from "./prismModel";

/** How brightly each line burns per level (negative = an absorption line: evidence missing). L1..L5. */
const STYLE: readonly (readonly number[])[] = [
  [-1, -0.6, -0.45, -1, -0.35, -0.55, -0.25, -1, -0.6],
  [-0.35, 0.35, 0.4, -0.85, 0.2, 0.35, 0.2, -0.55, 0.1],
  [0.7, 0.75, 0.7, 0.12, 0.5, 0.75, 0.5, 0.45, 0.45],
  [0.92, 0.88, 0.92, 0.82, 0.85, 0.86, 0.72, 0.82, 0.72],
  [1, 1, 1, 1, 1, 1, 1, 1, 1],
];
/** Opacity of the continuous spectrum under each strip. */
const CONTINUUM = [0.05, 0.09, 0.15, 0.24, 0.4];
const DEFAULT_LEVEL = 2;
const SWAP_MS = 140;

function Strip({ li, arch }: { li: number; arch: Archetype }) {
  return (
    <span className="strip">
      <span className="cont" style={{ opacity: at(CONTINUUM, li) }} />
      {li === 4 && <span className="wash" style={{ opacity: 0.55 }} />}
      {PRISM_DIMS.map((d, i) => {
        const v = at(at(STYLE, li), i);
        const left = `${((i + 0.5) / PRISM_DIMS.length) * 100}%`;
        const width = Math.max(2, weightOf(i, arch) * 34);
        const style: CSSProperties =
          v < 0
            ? { left, width, background: "#000", opacity: Number((-v * 0.9).toFixed(2)) }
            : {
                left,
                width,
                background: li === 4 ? "#fff" : d.hue,
                opacity: v,
                boxShadow: `0 0 ${(6 + v * 18).toFixed(0)}px ${(v * 3).toFixed(0)}px ${d.hue}`,
              };
        return <i key={d.id} style={style} />;
      })}
    </span>
  );
}

export function PrismLadder({ arch, reduced }: { arch: Archetype; reduced: boolean }) {
  const [sel, setSel] = useState(DEFAULT_LEVEL);
  const [peek, setPeek] = useState<number | null>(null);
  const [staged, setStaged] = useState(DEFAULT_LEVEL);
  const plates = useRef<Array<HTMLButtonElement | null>>([]);
  const current = peek ?? sel;
  // The stage text fades out while it lags the level under attention, swaps 140 ms later, fades back in.
  const swap = current !== staged;

  useEffect(() => {
    if (current === staged) return;
    const t = window.setTimeout(() => setStaged(current), reduced ? 0 : SWAP_MS);
    return () => window.clearTimeout(t);
  }, [current, staged, reduced]);

  const L = levelAt(staged);
  const N = PRISM_LEVELS[staged + 1];
  const onKey = (e: KeyboardEvent, li: number) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const n = Math.max(0, Math.min(PRISM_LEVELS.length - 1, li + (e.key === "ArrowUp" ? 1 : -1)));
    plates.current[n]?.focus();
    setSel(n);
  };

  return (
    <section id="ladder" className="sec" aria-labelledby="ladderTitle">
      <div className="frame">
        <div className="sec-head">
          <p className="eyebrow"><span className="sw"></span>The ladder · rubric {PRISM_RUBRIC}</p>
          <h2 id="ladderTitle">Five classes of light.</h2>
          <p className="lede">Each level is a band on the 0–100 index. Missing evidence reads as a dark line; found evidence burns. The higher the class, the more of the nine lines burn, until at L5 they run together as white light.</p>
        </div>
        <div className="ladder">
          <div className={swap ? "lvl-stage swap" : "lvl-stage"} aria-live="polite">
            <p className="lv-id">{L.id} · index {L.band[0]}–{L.band[1]}</p>
            <h3>{L.name}</h3>
            <p className="tagline">{L.tagline}</p>
            <p className="desc">{L.description}</p>
            {N ? (
              <p className="next">Next class: <b>{N.id} {N.name}</b> · {N.tagline}</p>
            ) : (
              <p className="next">The top of the ladder: every line burns, and the light runs white.</p>
            )}
          </div>
          <div className="plates">
            <div className="axis" aria-hidden="true">
              <span></span>
              <div className="ticks">
                {PRISM_DIMS.map((d, i) => (
                  <span key={d.id} style={{ left: `${((i + 0.5) / PRISM_DIMS.length) * 100}%`, color: d.hue }}>{d.id}</span>
                ))}
              </div>
            </div>
            <div role="listbox" aria-label="Maturity levels" aria-orientation="vertical" onMouseLeave={() => setPeek(null)}>
              {PRISM_LEVELS.map((_l, k) => PRISM_LEVELS.length - 1 - k).map((li) => {
                const lv = levelAt(li);
                return (
                  <button
                    key={lv.id}
                    ref={(el) => {
                      plates.current[li] = el;
                    }}
                    type="button"
                    className="plate"
                    role="option"
                    aria-selected={li === current}
                    data-i={li}
                    onMouseEnter={() => setPeek(li)}
                    onFocus={() => setPeek(li)}
                    onBlur={() => setPeek(null)}
                    onClick={() => setSel(li)}
                    onKeyDown={(e) => onKey(e, li)}
                  >
                    <span className="pl-l"><b>{lv.id}<span className="pn"> {lv.name}</span></b><span>{lv.band[0]}–{lv.band[1]}</span></span>
                    <Strip li={li} arch={arch} />
                  </button>
                );
              })}
            </div>
            <p className="note">Stylised: which lines burn follows each level&apos;s written description, not a measured repository. Line width follows the dimension&apos;s weight.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
