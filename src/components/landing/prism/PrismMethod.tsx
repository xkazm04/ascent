// Method: the optical bench (five steps) and the posture quadrants.

import { PrismBench } from "./PrismBench";
import { PrismPosture } from "./PrismPosture";

export function PrismMethod() {
  return (
    <section id="method" className="sec" aria-labelledby="methodTitle">
      <div className="frame">
        <div className="sec-head">
          <p className="eyebrow"><span className="sw"></span>Method · the optical bench</p>
          <h2 id="methodTitle">Evidence in. A reading out.<br /><b>Nothing invented in between.</b></h2>
        </div>
        <PrismBench />
        <PrismPosture />
      </div>
    </section>
  );
}
