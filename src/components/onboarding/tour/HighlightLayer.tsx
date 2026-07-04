"use client";

// The two ways the tour draws attention to a live element, shared across variants:
//  • SpotlightScrim — dims the whole app and punches a lit hole over the target (the blocking coach-mark
//    look). The 9999px box-shadow spread paints the scrim AROUND a transparent rounded rect at the rect.
//  • HighlightRing — a non-blocking accent ring glued to the target, for the companion-rail variant that
//    lets the user keep using the app underneath.
// Both take a viewport rect (from the engine) and render nothing meaningful until it resolves.

/** Padding between the target's rect and the highlight, so the box doesn't clip the element's own border. */
const PAD = 8;

function boxStyle(rect: DOMRect, pad = PAD): React.CSSProperties {
  return {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

export function SpotlightScrim({ rect }: { rect: DOMRect | null }) {
  // No anchor (concept step) or not yet resolved → a plain full-screen dim.
  if (!rect) {
    return <div aria-hidden className="animate-fade-in fixed inset-0 z-[60] bg-ink/80" />;
  }
  return (
    <div
      aria-hidden
      className="animate-fade-in pointer-events-none fixed z-[60] rounded-xl outline outline-1 outline-accent/60 transition-all duration-300 ease-out"
      style={{ ...boxStyle(rect), boxShadow: "0 0 0 9999px rgba(8,13,26,0.82)" }}
    />
  );
}

export function HighlightRing({ rect }: { rect: DOMRect | null }) {
  if (!rect) return null;
  return (
    <div
      aria-hidden
      className="animate-fade-in pointer-events-none fixed z-[45] rounded-xl ring-2 ring-accent/70 transition-all duration-300 ease-out motion-safe:animate-pulse"
      style={boxStyle(rect, PAD - 2)}
    />
  );
}
