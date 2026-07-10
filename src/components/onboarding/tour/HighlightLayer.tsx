"use client";

// A non-blocking accent ring glued to the tour's current target — the guided drawer keeps the app fully
// usable underneath, so it highlights rather than veils. Takes a viewport rect (from the engine) and
// renders nothing until it resolves.

/** Padding between the target's rect and the ring, so it doesn't clip the element's own border. */
const PAD = 6;

export function HighlightRing({ rect }: { rect: DOMRect | null }) {
  if (!rect) return null;
  return (
    <div
      aria-hidden
      className="animate-fade-in pointer-events-none fixed z-[45] rounded-xl ring-2 ring-accent/70 transition-all duration-300 ease-out motion-safe:animate-pulse"
      style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
    />
  );
}
