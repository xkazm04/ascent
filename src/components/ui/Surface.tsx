// Surface — the canonical brand panel: one radius / hairline border / translucent fill. Replaces the
// ~46 hand-rolled `rounded-xl/2xl border border-slate-800 bg-slate-900/40` panels. Padding is left to
// the caller so a Surface can be a tile (p-5), a section card (p-6/8), or an unpadded table shell.

export function Surface({
  children,
  className = "",
  id,
  radius = "2xl",
  tone = "base",
}: {
  children: React.ReactNode;
  className?: string;
  /** Scroll-anchor id (adds scroll-mt so a deep-linked panel clears the sticky header). */
  id?: string;
  radius?: "xl" | "2xl";
  /** `base` (panel) or `strong` (deeper fill, e.g. behind a chart). */
  tone?: "base" | "strong";
}) {
  const r = radius === "xl" ? "rounded-xl" : "rounded-2xl";
  const bg = tone === "strong" ? "bg-surface-strong/40" : "bg-surface/40";
  return (
    <div id={id} className={`${r} border border-divider ${bg} ${id ? "scroll-mt-24" : ""} ${className}`}>
      {children}
    </div>
  );
}
