// Where one line reads on the ladder. The reading is an illustrative number (tagged), placed against the
// real level bands from the rubric.

import { at } from "./at";
import { IllTag } from "./PrismBits";
import { READ } from "./prismEvidence";
import { PRISM_LEVELS, levelOf, type PrismDim } from "./prismModel";

export function PrismScale({ dim }: { dim: PrismDim }) {
  const score = at(READ, dim.index);
  const lv = levelOf(score);
  const bounds = PRISM_LEVELS.slice(1).map((l) => l.band[0]);
  return (
    <div className="scalebox">
      <p className="eyebrow" style={{ marginTop: 10 }}>
        <span className="sw" style={{ background: dim.hue }}></span>Where this line reads on the ladder · <IllTag>Illustrative reading</IllTag>
      </p>
      <div className="scale">
        <span className="fill" style={{ width: `${score}%` }}></span>
        {bounds.map((v) => <span key={v} className="bd" style={{ left: `${v}%` }}></span>)}
        <span className="mk" style={{ left: `${score}%` }}></span>
        <span className="mkv" style={{ left: `${score}%` }}>{score} · {lv.id} {lv.name}</span>
      </div>
      <div className="bands">
        {PRISM_LEVELS.map((l) => (
          <span key={l.id} style={{ left: `${(l.band[0] + l.band[1]) / 2}%` }}>{l.id} {l.name}</span>
        ))}
      </div>
    </div>
  );
}
