import type { ReactNode } from "react";

// Shared full-viewport scroll-snap deck-pane shell. Centralizes the snap-deck contract that the
// About deck and the Index landing deck both re-typed per section: a `min-h-screen snap-start`
// section with the standard vertical rhythm, an optional `hero` shell variant, and the optional
// editorial `max-w-6xl` content container. Sits alongside the other deck primitives (DeckNav,
// Reveal, useSnapDeck). Purely presentational — class lists are byte-identical to the inlined
// originals.

const SECTION_CLASS = "flex min-h-screen snap-start flex-col justify-center pb-10 pt-14";
const HERO_CLASS = "relative isolate flex min-h-screen snap-start items-center overflow-hidden";
const CONTAINER_CLASS = "mx-auto w-full max-w-6xl px-5";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function DeckSection({
  id,
  variant = "section",
  contained = false,
  className,
  containerClassName,
  children,
}: {
  /** Section anchor id (deck nav targets + scroll-snap stops). */
  id?: string;
  /** `"section"` = the centered content pane; `"hero"` = the full-bleed masthead shell. */
  variant?: "section" | "hero";
  /** Wrap children in the standard `mx-auto w-full max-w-6xl px-5` container. */
  contained?: boolean;
  /** Extra classes appended to the `<section>` (rendered class list stays a superset). */
  className?: string;
  /** Extra classes appended to the inner container (only when `contained`). */
  containerClassName?: string;
  children: ReactNode;
}) {
  const base = variant === "hero" ? HERO_CLASS : SECTION_CLASS;
  return (
    <section id={id} className={cx(base, className)}>
      {contained ? <div className={cx(CONTAINER_CLASS, containerClassName)}>{children}</div> : children}
    </section>
  );
}
