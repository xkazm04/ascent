import { Kicker } from "@/components/ui";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

// What a scan returns — the promise shown the moment the dialog opens. Counts come from the rubric so
// the copy can't drift from the model.
const OUTPUTS = [
  `A single 0–100 maturity score on a ${LEVELS.length}-level ladder`,
  `A radar across ${DIMENSIONS.length} weighted dimensions`,
  "The evidence behind every score",
  "A prioritized roadmap to climb to the next level",
];

/** The "what you'll get" rundown, in a hairline panel matching the landing's bordered cards. */
export function OutputsCard() {
  return (
    <div className="rounded-xl border border-divider bg-surface/40 p-5">
      <Kicker tone="muted">What you&apos;ll get</Kicker>
      <ul className="mt-3 space-y-2 text-base text-slate-300">
        {OUTPUTS.map((o) => (
          <li key={o} className="flex gap-2.5">
            <span className="mt-0.5 shrink-0 text-accent" aria-hidden>→</span>
            <span>{o}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
