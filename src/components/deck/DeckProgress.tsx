// Scroll-progress hairline for a deck — a 2px accent rule across the top of the viewport that fills
// as the reader descends. Rendered by each deck orchestrator alongside DeckNav (which gives the same
// information as discrete dots; this gives it continuously, and at the one screen edge the eye is
// already using for the sticky header).
//
// Deliberately NOT a client component and deliberately not stateful: all of the behaviour lives in the
// `.deck-progress` rule in globals.css, which drives `scaleX` off a scroll-progress *timeline*. That
// means the fill is the browser's own scroll offset, resolved on the compositor — no scroll listener,
// no rAF loop, no React re-render per frame, and nothing that can contend with the snap. Browsers
// without scroll-driven animation support keep the rule's `scaleX(0)` rest state and never show it,
// which is the correct degradation for a purely supplementary indicator.

export function DeckProgress() {
  return <div aria-hidden className="deck-progress" />;
}
