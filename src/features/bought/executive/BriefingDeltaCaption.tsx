// The sentence under the maturity tile's delta badge: what that delta was measured over.
//
// The badge used to print a bare "+6 / vs last 90 days". That figure is cohort-matched movement now
// (repos scanned on BOTH sides of the window), and a delta without its denominator cannot be read:
// "+6" over 4 matched repositories out of 60 renders identically to "+6" over 58. The sentence itself
// comes from `periodDeltaCaption`, the one composer the board PDF, the "Copy for LLM" markdown and the
// public share page also read, so the denominator cannot be dropped on one of the four surfaces.
//
// No hooks, no handlers, no "use client": this is a server-renderable caption, and the public share
// page mounts it outside the authenticated app.
import { periodDeltaCaption } from "@/lib/org/briefingMovement";
import type { ExecBriefing } from "@/lib/org/briefing";

export function BriefingDeltaCaption({
  delta,
  movement,
  className = "",
}: {
  delta?: number | null;
  movement?: ExecBriefing["periodMovement"];
  className?: string;
}) {
  // Null when there is no cohort to name, which is exactly when the badge itself is suppressed: a
  // delta over an empty cohort is not a measurement, and a 0 in its place would read as "no change".
  const caption = periodDeltaCaption({ periodDelta: delta ?? null, periodMovement: movement ?? null });
  if (!caption) return null;
  return <p className={`${className} type-mono-sm leading-relaxed text-slate-500`}>{caption}</p>;
}
