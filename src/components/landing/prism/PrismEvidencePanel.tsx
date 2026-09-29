// One piece of (illustrative) evidence, opened as the scene's third level: the file, the verbatim lines,
// what supports what, and the guardband rule that keeps the model from moving the score.

import { BackArrow, IllTag } from "./PrismBits";
import type { PrismEvidence } from "./prismEvidence";
import { PRISM_LEVELS, levelAt, type PrismDim } from "./prismModel";

interface Props {
  dim: PrismDim;
  ev: PrismEvidence;
  index: number;
  count: number;
  onBack(): void;
  onNext(): void;
}

export function PrismEvidencePanel({ dim, ev, index, count, onBack, onNext }: Props) {
  const level = PRISM_LEVELS.find((l) => l.id === ev.level) ?? levelAt(0);
  return (
    <>
      <p className="eyebrow"><span className="sw"></span>Evidence {index + 1} of {count} · <IllTag /></p>
      <h3 id="prism-ev-h" tabIndex={-1}>{ev.path}</h3>
      <p className="via">Read with {ev.via}</p>
      <pre>{ev.code.map((line, k) => <span key={k}>{line}</span>)}</pre>
      <dl>
        <dt>Analyzer</dt><dd>{dim.id} {dim.name}, deterministic</dd>
        <dt>Supports</dt><dd>{level.id} {level.name} ({level.band[0]}–{level.band[1]})</dd>
        <dt>Says</dt><dd>{ev.note}</dd>
      </dl>
      <p className="guard">The model may quote and explain this line. It cannot move the score outside the analyzer&apos;s guardband.</p>
      <div className="evnav">
        <button type="button" className="back" onClick={onBack}><BackArrow />Back to {dim.id}</button>
        <button type="button" className="back" onClick={onNext}>Next evidence →</button>
      </div>
    </>
  );
}
