// The line scene's left column: name, what it reads, the weight under each lens, the evidence list (each
// row opens one piece) and the next step. All evidence, readings and steps are illustrative and tagged.

import { Fragment } from "react";
import { IllTag } from "./PrismBits";
import { at } from "./at";
import { evidenceFor, ROUTE } from "./prismEvidence";
import { ARCHETYPES, archetypeLabel, pct, weightOf, type Archetype, type PrismDim } from "./prismModel";

interface Props {
  dim: PrismDim;
  arch: Archetype;
  ev: number | null;
  onPick(k: number): void;
}

/** The bar for a weight is scaled against this ceiling so the nine dimensions read against each other. */
const BAR_CEILING = 0.2;

export function PrismSceneLeft({ dim, arch, ev, onPick }: Props) {
  const i = dim.index;
  return (
    <div className="sc-left">
      <p className="eyebrow"><span className="sw"></span>Line {dim.id} of 9 · weight {pct(weightOf(i, arch))} ({archetypeLabel(arch)})</p>
      <h2 className="sc-name" id="prism-scene-name" tabIndex={-1}>{dim.name}</h2>
      <p className="sc-desc">{dim.description}</p>
      <div className="weights">
        {ARCHETYPES.map((a) => {
          const w = weightOf(i, a);
          return (
            <Fragment key={a}>
              <span className={a === arch ? "cur" : undefined}>{archetypeLabel(a)}</span>
              <span className="wb"><i style={{ transform: `scaleX(${(w / BAR_CEILING).toFixed(3)})` }}></i></span>
              <span className="wv">{pct(w)}</span>
            </Fragment>
          );
        })}
      </div>
      <div className="evlist">
        <h4>Evidence <IllTag /></h4>
        <div>
          {evidenceFor(i).map((e, k) => (
            <button key={e.path} type="button" className="ev-row" aria-current={k === ev ? "true" : "false"} onClick={() => onPick(k)}>
              <span className="ev-path">{e.path}</span>
              <span className="ev-q">{e.note}</span>
              <span className="ev-lv">supports {e.level} →</span>
            </button>
          ))}
        </div>
      </div>
      <div className="route">
        <h4>Next on this line <IllTag /></h4>
        <p>{at(ROUTE, i)}</p>
      </div>
    </div>
  );
}
