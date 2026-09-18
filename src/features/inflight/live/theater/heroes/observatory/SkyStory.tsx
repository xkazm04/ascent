// The sky in words, twice: the NARRATED LINE under the sky (SVG text, so it scales with the screen),
// and the TEXT ALTERNATIVE for assistive tech — the SVG is aria-hidden, so the sentence and one line
// per body are repeated as real text in an sr-only block. No hooks — no "use client".

import type { SkyBody, SkyModel } from "./skyModel";
import type { SkyFrame } from "./skyEllipse";
import { SEPARATOR, type FittedNarration } from "./skyNarration";

export function SkyNarrationLine({ f, narration }: { f: SkyFrame; narration: FittedNarration }) {
  return (
    <text x={f.cx} y={f.narrationY} textAnchor="middle" className={narration.size === "display" ? "type-display" : "type-heading"} data-narration>
      {narration.clauses.map((c, i) => (
        <tspan key={i}>
          {i > 0 ? <tspan className="fill-slate-600">{SEPARATOR}</tspan> : null}
          {c.subject ? <tspan className="font-semibold fill-white">{`${c.subject} `}</tspan> : null}
          <tspan className="fill-slate-300">{c.rest}</tspan>
        </tspan>
      ))}
    </text>
  );
}

const RING_WORDS = ["at work", "next up", "resting"] as const;

/** One body, in a sentence a screen reader can say. */
export function describeBody(b: SkyBody): string {
  const parts: string[] = [];
  if (b.ring === 0) {
    parts.push(b.phase ?? "working");
    if (b.inPhase) parts.push(b.inPhase);
    if (b.file) parts.push(`last ${b.fileEdited ? "edited" : "read"} ${b.file}`);
    if (b.diff) parts.push(b.diff);
    const m = b.memory;
    if (m) parts.push(`${m.reads} reads and ${m.edits} edits seen since this screen opened`);
  } else if (b.note) {
    parts.push(b.note);
  }
  if (b.landedToday) parts.push(`landed ${b.landedToday === 1 ? "once" : `${b.landedToday} times`} today`);
  return `${b.name} — ${RING_WORDS[b.ring]}: ${parts.join("; ")}`;
}

export function SkyTextAlternative({ model, narration }: { model: SkyModel; narration: FittedNarration }) {
  const order = [...model.bodies].sort((a, b) => a.ring - b.ring || a.repo.localeCompare(b.repo));
  return (
    <div className="sr-only" data-testid="observatory-text">
      <p>{narration.full}</p>
      {model.core.title ? <p>{[model.core.title, model.core.sub].filter(Boolean).join(" ")}</p> : null}
      <ul aria-label="Repos in the sky">
        {order.map((b) => (
          <li key={b.repo} data-sky-repo={b.repo}>
            {describeBody(b)}
          </li>
        ))}
      </ul>
    </div>
  );
}
