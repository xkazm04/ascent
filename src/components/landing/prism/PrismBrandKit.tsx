// Identity sheet, right column: the drawn wordmark, the palette and the Spectral Nine, type, motion
// principle and the illustration style. Every hue and id comes from the product's dimensions.

import { HUES, PRISM_DIMS } from "./prismModel";
import { PrismArt } from "./PrismArt";
import { PrismMark, PrismWordmark, WORDMARK } from "./PrismDefs";

const SWATCHES = [
  { name: "Void", hex: "#05060A", bg: "#05060a", fg: "#f2eee6" },
  { name: "Graphite", hex: "#151823", bg: "#151823", fg: "#f2eee6" },
  { name: "Paper", hex: "#F2EEE6", bg: "#f2eee6", fg: "#0b0c12" },
];

export function PrismBrandWord() {
  return (
    <div className="bcell">
      <h4>Wordmark</h4>
      <div className="wmrow">
        <svg viewBox="0 0 480 94" style={{ height: "calc(var(--U)*5.4)", minHeight: 40, width: "auto", color: "#0b0c12" }} role="img" aria-label="ascent wordmark">
          <use href={`#${WORDMARK}`} width="480" height="94" />
        </svg>
      </div>
      <p>Drawn, not typeset: monoline geometry, an 8-unit stroke on a 60-unit x-height, round letters overshooting by half a stroke. The crossbar of the <i>t</i> keeps going and leaves the word as light.</p>
      <div className="wmrow" style={{ background: "#05060a", padding: "18px 20px", borderRadius: 4, color: "#f2eee6" }}>
        <PrismMark size={44} />
        <PrismWordmark style={{ height: 30, width: "auto" }} />
      </div>
      <h4 style={{ marginTop: 22 }}>Palette</h4>
      <div className="swatches">
        {SWATCHES.map((s) => (
          <div key={s.name} style={{ background: s.bg, color: s.fg, boxShadow: s.name === "Paper" ? "inset 0 0 0 1px rgba(11,12,18,.15)" : undefined }}>
            <b>{s.name}</b>{s.hex}
          </div>
        ))}
      </div>
      <div className="nine">
        {PRISM_DIMS.map((d) => (
          <div key={d.id} style={{ background: d.hue }}><span>{d.id}<br />{d.hue}</span></div>
        ))}
      </div>
      <p className="note" style={{ marginTop: 8 }}>The Spectral Nine: one hue per dimension, in wavelength order. Color is never decoration; it always names a dimension.</p>
    </div>
  );
}

export function PrismBrandType() {
  return (
    <div className="bcell typespec">
      <h4>Type</h4>
      <p className="big">Aa <b>Read the light.</b></p>
      <div className="row"><span>Display: light 300 for statements, semibold 600 for the thing named</span><span>system grotesque, -3.5% tracking</span></div>
      <div className="row"><span>Text: 17–18 px, generous leading, never below 16 px on desktop</span><span>system text face</span></div>
      <div className="row"><span className="mono">src/score/guardband.ts</span><span>mono, only for evidence and paths</span></div>
    </div>
  );
}

export function PrismBrandMotion({ reduced }: { reduced: boolean }) {
  return (
    <div className="bcell">
      <h4>Motion · refraction</h4>
      <div className="motion-demo">
        <svg viewBox="0 0 400 120" aria-label="Motion principle: one line enters, nine leave" role="img">
          <path d="M150 104L190 22L230 104" fill="none" stroke="rgba(242,238,230,.8)" strokeWidth="3" />
          <path className="md-in" d="M20 82L171 66" stroke="#f2eee6" strokeWidth="3" />
          <g strokeWidth="2.4">
            {HUES.map((h, i) => (
              <path key={h} className="md-ray" style={{ animationDelay: `${i * 0.04}s` }} d={`M209 64L390 ${14 + i * 11.5}`} stroke={h} />
            ))}
          </g>
        </svg>
      </div>
      <p>Every transition is one beat of refraction: a white line enters (600 ms), splits (900 ms), settles (400 ms), easing <span className="mono" style={{ fontSize: 14 }}>cubic-bezier(.2,.7,.1,1)</span>. Light brightens and dims; it never blinks or bounces.</p>
      <h4 style={{ marginTop: 18 }}>Illustration</h4>
      <div className="illrow">
        {[1, 3, 8].map((i) => (
          <div key={i}><PrismArt index={i} reduced={reduced} still /></div>
        ))}
      </div>
      <p className="note" style={{ marginTop: 8 }}>Line art, one hue per dimension, luminous on Void. Each dimension owns a drawn motif. Stylised; never a screenshot.</p>
    </div>
  );
}
