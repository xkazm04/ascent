// The identity, shown on paper: the page carries its own brand sheet so the system is judged as a whole.
// Paper background, so the top bar flips to its dark-on-paper form while this section is under it.

import { PrismBrandMark } from "./PrismBrandMark";
import { PrismBrandMotion, PrismBrandType, PrismBrandWord } from "./PrismBrandKit";

export function PrismBrand({ reduced }: { reduced: boolean }) {
  return (
    <section id="brand" className="sec" aria-labelledby="brandTitle">
      <div className="frame">
        <div className="sec-head">
          <p className="eyebrow"><span className="sw"></span>Identity</p>
          <h2 id="brandTitle">One line in. <b>Nine lines out.</b></h2>
          <p className="lede">The whole identity is the product&apos;s one act: white light enters, a prism separates it, and each colour can be read on its own. The mark is an A built as that prism, its crossbar the beam.</p>
        </div>
        <div className="bsheet">
          <PrismBrandMark />
          <PrismBrandWord />
          <PrismBrandType />
          <PrismBrandMotion reduced={reduced} />
        </div>
      </div>
    </section>
  );
}
