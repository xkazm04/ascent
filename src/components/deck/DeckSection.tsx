import type { ReactNode } from "react";

// Shared full-viewport scroll-snap deck-pane shell. Centralizes the snap-deck contract that the
// About deck and the Index landing deck both re-typed per section: a `min-h-screen snap-start`
// section with the standard vertical rhythm, an optional `hero` shell variant, and the optional
// editorial `max-w-6xl` content container. Sits alongside the other deck primitives (DeckNav,
// Reveal, useSnapDeck). Purely presentational.
//
// Bottom rhythm: below `lg` DeckNav overlays a fixed ~56px bottom bar, so sections reserve `pb-24`
// there (bar + the standard 40px breathing room) and return to `pb-10` at `lg` where the bar is
// hidden. Keep this in lockstep with DeckNav's mobile bar height.

const SECTION_CLASS = "flex min-h-screen snap-start flex-col justify-center pb-24 pt-14 lg:pb-10";

// The `startLgCenter` variant for TALL sections (register table, dimension matrix, org gallery):
// below lg their content is top-aligned so it begins at the snap edge instead of overflowing the
// viewport top when centered; lg+ returns to the deck's centered rhythm.
const SECTION_TALL_CLASS =
  "flex min-h-screen snap-start flex-col justify-start pb-24 pt-14 lg:justify-center lg:pb-10";
const HERO_CLASS = "relative isolate flex min-h-screen snap-start items-center overflow-hidden";
const CONTAINER_CLASS = "mx-auto w-full max-w-6xl px-5";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function DeckSection({
  id,
  variant = "section",
  justify = "center",
  deckLast = false,
  contained = false,
  className,
  containerClassName,
  children,
}: {
  /** Section anchor id (deck nav targets + scroll-snap stops). */
  id?: string;
  /** `"section"` = the centered content pane; `"hero"` = the full-bleed masthead shell. */
  variant?: "section" | "hero";
  /**
   * Vertical alignment (`"section"` variant only). `"center"` is the deck default;
   * `"startLgCenter"` top-aligns below lg for sections taller than the viewport, so their content
   * starts at the snap edge instead of being centered with the top rows cut off.
   */
  justify?: "center" | "startLgCenter";
  /**
   * Mark this as the deck's FINAL section — globals.css hides the section connector
   * (hairline + node) on `[data-deck-last]`. If a section is ever added after this one, move the
   * flag to the new last section.
   */
  deckLast?: boolean;
  /** Wrap children in the standard `mx-auto w-full max-w-6xl px-5` container. */
  contained?: boolean;
  /** Extra classes appended to the `<section>` (rendered class list stays a superset). */
  className?: string;
  /** Extra classes appended to the inner container (only when `contained`). */
  containerClassName?: string;
  children: ReactNode;
}) {
  const base =
    variant === "hero" ? HERO_CLASS : justify === "startLgCenter" ? SECTION_TALL_CLASS : SECTION_CLASS;
  return (
    <section id={id} data-deck-last={deckLast ? "" : undefined} className={cx(base, className)}>
      {contained ? <div className={cx(CONTAINER_CLASS, containerClassName)}>{children}</div> : children}
    </section>
  );
}
