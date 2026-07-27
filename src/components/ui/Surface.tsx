// Surface — the canonical brand panel: one radius / hairline border / translucent fill. Replaces the
// ~46 hand-rolled `rounded-xl/2xl border border-slate-800 bg-slate-900/40` panels. Padding is left to
// the caller so a Surface can be a tile (p-5), a section card (p-6/8), or an unpadded table shell.

export function Surface({
  children,
  className = "",
  id,
  radius = "2xl",
  tone = "base",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  /** Scroll-anchor id (adds scroll-mt so a deep-linked panel clears the sticky header). */
  id?: string;
  radius?: "xl" | "2xl";
  /** `base` (panel) or `strong` (deeper fill, e.g. behind a chart). */
  tone?: "base" | "strong";
  // Pass-through for the plain div attributes a panel legitimately needs — `data-testid` above all.
  // Before this, callers that passed one (PassportHero, ReportConversionCta) had it silently dropped,
  // leaving DEAD test hooks: a query by testid found nothing and the attribute never reached the DOM.
  // Deliberately narrow — className/id/radius/tone stay the styling contract, so a caller can't
  // smuggle in a competing `style`/`className` and break the one-radius/one-hairline panel identity.
} & Pick<React.HTMLAttributes<HTMLDivElement>, "role" | "aria-label" | "aria-labelledby" | "aria-hidden"> & {
    [dataAttr: `data-${string}`]: string | number | boolean | undefined;
  }) {
  const r = radius === "xl" ? "rounded-xl" : "rounded-2xl";
  const bg = tone === "strong" ? "bg-surface-strong/40" : "bg-surface/40";
  return (
    // Anchor offset = the shared sticky-header height token (globals.css --header-h, defined next to
    // the HEADER_SHELL contract) + 2.5rem breathing room — not a locally re-guessed magic number.
    <div id={id} className={`${r} border border-divider ${bg} ${id ? "scroll-mt-[calc(var(--header-h)+2.5rem)]" : ""} ${className}`} {...rest}>
      {children}
    </div>
  );
}
