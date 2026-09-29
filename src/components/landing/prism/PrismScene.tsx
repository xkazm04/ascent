"use client";

// The nested layers: overview -> a line's scene -> one piece of evidence. Rendered from the URL hash
// (usePrismRoute) so browser Back, deep links and Esc all walk the same three levels. The overlay is a
// modal dialog: the page behind it is made inert by the parent while `open`, focus moves in, and the
// opener gets it back on close.

import { useEffect, useState, type CSSProperties } from "react";
import { BackArrow } from "./PrismBits";
import { PrismArt } from "./PrismArt";
import { PrismEvidencePanel } from "./PrismEvidencePanel";
import { PrismScale } from "./PrismScale";
import { PrismSceneLeft } from "./PrismSceneLeft";
import { evidenceFor } from "./prismEvidence";
import { PRISM_DIMS, dimAt, lineHash, nextLine, prevLine, type Archetype } from "./prismModel";

interface Props {
  /** Line whose content is on screen; null when the scene is closed. */
  index: number | null;
  /** Evidence index, or null for the line scene itself. */
  ev: number | null;
  arch: Archetype;
  open: boolean;
  live: boolean;
  reduced: boolean;
  mobile: boolean;
  go(hash: string): void;
  up(): void;
}

export function PrismScene({ index, ev, arch, open, live, reduced, mobile, go, up }: Props) {
  const dim = index != null ? dimAt(index) : null;
  const evs = dim ? evidenceFor(dim.index) : [];
  const evValid = ev != null && evs[ev] != null ? ev : null;

  // Keep the last opened evidence on screen while its panel fades out.
  const [lastEv, setLastEv] = useState<number | null>(null);
  if (evValid != null && evValid !== lastEv) setLastEv(evValid);
  const panelEv = evValid ?? lastEv;

  // Focus: into the scene when it opens, onto the evidence heading when a piece opens, back to the
  // line's name when evidence closes with focus inside the panel.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const target = evValid != null ? document.getElementById("prism-ev-h") : document.getElementById("prism-scene-name");
      target?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    if (evValid == null) {
      const a = document.activeElement;
      if (a && a.closest("#prism-ev-panel")) document.getElementById("prism-scene-name")?.focus({ preventScroll: true });
      return;
    }
    const t = window.setTimeout(() => document.getElementById("prism-ev-h")?.focus({ preventScroll: true }), 40);
    let t2 = 0;
    if (mobile) t2 = window.setTimeout(() => document.getElementById("prism-ev-panel")?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" }), 60);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [evValid, open, mobile, reduced]);

  const cls = open ? (live ? "open live" : "open") : undefined;
  const style = dim ? ({ "--c": dim.hue } as CSSProperties) : undefined;
  const prev = dim ? dimAt(prevLine(dim.index)) : null;
  const next = dim ? dimAt(nextLine(dim.index)) : null;
  const cur = evValid != null ? evs[evValid] : undefined;
  const panel = panelEv != null ? evs[panelEv] : undefined;

  return (
    <div id="scene" className={cls} style={style} role="dialog" aria-modal="true" aria-labelledby="prism-scene-name" aria-hidden={!open}>
      <div className="sc-light"></div>
      {dim && prev && next && (
        <>
          <div className="sc-bar">
            <button className="back" type="button" onClick={up}>
              <BackArrow /><span>{evValid != null ? `Back to ${dim.id}` : "All nine lines"}</span>
            </button>
            <ol className="crumbs" aria-label="You are here">
              <li><a href="#/">Spectrum</a></li>
              {evValid == null ? (
                <li><span aria-current="page" style={{ color: dim.hue }}>{dim.id} {dim.name}</span></li>
              ) : (
                <>
                  <li><a href={lineHash(dim.index)}>{dim.id} {dim.name}</a></li>
                  <li><span aria-current="page" className="mono" style={{ fontSize: 14 }}>{cur?.path}</span></li>
                </>
              )}
            </ol>
            <div className="stepper">
              <button type="button" aria-label="Previous line" onClick={() => go(lineHash(prev.index))}>← {prev.id}</button>
              <span>{dim.index + 1} / {PRISM_DIMS.length}</span>
              <button type="button" aria-label="Next line" onClick={() => go(lineHash(next.index))}>{next.id} →</button>
            </div>
          </div>
          <div className="sc-body">
            <PrismSceneLeft dim={dim} arch={arch} ev={evValid} onPick={(k) => go(lineHash(dim.index, k))} />
            <div className={evValid != null ? "sc-right ev" : "sc-right"}>
              <div className="artwrap" key={dim.id}>
                <div className="art">
                  <div className="art-halo"></div>
                  <PrismArt index={dim.index} reduced={reduced} />
                  <span className="art-cap">{dim.id} · stylised line art</span>
                </div>
                <PrismScale dim={dim} />
              </div>
              <div className="evpanel" id="prism-ev-panel" role="region" aria-label="Evidence detail">
                {panelEv != null && panel && (
                  <PrismEvidencePanel
                    dim={dim}
                    ev={panel}
                    index={panelEv}
                    count={evs.length}
                    onBack={() => go(lineHash(dim.index))}
                    onNext={() => go(lineHash(dim.index, (panelEv + 1) % evs.length))}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
