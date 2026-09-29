// The hero: a canvas prism (engine/), the headline on the left, nine labelled lines on the right. The item
// under attention takes the stage: hover a line (or its label) and the headline hands over to that
// dimension's name. Positions of everything that sits over the canvas come from the engine's Layout.

import Link from "next/link";
import type { CSSProperties, RefObject } from "react";
import type { Layout } from "./engine/types";
import { Arrow } from "./PrismBits";
import { PrismScanLink } from "./PrismScanLink";
import {
  ARCHETYPES,
  PRISM_DIMS,
  dimAt,
  archetypeLabel,
  archetypeShort,
  pct,
  weightOf,
  type Archetype,
} from "./prismModel";
import type { PrismLinks } from "./prismLinks";

interface Props {
  heroRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  links: PrismLinks;
  layout: Layout | null;
  ready: boolean;
  hover: number;
  shown: number;
  arch: Archetype;
  setArch(a: Archetype): void;
  setHover(i: number, delayed?: boolean): void;
  onOpen(i: number, from: HTMLElement | null): void;
  onSkip(): void;
}

const hueVar = (hue: string): CSSProperties => ({ "--c": hue }) as CSSProperties;

export function PrismHero({ heroRef, canvasRef, links, layout, ready, hover, shown, arch, setArch, setHover, onOpen, onSkip }: Props) {
  const sd = dimAt(shown);
  return (
    <section id="hero" ref={heroRef} aria-label="Ascent: the AI-native engineering index">
      <canvas id="prism" ref={canvasRef} aria-hidden="true" />
      <div className={hover >= 0 ? "stage hov" : "stage"} id="stage">
        <div className="stage-home">
          <p className="eyebrow"><span className="sw"></span>The AI-native engineering index</p>
          <h1>How AI&#8209;native is<br />your engineering?<br /><span className="spec-text">Read its spectrum.</span></h1>
          <p className="lede">Ascent splits a repository&apos;s evidence into nine lines and reads each one: a 0–100 score on a five-level ladder, the verbatim evidence behind every number, and the route to the next level.</p>
          <div className="ctas">
            <PrismScanLink className="btn primary" href={links.scan}>Scan a repository <Arrow /></PrismScanLink>
            <Link className="btn ghost" href={links.org}>Open the org demo</Link>
          </div>
          <p className="fine">Open source under AGPL-3.0 · runs on your machine with any model</p>
        </div>
        <div className="stage-dim" aria-hidden="true" style={hueVar(sd.hue)}>
          <p className="eyebrow"><span className="sw"></span>Line {sd.id} of {PRISM_DIMS.length}</p>
          <p className="dname">{sd.name}</p>
          <p className="lede">{sd.description}</p>
          <div className="meta">
            {ARCHETYPES.map((a) => (
              <span key={a}><b>{pct(weightOf(shown, a))}</b>{archetypeLabel(a)}</span>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 22 }}>Click the line to open it →</p>
        </div>
      </div>
      <div className={hover >= 0 ? "rays hov" : "rays"}>
        {PRISM_DIMS.map((d, i) => {
          const pos = layout?.labels[i];
          const style = { ...hueVar(d.hue), ...(pos ? { left: pos.left, top: pos.top } : null) } as CSSProperties;
          const w = pct(weightOf(i, arch));
          return (
            <button
              key={d.id}
              type="button"
              className={hover === i ? "ray-label hot" : "ray-label"}
              style={style}
              aria-label={`Open line ${d.id}, ${d.name}, weight ${w}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1, true)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(-1, true)}
              onClick={(e) => onOpen(i, e.currentTarget)}
            >
              <span className="rid">{d.id}</span>
              <span className="rw">{w}</span>
              <span className="rn">{d.name}</span>
            </button>
          );
        })}
      </div>
      <div className="annot" style={layout?.annIn ?? undefined}>white light in · one repository</div>
      <div className="annot" style={layout?.annOut ? { left: "auto", ...layout.annOut } : undefined}>nine lines out<br />one per dimension</div>
      <div className="arch" style={layout?.archSwitch ? { left: "auto", ...layout.archSwitch } : undefined}>
        <span>Line width = weight for</span>
        <span className="seg" role="radiogroup" aria-label="Archetype weighting">
          {ARCHETYPES.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={a === arch} title={archetypeLabel(a)} onClick={() => setArch(a)}>
              {archetypeShort(a)}
            </button>
          ))}
        </span>
      </div>
      <button className="skip" type="button" tabIndex={ready ? -1 : 0} onClick={onSkip}>Skip intro</button>
      <a className="cue" href="#ladder"><i></i>Five classes of light below</a>
    </section>
  );
}
