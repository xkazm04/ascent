// Kicker — the canonical brand label: mono, uppercase, wide-tracked. One treatment for the ~86
// hand-rolled "font-mono uppercase tracking-widest" labels scattered across the app. `accent` for
// section eyebrows, `muted` for table headers / datelines / metadata.

export type KickerTone = "accent" | "muted";

export function Kicker({
  children,
  tone = "accent",
  as: Tag = "div",
  className = "",
}: {
  children: React.ReactNode;
  tone?: KickerTone;
  /** Element to render. `div` (default) is right for a section eyebrow, but a Kicker used as a FORM
   *  label sits inside a `<label>` (phrasing content only — a div there is invalid HTML) or as a
   *  fieldset's `<legend>`. Purely structural: the type treatment is identical for all three. */
  as?: "div" | "span" | "legend";
  className?: string;
}) {
  const color = tone === "accent" ? "text-accent" : "text-slate-500";
  return <Tag className={`font-mono text-xs uppercase tracking-[0.22em] ${color} ${className}`}>{children}</Tag>;
}
